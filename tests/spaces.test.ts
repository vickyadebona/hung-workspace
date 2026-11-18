import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { FilePageStore, LEGACY_SPACE_ID, pageToMarkdown, type PageStore } from '../src/lib/storage.ts';
import { PgPageStore } from '../src/lib/pgstore.ts';
import { HttpError, Workspace } from '../src/lib/access.ts';
import { personalSpaceId } from '../src/lib/spaces.ts';
import { tarGz } from '../src/lib/tar.ts';

const VICKY = 'vicky@example.com';
const ANDREW = 'andrew@example.com';
const OUTSIDER = 'outsider@example.com';
const ALLOWED = [VICKY, ANDREW];

const makers: Record<string, () => Promise<PageStore>> = {
  files: async () => new FilePageStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wn-sp-'))),
  postgres: async () => {
    const pg = new PGlite();
    return new PgPageStore(async () => ({ query: async (t, p) => {
      const r = await pg.query(t, p as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    } }));
  },
};

const as = (store: PageStore, email: string, allowed = ALLOWED) => new Workspace(store, { email, name: email.split('@')[0] }, allowed);
const denied = (status: number) => (e: unknown) => e instanceof HttpError && e.status === status;

for (const [name, make] of Object.entries(makers)) {
  const t = (title: string, fn: (s: PageStore) => Promise<void>) => test(`[${name}] ${title}`, async () => fn(await make()));

  t('everyone gets a private Personal space with a welcome page, created once', async (s) => {
    const v = as(s, VICKY);
    const [first] = await v.spaces();
    assert.equal(first.kind, 'personal');
    assert.equal(first.id, personalSpaceId(VICKY));
    assert.deepEqual(first.members, [VICKY]);
    // two tabs opening at once must not create two welcome pages
    await Promise.all([as(s, VICKY).spaces(), as(s, VICKY).spaces(), as(s, VICKY).spaces()]);
    const pages = await as(s, VICKY).list();
    assert.equal(pages.filter((p) => p.title === 'Welcome').length, 1);
    assert.equal(pages[0].space, first.id);
  });

  t('pages from before spaces existed land in a shared TerraScape HQ space for everyone allowed', async (s) => {
    const old = await s.create({ title: 'Old HQ page' }); // no space given: legacy
    assert.equal(old.space, LEGACY_SPACE_ID);
    const spaces = await as(s, ANDREW).spaces();
    const hq = spaces.find((x) => x.id === LEGACY_SPACE_ID);
    assert.equal(hq?.name, 'TerraScape HQ');
    assert.equal(hq?.kind, 'shared');
    assert.deepEqual([...(hq?.members ?? [])].sort(), [ANDREW, VICKY]);
    assert.equal(hq?.owner, VICKY); // first allowed email
    assert.ok((await as(s, VICKY).list()).some((p) => p.id === old.id));
    assert.ok((await as(s, ANDREW).list()).some((p) => p.id === old.id));
  });

  t('nobody can read, search, change, delete or move into another person\'s Personal space', async (s) => {
    const v = as(s, VICKY);
    const a = as(s, ANDREW);
    const secret = await v.create({ title: 'Vicky secret', body: 'needle-in-private' });
    const db = await v.create({ title: 'Private db', kind: 'database' });
    const row = await v.create({ title: 'Private row', database: db.id });

    // Andrew: cannot see any of it, and cannot tell it exists
    assert.equal(await a.get(secret.id), null);
    assert.equal(await a.get(db.id), null);
    assert.equal(await a.database(db.id), null);
    assert.ok(!(await a.list()).some((p) => [secret.id, db.id, row.id].includes(p.id)));
    assert.deepEqual(await a.search('needle-in-private'), []);
    assert.deepEqual(await a.search('Private'), []);
    await assert.rejects(() => a.update(secret.id, { title: 'hacked' }), denied(404));
    await assert.rejects(() => a.remove(secret.id), denied(404));
    await assert.rejects(() => a.move(secret.id, a.personalId), denied(404));
    await assert.rejects(() => a.create({ title: 'x', parent: secret.id }), denied(404));
    const mine = await a.create({ title: 'Andrew page' });
    await assert.rejects(() => a.update(mine.id, { parent: secret.id }), denied(404)); // can't nest under a page you can't see
    await assert.rejects(() => a.create({ title: 'x', database: db.id }), denied(404));
    await assert.rejects(() => a.create({ title: 'x', space: v.personalId }), denied(404));
    await assert.rejects(() => a.list(v.personalId), denied(404));
    await assert.rejects(() => a.pagesOf(v.personalId), denied(404));
    await assert.rejects(() => a.space(v.personalId), denied(404));
    assert.equal((await s.get(secret.id))?.title, 'Vicky secret'); // untouched

    // Vicky still sees it all
    assert.equal((await v.get(secret.id))?.title, 'Vicky secret');
    assert.equal((await v.search('needle-in-private')).length, 1);

    // and a person who is not allowed in at all gets nothing from the shared space either
    const o = as(s, OUTSIDER);
    await s.create({ title: 'HQ page' });
    assert.ok(!(await o.list()).some((p) => p.title === 'HQ page'));
  });

  t('a shared space: owner invites, members see and edit, removed members lose access', async (s) => {
    const v = as(s, VICKY);
    const a = as(s, ANDREW);
    const proj = await v.createSpace('Side project', '🌱');
    assert.equal(proj.owner, VICKY);
    assert.deepEqual(proj.members, [VICKY]);
    const page = await v.create({ space: proj.id, title: 'Plan', body: 'shared-needle' });
    assert.equal(await a.get(page.id), null); // not invited yet

    await assert.rejects(() => a.addMember(proj.id, ANDREW), denied(404)); // can't even see the space
    await v.addMember(proj.id, ANDREW);
    const a2 = as(s, ANDREW);
    assert.equal((await a2.get(page.id))?.title, 'Plan');
    assert.equal((await a2.search('shared-needle')).length, 1);
    await a2.update(page.id, { title: 'Plan v2' });
    assert.equal((await v.get(page.id))?.title, 'Plan v2');

    // members can't manage people; owner can't be removed; only owner may rename
    await assert.rejects(() => a2.addMember(proj.id, ANDREW), denied(403));
    await assert.rejects(() => a2.removeMember(proj.id, VICKY), denied(400));
    await assert.rejects(() => a2.renameSpace(proj.id, { name: 'Mine now' }), denied(403));
    await assert.rejects(() => v.removeMember(proj.id, VICKY), denied(400));

    // only emails that can sign in can be added
    await assert.rejects(() => v.addMember(proj.id, 'stranger@example.com'), denied(400));
    await assert.rejects(() => v.addMember(proj.id, 'not-an-email'), denied(400));

    // Personal spaces have no members to manage
    await assert.rejects(() => v.addMember(v.personalId, ANDREW), denied(400));

    // a member can leave; the owner can remove someone
    await a2.removeMember(proj.id, ANDREW);
    assert.equal(await as(s, ANDREW).get(page.id), null);
    await v.addMember(proj.id, ANDREW);
    await v.removeMember(proj.id, ANDREW);
    assert.equal(await as(s, ANDREW).get(page.id), null);
  });

  t('sub-pages and rows stay in their parent\'s space; nesting across spaces is refused', async (s) => {
    const v = as(s, VICKY);
    const proj = await v.createSpace('Proj');
    const root = await v.create({ space: proj.id, title: 'Root' });
    const kid = await v.create({ parent: root.id, title: 'Kid' });
    assert.equal(kid.space, proj.id);
    const db = await v.create({ space: proj.id, title: 'DB', kind: 'database' });
    const row = await v.create({ database: db.id, title: 'Row' });
    assert.equal(row.space, proj.id);
    await assert.rejects(() => v.create({ parent: root.id, space: v.personalId, title: 'bad' }));
    const mine = await v.create({ title: 'In personal' });
    assert.equal(mine.space, v.personalId); // default is your Personal space
    await assert.rejects(() => v.update(mine.id, { parent: root.id }), /same space/);
  });

  t('moving a page takes its sub-pages, and a database takes its rows', async (s) => {
    const v = as(s, VICKY);
    const proj = await v.createSpace('Proj');
    const top = await v.create({ title: 'Top' });
    const kid = await v.create({ parent: top.id, title: 'Kid' });
    const db = await v.create({ title: 'Tasks', kind: 'database' });
    const row = await v.create({ database: db.id, title: 'Row' });

    const moved = await v.move(top.id, proj.id);
    assert.deepEqual([...moved].sort(), [top.id, kid.id].sort());
    assert.equal((await v.get(top.id))?.space, proj.id);
    assert.equal((await v.get(kid.id))?.space, proj.id);
    assert.equal((await v.get(kid.id))?.parent, top.id);

    await assert.rejects(() => v.move(row.id, proj.id), denied(400)); // a row can't leave its database
    await v.move(db.id, proj.id);
    assert.equal((await v.get(row.id))?.space, proj.id);
    assert.equal((await v.get(row.id))?.database, db.id);

    // a nested page becomes top-level in its new space
    const nested = await v.create({ parent: top.id, title: 'Nested' });
    await v.move(nested.id, v.personalId);
    const got = await v.get(nested.id);
    assert.equal(got?.space, v.personalId);
    assert.equal(got?.parent, null);

    // can't move into a space you aren't in
    await assert.rejects(() => v.move(top.id, as(s, ANDREW).personalId), denied(404));
  });

  t('search only looks inside your spaces (and is not crowded out by other people\'s pages)', async (s) => {
    const v = as(s, VICKY);
    const a = as(s, ANDREW);
    for (let i = 0; i < 30; i++) await a.create({ title: `andrew match ${i}`, body: 'common-word' });
    await v.create({ title: 'vicky match', body: 'common-word' });
    const hits = await v.search('common-word');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'vicky match');
    assert.equal(hits[0].space, v.personalId);
  });

  t('spaces and page spaces survive import (backups, uploads)', async (s) => {
    const v = as(s, VICKY);
    const proj = await v.createSpace('Proj');
    const p = await v.create({ space: proj.id, title: 'Keep me' });
    const full = (await s.get(p.id))!;
    await s.import({ ...full, title: 'Imported' });
    assert.equal((await s.get(p.id))?.space, proj.id);
    const [sp] = (await s.listSpaces()).filter((x) => x.id === proj.id);
    await s.saveSpace({ ...sp, name: 'Renamed' });
    assert.equal((await s.listSpaces()).find((x) => x.id === proj.id)?.name, 'Renamed');
  });
}

