import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import {
  defaultSchema,
  defaultViews,
  mergeProps,
  reconcileProps,
  sanitizeSchema,
  sanitizeViews,
  type PropertyDef,
  type Props,
  type View,
} from './dbschema.ts';

/**
 * A page is one Markdown file: content/<id>.md
 * Metadata (title, parent, order...) lives in YAML frontmatter, so every file
 * is plain Markdown you can open in any editor. Nesting is by `parent` id,
 * which keeps moving a page cheap (no folder renames).
 *
 * Databases are pages too:
 *  - a database page has `kind: database`, a `schema` (properties) and `views`
 *  - each row is a normal page with `database: <db id>` and its values in `props`
 * Rows are hidden from the sidebar tree but are still plain Markdown files.
 *
 * Everything else talks to the `PageStore` interface, so a database-backed
 * store (needed once this runs on Vercel) can replace FilePageStore later.
 */

export type PageKind = 'page' | 'database';

export interface PageMeta {
  id: string;
  title: string;
  parent: string | null;
  icon: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  kind: PageKind;
  database: string | null; // set on rows: the id of the database they belong to
  props: Props; // set on rows
  schema?: PropertyDef[]; // databases only
  views?: View[]; // databases only
}

export interface Page extends PageMeta {
  body: string; // Markdown
}

export interface CreateInput {
  title?: string;
  parent?: string | null;
  body?: string;
  icon?: string;
  kind?: PageKind;
  database?: string | null;
  props?: Record<string, unknown>;
  schema?: unknown;
}

export interface UpdatePatch {
  title?: string;
  body?: string;
  parent?: string | null;
  icon?: string;
  order?: number;
  props?: Record<string, unknown>; // merged into existing props (null clears a value)
  schema?: unknown; // databases only; replaces the whole schema
  views?: unknown; // databases only; replaces the whole view list
}

export interface PageStore {
  list(): Promise<PageMeta[]>;
  get(id: string): Promise<Page | null>;
  create(input: CreateInput): Promise<Page>;
  update(id: string, patch: UpdatePatch, opts?: { baseUpdatedAt?: string }): Promise<Page>;
  remove(id: string): Promise<string[]>; // returns ids removed (page + descendants + rows)
  search(query: string): Promise<{ id: string; title: string; snippet: string; database?: string | null }[]>;
  /** Insert or replace a whole page exactly as given (ids and timestamps kept). Used by migrations and restores. */
  import(page: Page): Promise<void>;
}

export class ConflictError extends Error {
  constructor(public current: Page) {
    super('Page changed since you loaded it');
  }
}

const ID_RE = /^[a-z0-9]{8,32}$/;

export function newId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function toIso(v: unknown, fallback: string): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) return v;
  return fallback;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/**
 * Everything that is not about *where* pages are kept lives here, so the file store and the
 * database store behave identically (same rules for rows, conflicts, ordering and search).
 */
export abstract class BasePageStore implements PageStore {
  /** Every live page, with bodies. */
  protected abstract readAll(): Promise<Page[]>;
  /** Page metadata only (no bodies). */
  protected async readMeta(): Promise<PageMeta[]> {
    return (await this.readAll()).map(({ body: _body, ...meta }) => meta);
  }
  protected abstract readOne(id: string): Promise<Page | null>;
  protected async readRows(dbId: string): Promise<Page[]> {
    return (await this.readAll()).filter((p) => p.database === dbId);
  }
  /** Pages that may match a search (store may pre-filter; the rest is filtered again here). */
  protected async candidates(_q: string): Promise<Page[]> {
    return this.readAll();
  }
  /**
   * Save a page. If `expectUpdatedAt` is given the save only happens when the stored page still has that
   * updatedAt; returns false when it doesn't (someone else saved first).
   */
  protected abstract write(p: Page, expectUpdatedAt?: string): Promise<boolean>;
  protected abstract trash(ids: string[]): Promise<void>;

  /** Run a mutation on its own. The file store overrides this to queue edits (one process, one writer). */
  protected exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async import(page: Page): Promise<void> {
    if (!isValidId(page.id)) throw new Error('Invalid page id');
    await this.write(page);
  }

