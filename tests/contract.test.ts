import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ConflictError, FilePageStore, type PageStore } from '../src/lib/storage.ts';
import { PgPageStore } from '../src/lib/pgstore.ts';

/** The same behaviour checks run against every store, so Mac (files) and Vercel (Postgres) can't drift apart. */
const makers: Record<string, () => Promise<PageStore>> = {
  files: async () => new FilePageStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wn-c-'))),
  postgres: async () => {
    const pg = new PGlite();
    return new PgPageStore(async () => ({ query: async (t, p) => {
      const r = await pg.query(t, p as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    } }));
  },
};

for (const [name, make] of Object.entries(makers)) {
  const t = (title: string, fn: (s: PageStore) => Promise<void>) => test(`[${name}] ${title}`, async () => fn(await make()));

  t('create, nest, list without bodies, order', async (s) => {
    const a = await s.create({ title: 'A', body: '# hi' });
    const b = await s.create({ title: 'B', parent: a.id });
    const c = await s.create({ title: 'C' });
    const list = await s.list();
    assert.deepEqual(list.map((p) => p.title), ['A', 'B', 'C']);
    assert.equal('body' in list[0], false);
    assert.equal(list.find((p) => p.id === b.id)?.parent, a.id);
    assert.equal((await s.get(a.id))?.body.trim(), '# hi');
    assert.equal(await s.get('nope1234'), null);
    assert.ok(c.order > a.order);
  });

  t('optimistic concurrency: stale body save is refused, fresh one accepted', async (s) => {
    const a = await s.create({ title: 'A', body: 'one' });
    const u1 = await s.update(a.id, { body: 'two' }, { baseUpdatedAt: a.updatedAt });
    await assert.rejects(() => s.update(a.id, { body: 'three' }, { baseUpdatedAt: a.updatedAt }), ConflictError);
    assert.equal((await s.get(a.id))?.body.trim(), 'two');
    const u2 = await s.update(a.id, { body: 'four' }, { baseUpdatedAt: u1.updatedAt });
    assert.ok(u2.updatedAt > u1.updatedAt);
  });

  t('databases: rows, props, select ids, props edits do not bump updatedAt', async (s) => {
    const db = await s.create({ title: 'Tasks', kind: 'database' });
    assert.ok(db.schema?.length && db.views?.length);
    const row = await s.create({ title: 'Do it', database: db.id, props: { status: 'doing', date: '2026-11-20' } });
    assert.equal(row.props.status, 'doing');
    const after = await s.update(row.id, { props: { status: 'done' } });
    assert.equal(after.props.status, 'done');
    assert.equal(after.updatedAt, row.updatedAt);
    assert.equal(after.props.date, '2026-11-20');
    await assert.rejects(() => s.create({ title: 'x', database: 'missing000' }));
  });

  t('schema change reconciles rows; views follow schema', async (s) => {
    const db = await s.create({ title: 'T', kind: 'database' });
    const row = await s.create({ database: db.id, props: { status: 'done' } });
    await s.update(db.id, { schema: [{ id: 'date', name: 'Date', type: 'date' }] });
    const r = await s.get(row.id);
    assert.equal('status' in (r?.props ?? {}), false);
    const d = await s.get(db.id);
    assert.ok(d?.views?.every((v) => v.type !== 'board' || !v.groupBy));
  });

  t('delete removes subpages and database rows, listing hides them', async (s) => {
    const db = await s.create({ title: 'DB', kind: 'database' });
    const r1 = await s.create({ database: db.id });
    const p = await s.create({ title: 'P' });
    const kid = await s.create({ title: 'K', parent: p.id });
    const gone = await s.remove(db.id);
    assert.deepEqual(new Set(gone), new Set([db.id, r1.id]));
    assert.equal(await s.get(r1.id), null);
    assert.deepEqual(new Set(await s.remove(p.id)), new Set([p.id, kid.id]));
    assert.equal((await s.list()).length, 0);
    assert.deepEqual(await s.remove('missing000'), []);
  });

  t('cannot nest a page inside itself or its descendant', async (s) => {
    const a = await s.create({ title: 'A' });
    const b = await s.create({ title: 'B', parent: a.id });
    await assert.rejects(() => s.update(a.id, { parent: b.id }));
    await assert.rejects(() => s.update(a.id, { parent: a.id }));
  });

  t('search: title, body, row-in-database label, % and _ are literal', async (s) => {
    const db = await s.create({ title: 'Ideas', kind: 'database' });
    await s.create({ title: 'Greenhouse', database: db.id });
    await s.create({ title: 'Notes', body: 'quarterly planning zebra 100% done' });
    assert.equal((await s.search('zebra'))[0]?.title, 'Notes');
    const g = (await s.search('greenhouse'))[0];
    assert.equal(g.snippet, 'in Ideas');
    assert.equal(g.database, db.id);
    assert.equal((await s.search('100%')).length, 1);
    assert.equal((await s.search('%')).length, 1);
    assert.deepEqual(await s.search('   '), []);
  });

  t('import keeps ids and timestamps; re-import replaces', async (s) => {
    const page = { id: 'abcdef0123456789', space: 'terrascapehq', title: 'Old', parent: null, icon: '🌿', order: 3, createdAt: '2020-01-02T03:04:05.000Z', updatedAt: '2021-01-02T03:04:05.000Z', kind: 'page' as const, database: null, props: {}, body: 'text' };
    await s.import(page);
    const got = await s.get(page.id);
    assert.deepEqual({ ...got, body: got?.body.trim() }, page);
    await s.import({ ...page, title: 'New' });
    assert.equal((await s.get(page.id))?.title, 'New');
    assert.equal((await s.list()).length, 1);
  });

  t('concurrent property edits on different rows and same row all land', async (s) => {
    const db = await s.create({ title: 'T', kind: 'database' });
    const rows = await Promise.all([1, 2, 3, 4].map((i) => s.create({ title: `r${i}`, database: db.id })));
    await Promise.all(rows.map((r, i) => s.update(r.id, { props: { date: `2026-11-0${i + 1}` } })));
    await Promise.all([s.update(rows[0].id, { props: { status: 'done' } }), s.update(rows[0].id, { title: 'renamed' })]);
    const r0 = await s.get(rows[0].id);
    assert.equal(r0?.title, 'renamed');
    assert.equal(r0?.props.status, 'done');
    assert.equal((await s.get(rows[3].id))?.props.date, '2026-11-04');
  });
}