test('legacy files without a space field open in the legacy space; saved files carry their space', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-leg-'));
  await fs.writeFile(path.join(dir, 'abcdef0123456789.md'), '---\ntitle: Legacy\n---\nbody\n');
  const store = new FilePageStore(dir);
  assert.equal((await store.get('abcdef0123456789'))?.space, LEGACY_SPACE_ID);
  const page = await store.create({ title: 'New', space: 'u0123456789abcdef' });
  assert.match(await fs.readFile(path.join(dir, `${page.id}.md`), 'utf8'), /space: u0123456789abcdef/);
});

test('a damaged .spaces.json is an error, never silently reset', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-bad-'));
  await fs.writeFile(path.join(dir, '.spaces.json'), '{ not json');
  const store = new FilePageStore(dir);
  await assert.rejects(() => store.listSpaces());
  await assert.rejects(() => as(store, VICKY).spaces());
});

test('Postgres: an older database (no space column) is upgraded and its pages become the legacy space', async () => {
  const pg = new PGlite();
  await pg.query(`CREATE TABLE pages (id text PRIMARY KEY, title text NOT NULL, parent text, icon text NOT NULL DEFAULT '', ord double precision NOT NULL DEFAULT 0,
    created_at text NOT NULL, updated_at text NOT NULL, kind text NOT NULL DEFAULT 'page', database_id text, props jsonb NOT NULL DEFAULT '{}',
    schema jsonb, views jsonb, body text NOT NULL DEFAULT '', trashed_at text)`);
  await pg.query(`INSERT INTO pages (id, title, created_at, updated_at, body) VALUES ('oldpage000000001', 'Before spaces', 'x', 'x', 'hello')`);
  const store = new PgPageStore(async () => ({ query: async (t, p) => {
    const r = await pg.query(t, p as any[]);
    return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
  } }));
  assert.equal((await store.get('oldpage000000001'))?.space, LEGACY_SPACE_ID);
  assert.ok((await as(store, ANDREW).list()).some((p) => p.id === 'oldpage000000001'));
});