  async list(): Promise<PageMeta[]> {
    return (await this.readMeta()).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Page | null> {
    if (!isValidId(id)) return null;
    return this.readOne(id);
  }

  create(input: CreateInput): Promise<Page> {
    return this.exclusive(() => this.createNow(input));
  }

  private async createNow(input: CreateInput): Promise<Page> {
    const all = await this.list();
    const now = new Date().toISOString();
    const kind: PageKind = input.kind === 'database' ? 'database' : 'page';

    // ----- a row inside a database -----
    if (input.database) {
      const db = all.find((p) => p.id === input.database);
      if (!db || db.kind !== 'database') throw new Error('Database not found');
      if (kind === 'database') throw new Error('A database cannot be a row');
      const siblings = all.filter((p) => p.database === db.id);
      const row: Page = {
        id: newId(),
        title: input.title?.trim() || 'Untitled',
        parent: null,
        icon: input.icon ?? '',
        order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
        createdAt: now,
        updatedAt: now,
        kind: 'page',
        database: db.id,
        props: mergeProps(db.schema ?? [], {}, input.props ?? {}),
        body: input.body ?? '',
      };
      await this.write(row);
      return row;
    }

    // ----- a normal page or a new database -----
    const parent = input.parent ?? null;
    if (parent && !all.some((p) => p.id === parent && !p.database)) throw new Error('Parent page not found');
    const siblings = all.filter((p) => p.parent === parent && !p.database);
    const page: Page = {
      id: newId(),
      title: input.title?.trim() || (kind === 'database' ? 'Untitled database' : 'Untitled'),
      parent,
      icon: input.icon ?? (kind === 'database' ? '🗂️' : ''),
      order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
      kind,
      database: null,
      props: {},
      body: input.body ?? '',
    };
    if (kind === 'database') {
      page.schema = input.schema === undefined ? defaultSchema() : sanitizeSchema(input.schema);
      page.views = defaultViews(page.schema);
    }
    await this.write(page);
    return page;
  }

  update(id: string, patch: UpdatePatch, opts: { baseUpdatedAt?: string } = {}): Promise<Page> {
    return this.exclusive(() => this.updateNow(id, patch, opts));
  }

  private async updateNow(id: string, patch: UpdatePatch, opts: { baseUpdatedAt?: string }): Promise<Page> {
    // Edits that don't carry a base version (properties, views, order) are simply retried if someone else saved in between.
    for (let attempt = 0; attempt < 4; attempt++) {
      const done = await this.tryUpdate(id, patch, opts);
      if (done) return done;
    }
    throw new Error('The page kept changing; please try again');
  }

  private async tryUpdate(id: string, patch: UpdatePatch, opts: { baseUpdatedAt?: string }): Promise<Page | null> {
    const current = await this.get(id);
    if (!current) throw new Error('Page not found');
    if (opts.baseUpdatedAt && opts.baseUpdatedAt !== current.updatedAt) throw new ConflictError(current);

    const all = patch.parent !== undefined ? await this.list() : [];

    if (patch.parent !== undefined && patch.parent !== null) {
      if (current.database) throw new Error('Rows cannot be moved out of their database');
      if (patch.parent === id) throw new Error('A page cannot be its own parent');
      if (!all.some((p) => p.id === patch.parent && !p.database)) throw new Error('Parent page not found');
      // refuse moving a page under its own descendant
      let cursor: string | null = patch.parent;
      const byId = new Map(all.map((p) => [p.id, p]));
      while (cursor) {
        if (cursor === id) throw new Error('Cannot move a page inside itself');
        cursor = byId.get(cursor)?.parent ?? null;
      }
    }

    const next: Page = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title.trim() || 'Untitled' } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.parent !== undefined ? { parent: patch.parent } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.order !== undefined ? { order: patch.order } : {}),
    };

    // updatedAt only moves for edits to the page itself. Property, schema and view edits don't bump it,
    // so editing a row in a table never makes someone's open row page report a false "changed elsewhere".
    const touched = patch.title !== undefined || patch.body !== undefined || patch.parent !== undefined || patch.icon !== undefined;
    if (touched) {
      next.updatedAt = new Date().toISOString();
      // guarantee a strictly newer timestamp so the conflict check never misses a quick second save
      if (next.updatedAt <= current.updatedAt) {
        next.updatedAt = new Date(new Date(current.updatedAt).getTime() + 1).toISOString();
      }
    }

    if (patch.props !== undefined) {
      if (!current.database) throw new Error('Only database rows have properties');
      const db = await this.get(current.database);
      if (!db || db.kind !== 'database') throw new Error('Database not found');
      next.props = mergeProps(db.schema ?? [], current.props, patch.props);
    }

    let reconcileRows = false;
    if (patch.schema !== undefined || patch.views !== undefined) {
      if (current.kind !== 'database') throw new Error('Only databases have a schema or views');
      if (patch.schema !== undefined) {
        next.schema = sanitizeSchema(patch.schema);
        reconcileRows = true;
      }
      // views are always re-checked against the (possibly new) schema
      next.views = sanitizeViews(patch.views !== undefined ? patch.views : (current.views ?? []), next.schema ?? []);
    }

    if (!(await this.write(next, current.updatedAt))) {
      if (opts.baseUpdatedAt) {
        const latest = await this.get(id);
        if (!latest) throw new Error('Page not found');
        throw new ConflictError(latest);
      }
      return null; // lost a race; caller retries from fresh state
    }

    if (reconcileRows) {
      // Drop row values that no longer fit the schema (deleted property, removed option, changed type).
      for (const row of await this.readRows(id)) {
        const fixed = reconcileProps(next.schema ?? [], row.props);
        if (JSON.stringify(fixed) !== JSON.stringify(row.props)) await this.write({ ...row, props: fixed });
      }
    }
    return next;
  }

  remove(id: string): Promise<string[]> {
    return this.exclusive(() => this.removeNow(id));
  }

  private async removeNow(id: string): Promise<string[]> {
    const all = await this.list();
    if (!all.some((p) => p.id === id)) return [];
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of all) {
        if (doomed.has(p.id)) continue;
        // sub-pages and the rows of a deleted database go with it
        if ((p.parent && doomed.has(p.parent)) || (p.database && doomed.has(p.database))) {
          doomed.add(p.id);
          grew = true;
        }
      }
    }
    await this.trash([...doomed]); // soft delete: nothing is lost by accident
    return [...doomed];
  }

  async search(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pages = await this.candidates(q);
    const titles = new Map((await this.list()).filter((p) => p.kind === 'database').map((p) => [p.id, p.title]));
    const out: { id: string; title: string; snippet: string; database: string | null; score: number }[] = [];
    for (const p of pages) {
      const inTitle = p.title.toLowerCase().includes(q);
      const idx = p.body.toLowerCase().indexOf(q);
      if (!inTitle && idx < 0) continue;
      let snippet = '';
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        snippet = (start > 0 ? '…' : '') + p.body.slice(start, idx + q.length + 80).replace(/\s+/g, ' ');
      } else if (p.database) {
        snippet = `in ${titles.get(p.database) ?? 'a database'}`;
      }
      out.push({ id: p.id, title: p.title, snippet, database: p.database, score: (inTitle ? 2 : 0) + (idx >= 0 ? 1 : 0) });
    }
    return out
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ score: _s, ...r }) => r);
  }
}

