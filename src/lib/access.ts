import { deriveRows, isDerived, uid, type DeriveContext, type PropertyDef, type Row } from './dbschema.ts';
import { ensureSpacesFor, personalSpaceId } from './spaces.ts';
import {
  isValidId,
  newId,
  type CreateInput,
  type Page,
  type PageMeta,
  type PageStore,
  type SearchHit,
  type Space,
  type UpdatePatch,
} from './storage.ts';

/** An error that knows which HTTP status it should become. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Everything the app does for one signed-in person goes through here, so who may see or change what is decided in
 * one place. A page that isn't in one of your spaces behaves exactly like a page that doesn't exist (404), so
 * nothing leaks about other people's pages, not even that they exist.
 */
export class Workspace {
  private cache: Space[] | null = null;
  readonly email: string;

  constructor(
    private store: PageStore,
    readonly user: { email: string; name: string },
    private allowed: string[],
  ) {
    this.email = user.email.trim().toLowerCase();
  }

  /** The spaces this person belongs to (creating their Personal space, and HQ, on first use). */
  async spaces(): Promise<Space[]> {
    if (!this.cache) this.cache = await ensureSpacesFor(this.store, this.user, this.allowed);
    return this.cache;
  }

  private async ids(): Promise<Set<string>> {
    return new Set((await this.spaces()).map((s) => s.id));
  }

  get personalId(): string {
    return personalSpaceId(this.email);
  }

  /* ------------------------------- pages ------------------------------- */

  async list(spaceId?: string): Promise<PageMeta[]> {
    const ids = await this.ids();
    if (spaceId !== undefined && !ids.has(spaceId)) throw new HttpError(404, 'Space not found');
    return (await this.store.list()).filter((p) => (spaceId ? p.space === spaceId : ids.has(p.space)));
  }

  async get(id: string): Promise<Page | null> {
    const page = await this.store.get(id);
    if (!page || !(await this.ids()).has(page.space)) return null;
    return page.database ? this.withDerived(page) : page;
  }

  /**
   * Worked-out properties (the other side of a relation, rollups) are never stored; they are calculated here from the
   * pages in the same space whenever a row is read. Databases in another space are invisible to the calculation.
   */
  private deriveContext(metas: PageMeta[], space: string): DeriveContext {
    const inSpace = metas.filter((p) => p.space === space);
    return {
      rowsOf: (dbId) => inSpace.filter((p) => p.database === dbId) as Row[],
      schemaOf: (dbId) => inSpace.find((p) => p.id === dbId && p.kind === 'database')?.schema ?? null,
    };
  }

  private async withDerived(row: Page): Promise<Page> {
    const metas = await this.store.list();
    const db = metas.find((p) => p.id === row.database);
    if (!db?.schema?.some(isDerivedDef)) return row;
    const [derived] = deriveRows(db.schema, [row as unknown as Row], this.deriveContext(metas, row.space));
    return { ...row, props: derived.props };
  }

  private async must(id: string): Promise<Page> {
    const page = await this.get(id);
    if (!page) throw new HttpError(404, 'Not found');
    return page;
  }

  async create(input: CreateInput): Promise<Page> {
    const ids = await this.ids();
    if (input.database) {
      await this.must(input.database);
    } else if (input.parent) {
      await this.must(input.parent);
    } else {
      const space = input.space ?? this.personalId;
      if (!ids.has(space)) throw new HttpError(404, 'Space not found');
      input = { ...input, space };
    }
    return this.store.create(input);
  }

  async update(id: string, patch: UpdatePatch, opts?: { baseUpdatedAt?: string }): Promise<Page> {
    const page = await this.must(id);
    if (patch.parent) await this.must(patch.parent); // a parent you can't see behaves like one that doesn't exist
    if (patch.props && page.database) {
      const rest = await this.applyOtherSideEdits(page, patch.props);
      if (rest !== patch.props) {
        patch = { ...patch, props: rest };
        if (Object.keys(rest).length === 0 && Object.keys(patch).every((k) => k === 'props')) return (await this.get(id))!;
      }
    }
    const saved = await this.store.update(id, patch, opts);
    return saved.database ? this.withDerived(saved) : saved;
  }