test('tar.gz export is a real archive that tar can read, with pages as plain Markdown', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-tar-'));
  const store = new FilePageStore(path.join(dir, 'src'));
  const v = as(store, VICKY);
  const page = await v.create({ title: 'Exported', body: 'hello export' });
  const full = (await v.get(page.id))!;
  const buf = tarGz([
    { name: '.spaces.json', data: '[]\n' },
    { name: `${full.id}.md`, data: pageToMarkdown(full) },
    { name: 'big.md', data: 'x'.repeat(1500) },
  ]);
  assert.equal(zlib.gunzipSync(buf).length % 512, 0);
  const file = path.join(dir, 'out.tar.gz');
  await fs.writeFile(file, buf);
  const out = path.join(dir, 'unpacked');
  await fs.mkdir(out);
  execFileSync('tar', ['-xzf', file, '-C', out]);
  const raw = await fs.readFile(path.join(out, `${full.id}.md`), 'utf8');
  assert.match(raw, /title: Exported/);
  assert.match(raw, new RegExp(`space: ${v.personalId}`));
  assert.equal((await fs.readFile(path.join(out, 'big.md'), 'utf8')).length, 1500);
  // a person's export can be opened by the app again
  const again = await new FilePageStore(out).get(full.id);
  assert.equal(again?.body.trim(), 'hello export');
});