export class FilePageStore extends BasePageStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private dir: string) {
    super();
  }

  protected exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private file(id: string) {
    if (!isValidId(id)) throw new Error('Invalid page id');
    return path.join(this.dir, `${id}.md`);
  }

  private async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private parse(id: string, raw: string): Page {
    const { data, content } = matter(raw);
    const now = new Date().toISOString();
    const kind: PageKind = data.kind === 'database' ? 'database' : 'page';
    const page: Page = {
      id,
      title: typeof data.title === 'string' ? data.title : 'Untitled',
      parent: typeof data.parent === 'string' && data.parent ? data.parent : null,
      icon: typeof data.icon === 'string' ? data.icon : '',
      order: typeof data.order === 'number' ? data.order : 0,
      createdAt: toIso(data.createdAt, now),
      updatedAt: toIso(data.updatedAt, now),
      kind,
      database: typeof data.database === 'string' && data.database ? data.database : null,
      props: data.props && typeof data.props === 'object' && !Array.isArray(data.props) ? (clone(data.props) as Props) : {},
      body: content.replace(/^\n+/, ''),
    };
    if (kind === 'database') {
      try {
        page.schema = sanitizeSchema(clone(data.schema ?? []));
        page.views = sanitizeViews(clone(data.views ?? []), page.schema);
      } catch {
        // A hand-edited file with a broken schema should still open, with defaults.
        page.schema = defaultSchema();
        page.views = defaultViews(page.schema);
      }
    }
    return page;
  }

  private serialize(p: Page): string {
    const data: Record<string, unknown> = {
      title: p.title,
      parent: p.parent ?? '',
      icon: p.icon,
      order: p.order,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
    if (p.kind === 'database') {
      data.kind = 'database';
      data.schema = p.schema ?? [];
      data.views = p.views ?? [];
    }
    if (p.database) data.database = p.database;
    if (p.database && Object.keys(p.props).length) data.props = p.props;
    return matter.stringify(p.body.endsWith('\n') ? p.body : p.body + '\n', data);
  }

  protected async write(p: Page, expectUpdatedAt?: string): Promise<boolean> {
    if (expectUpdatedAt !== undefined) {
      const cur = await this.readOne(p.id);
      if (cur && cur.updatedAt !== expectUpdatedAt) return false;
    }
    await this.ensureDir();
    const target = this.file(p.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, this.serialize(p), 'utf8');
    await fs.rename(tmp, target); // atomic: a crash never leaves half a page
    return true;
  }

  protected async readAll(): Promise<Page[]> {
    await this.ensureDir();
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.md'));
    const pages: Page[] = [];
    for (const n of names) {
      const id = n.slice(0, -3);
      if (!isValidId(id)) continue;
      try {
        pages.push(this.parse(id, await fs.readFile(path.join(this.dir, n), 'utf8')));
      } catch {
        /* skip unreadable file */
      }
    }
    return pages;
  }

  protected async readOne(id: string): Promise<Page | null> {
    try {
      return this.parse(id, await fs.readFile(this.file(id), 'utf8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  protected async trash(ids: string[]): Promise<void> {
    const trash = path.join(this.dir, '.trash');
    await fs.mkdir(trash, { recursive: true });
    for (const d of ids) await fs.rename(this.file(d), path.join(trash, `${d}.md`)).catch(() => {});
  }
}