  /**
   * The "other side" of a two-way relation has no stored value: editing it means adding or removing this row from the
   * link lists of the rows on the other side. Returns the patch without those properties.
   */
  private async applyOtherSideEdits(row: Page, props: Record<string, unknown>): Promise<Record<string, unknown>> {
    const db = await this.store.get(row.database!);
    const others = (db?.schema ?? []).filter((d) => d.type === 'relation' && d.relation?.reverseOf && d.id in props);
    if (!db || others.length === 0) return props;
    const metas = await this.store.list();
    const rest: Record<string, unknown> = { ...props };
    for (const def of others) {
      delete rest[def.id];
      const forward = def.relation!.reverseOf!;
      const sourceDb = def.relation!.database;
      const wanted = Array.isArray(props[def.id]) ? (props[def.id] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      const sources = metas.filter((p) => p.database === sourceDb && p.space === row.space);
      const has = (r: PageMeta) => Array.isArray(r.props[forward]) && (r.props[forward] as string[]).includes(row.id);
      const single = (sources[0] && (await this.store.get(sourceDb))?.schema?.find((d) => d.id === forward)?.relation?.single) === true;
      for (const src of sources) {
        const want = wanted.includes(src.id);
        if (want === has(src)) continue;
        const current = (Array.isArray(src.props[forward]) ? (src.props[forward] as string[]) : []).filter((x) => x !== row.id);
        const next = want ? (single ? [row.id] : [...current, row.id]) : current;
        await this.store.update(src.id, { props: { [forward]: next.length ? next : null } });
      }
    }
    return rest;
  }

  /**
   * Link two databases (or a database to itself). `twoWay` also adds a property to the other database that lists the rows
   * pointing at it. A single-link self relation is how sub-items work (a "Parent" and its "Sub-items").
   */
  async addRelation(
    sourceId: string,
    opts: { name: string; target: string; twoWay: boolean; reverseName?: string; single?: boolean },
  ): Promise<{ source: Page; target: Page; property: PropertyDef }> {
    const source = await this.must(sourceId);
    const target = await this.must(opts.target);
    if (source.kind !== 'database' || target.kind !== 'database') throw new HttpError(400, 'Relations link databases');
    const forward: PropertyDef = {
      id: uid(),
      name: opts.name.trim().slice(0, 60) || target.title || 'Relation',
      type: 'relation',
      relation: { database: target.id, ...(opts.single ? { single: true } : {}) },
    };
    const reverse: PropertyDef | null = opts.twoWay
      ? {
          id: uid(),
          name: (opts.reverseName ?? '').trim().slice(0, 60) || source.title || 'Related',
          type: 'relation',
          relation: { database: source.id, reverseOf: forward.id },
        }
      : null;
    try {
      if (reverse && target.id === source.id) {
        const both = await this.store.update(source.id, { schema: [...(source.schema ?? []), forward, reverse] });
        return { source: both, target: both, property: forward };
      }
      const savedSource = await this.store.update(source.id, { schema: [...(source.schema ?? []), forward] });
      if (!reverse) return { source: savedSource, target: target.id === source.id ? savedSource : target, property: forward };
      const savedTarget = await this.store.update(target.id, { schema: [...(target.schema ?? []), reverse] });
      return { source: savedSource, target: savedTarget, property: forward };
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }

  /** Who is in the spaces you are in, by name, and remember your own name for the others. */
  async people(): Promise<Record<string, string>> {
    const spaces = await this.spaces();
    const known = new Map((await this.store.listUsers()).map((u) => [u.email, u.name]));
    if (this.user.name && known.get(this.email) !== this.user.name) {
      await this.store.saveUser({ email: this.email, name: this.user.name });
      known.set(this.email, this.user.name);
    }
    const out: Record<string, string> = {};
    for (const s of spaces) for (const m of s.members) out[m] = known.get(m) || m.split('@')[0];
    return out;
  }

  async remove(id: string): Promise<string[]> {
    await this.must(id);
    return this.store.remove(id);
  }

  async database(id: string): Promise<{ database: Page; rows: PageMeta[] } | null> {
    const database = await this.get(id);
    if (!database || database.kind !== 'database') return null;
    const metas = await this.store.list();
    const stored = metas.filter((p) => p.database === database.id);
    const rows = deriveRows(database.schema ?? [], stored as unknown as Row[], this.deriveContext(metas, database.space)) as unknown as PageMeta[];
    return { database, rows };
  }

  async search(q: string): Promise<SearchHit[]> {
    return this.store.search(q, { spaces: [...(await this.ids())] });
  }

  /** Move a page (with its sub-pages, or a database with its rows) into another space you belong to. */
  async move(id: string, toSpace: string): Promise<string[]> {
    await this.must(id);
    if (!(await this.ids()).has(toSpace)) throw new HttpError(404, 'Space not found');
    try {
      return await this.store.moveToSpace(id, toSpace);
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }

  /** Every page in a space, with bodies, for exports. */
  async pagesOf(spaceId: string): Promise<Page[]> {
    const metas = await this.list(spaceId);
    const pages = await Promise.all(metas.map((m) => this.store.get(m.id)));
    return pages.filter((p): p is Page => !!p);
  }

  /* ------------------------------- spaces ------------------------------- */

  async space(id: string): Promise<Space> {
    const s = (await this.spaces()).find((x) => x.id === id);
    if (!s) throw new HttpError(404, 'Space not found');
    return s;
  }

  async createSpace(name: string, icon?: string): Promise<Space> {
    const clean = name.trim();
    if (!clean) throw new HttpError(400, 'Give the space a name');
    const space: Space = {
      id: newId(),
      name: clean.slice(0, 60),
      icon: icon?.trim().slice(0, 8) || '📁',
      kind: 'shared',
      owner: this.email,
      members: [this.email],
      createdAt: new Date().toISOString(),
    };
    await this.store.createSpace(space);
    this.cache = null;
    return this.space(space.id);
  }

  private async ownedShared(id: string): Promise<Space> {
    const s = await this.space(id);
    if (s.kind === 'personal') throw new HttpError(400, 'A Personal space is only ever yours; it has no members to manage');
    if (s.owner !== this.email) throw new HttpError(403, 'Only the space owner can do that');
    return s;
  }

  async renameSpace(id: string, patch: { name?: string; icon?: string }): Promise<Space> {
    await this.ownedShared(id);
    const next = await this.store.mutateSpace(id, (s) => ({
      ...s,
      name: patch.name !== undefined && patch.name.trim() ? patch.name : s.name,
      icon: patch.icon !== undefined ? patch.icon : s.icon,
    }));
    this.cache = null;
    return next;
  }

  async addMember(id: string, rawEmail: string): Promise<Space> {
    await this.ownedShared(id);
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That does not look like an email address');
    if (!this.allowed.includes(email)) {
      throw new HttpError(400, 'That person cannot sign in yet. Add their email to ALLOWED_EMAILS first, then add them here.');
    }
    const next = await this.store.mutateSpace(id, (s) => ({ ...s, members: [...s.members, email] }));
    this.cache = null;
    return next;
  }

  /** The owner can remove anyone but themselves; anyone else can only remove themselves (leave). */
  async removeMember(id: string, rawEmail: string): Promise<Space> {
    const s = await this.space(id);
    if (s.kind === 'personal') throw new HttpError(400, 'You cannot leave your own Personal space');
    const email = rawEmail.trim().toLowerCase();
    if (email === s.owner) throw new HttpError(400, 'The owner cannot be removed from their own space');
    if (this.email !== s.owner && this.email !== email) throw new HttpError(403, 'Only the space owner can remove other people');
    const next = await this.store.mutateSpace(id, (x) => ({ ...x, members: x.members.filter((m) => m !== email) }));
    this.cache = null;
    return next;
  }
}

const isDerivedDef = (d: PropertyDef) => isDerived(d);

export { isValidId };
