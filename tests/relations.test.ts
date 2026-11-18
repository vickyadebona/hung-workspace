import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { FilePageStore, type PageStore } from '../src/lib/storage.ts';
import { PgPageStore } from '../src/lib/pgstore.ts';
import { HttpError, Workspace } from '../src/lib/access.ts';
import { coerceValue, deriveRows, matchesFilter, nestRows, rollupValue, sanitizeSchema, type PropertyDef, type Row } from '../src/lib/dbschema.ts';

const VICKY = 'vicky@example.com';
const ANDREW = 'andrew@example.com';
const ALLOWED = [VICKY, ANDREW];
const DB_A = 'aaaaaaaa11112222';
const DB_B = 'bbbbbbbb11112222';

/* ------------------------------ pure schema logic ------------------------------ */

test('schema: relation and rollup need their settings; dangling rollups are dropped', () => {
  assert.throws(() => sanitizeSchema([{ id: 'r', name: 'R', type: 'relation' }]), /database/);
  assert.throws(() => sanitizeSchema([{ id: 'u', name: 'U', type: 'rollup', rollup: { relation: 'x', fn: 'nope' } }]), /calculation/);
  const ok = sanitizeSchema([
    { id: 'rel', name: 'Tasks', type: 'relation', relation: { database: DB_A } },
    { id: 'cnt', name: 'Count', type: 'rollup', rollup: { relation: 'rel', fn: 'count' } },
    { id: 'orphan', name: 'Orphan', type: 'rollup', rollup: { relation: 'gone', fn: 'count' } },
  ]);
  assert.deepEqual(ok.map((d) => d.id), ['rel', 'cnt']);
});

test('values: person emails, relation ids, single links; worked-out properties never accept writes', () => {
  const person: PropertyDef = { id: 'p', name: 'Owner', type: 'person' };
  assert.deepEqual(coerceValue(person, [' Vicky@Example.com ', 'vicky@example.com', 'bad', 5]), ['vicky@example.com']);
  assert.equal(coerceValue(person, []), null);
  const rel: PropertyDef = { id: 'r', name: 'R', type: 'relation', relation: { database: DB_A } };
  assert.deepEqual(coerceValue(rel, ['abcdef0123456789', 'abcdef0123456789', 'x']), ['abcdef0123456789']);
  const one: PropertyDef = { ...rel, relation: { database: DB_A, single: true } };
  assert.deepEqual(coerceValue(one, ['abcdef0123456789', 'fedcba9876543210']), ['abcdef0123456789']);
  const other: PropertyDef = { ...rel, relation: { database: DB_A, reverseOf: 'fwd' } };
  assert.equal(coerceValue(other, ['abcdef0123456789']), null);
  assert.equal(coerceValue({ id: 'u', name: 'U', type: 'rollup', rollup: { relation: 'r', fn: 'count' } }, 5), null);
});

const row = (id: string, props: Row['props'], title = id): Row => ({ id, title, props, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

test('rollups: count, percent, sum, average, min, max, earliest, latest', () => {
  const schema: PropertyDef[] = [
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'status', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'fin', name: 'Finished', color: 'green' }] },
    { id: 'hours', name: 'Hours', type: 'number' },
    { id: 'due', name: 'Due', type: 'date' },
  ];
  const kids = [
    row('k1', { done: true, status: 'fin', hours: 2, due: '2026-03-02' }),
    row('k2', { status: 'todo', hours: 4, due: '2026-03-09' }),
    row('k3', { done: true, status: 'fin' }),
    row('k4', {}),
  ];
  const r = (fn: any, target?: string, options?: string[]) => rollupValue({ relation: 'x', fn, target, options }, kids, schema);
  assert.equal(r('count'), 4);
  assert.equal(r('percent_checked', 'done'), 50);
  assert.equal(r('percent_option', 'status', ['fin']), 50);
  assert.equal(r('sum', 'hours'), 6);
  assert.equal(r('avg', 'hours'), 3);
  assert.equal(r('min', 'hours'), 2);
  assert.equal(r('max', 'hours'), 4);
  assert.equal(r('earliest', 'due'), '2026-03-02');
  assert.equal(r('latest', 'due'), '2026-03-09');
  assert.equal(rollupValue({ relation: 'x', fn: 'percent_checked', target: 'done' }, [], schema), null);
  assert.equal(rollupValue({ relation: 'x', fn: 'count' }, [], schema), 0);
  assert.equal(r('sum', 'nonexistent'), null);
});

test('filters understand people and worked-out numbers', () => {
  const schema: PropertyDef[] = [
    { id: 'who', name: 'Owner', type: 'person' },
    { id: 'pct', name: 'Progress', type: 'rollup', rollup: { relation: 'r', fn: 'percent_checked', target: 'd' } },
  ];
  const a = row('a', { who: [VICKY, ANDREW], pct: 60 });
  const b = row('b', {});
  assert.equal(matchesFilter(a, { propId: 'who', op: 'contains', value: ANDREW }, schema), true);
  assert.equal(matchesFilter(b, { propId: 'who', op: 'contains', value: ANDREW }, schema), false);
  assert.equal(matchesFilter(b, { propId: 'who', op: 'empty' }, schema), true);
  assert.equal(matchesFilter(a, { propId: 'pct', op: 'gt', value: 50 }, schema), true);
  assert.equal(matchesFilter(a, { propId: 'pct', op: 'lt', value: 50 }, schema), false);
});

test('nesting: children under parents, orphans stay on top, loops cannot hang', () => {
  const rows = [row('p', {}), row('c1', { parent: ['p'] }), row('c2', { parent: ['c1'] }), row('x', { parent: ['gone'] }), row('l1', { parent: ['l2'] }), row('l2', { parent: ['l1'] })];
  const flat = nestRows(rows, 'parent').map((n) => `${n.depth}:${n.row.id}`);
  assert.deepEqual(flat.slice(0, 4), ['0:p', '1:c1', '2:c2', '0:x']);
  assert.equal(new Set(flat.map((f) => f.split(':')[1])).size, rows.length); // each row exactly once, even the loop
});

/* ------------------------------ through the stores ------------------------------ */

const makers: Record<string, () => Promise<PageStore>> = {
  files: async () => new FilePageStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wn-rel-'))),
  postgres: async () => {
    const pg = new PGlite();
    return new PgPageStore(async () => ({ query: async (t, p) => {
      const r = await pg.query(t, p as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    } }));
  },
};
const as = (store: PageStore, email: string) => new Workspace(store, { email, name: email.split('@')[0] }, ALLOWED);
const denied = (status: number) => (e: unknown) => e instanceof HttpError && e.status === status;

for (const [name, make] of Object.entries(makers)) {
  const t = (title: string, fn: (s: PageStore) => Promise<void>) => test(`[${name}] ${title}`, async () => fn(await make()));

  async function projectsAndTasks(s: PageStore) {
    const v = as(s, VICKY);
    const projects = await v.create({ title: 'Projects', kind: 'database' });
    const tasks = await v.create({ title: 'Tasks', kind: 'database' });
    const { property } = await v.addRelation(tasks.id, { name: 'Project', target: projects.id, twoWay: true, reverseName: 'Tasks' });
    const proj = (await v.get(projects.id))!;
    const reverse = proj.schema!.find((d) => d.relation?.reverseOf === property.id)!;
    return { v, projects, tasks, forward: property, reverse };
  }

  t('a two-way relation adds both sides; the other side is worked out, never stored', async (s) => {
    const { v, projects, tasks, forward, reverse } = await projectsAndTasks(s);
    assert.equal(forward.relation?.database, projects.id);
    assert.equal(reverse.relation?.database, tasks.id);
    const p1 = await v.create({ database: projects.id, title: 'Launch' });
    const t1 = await v.create({ database: tasks.id, title: 'Write copy', props: { [forward.id]: [p1.id] } });
    const t2 = await v.create({ database: tasks.id, title: 'Ship', props: { [forward.id]: [p1.id] } });

    const dbView = await v.database(projects.id);
    assert.deepEqual([...(dbView!.rows[0].props[reverse.id] as string[])].sort(), [t1.id, t2.id].sort());
    const rowPage = await v.get(p1.id);
    assert.equal((rowPage!.props[reverse.id] as string[]).length, 2);
    // nothing about the reverse side was written to the project row itself
    assert.equal((await s.get(p1.id))!.props[reverse.id], undefined);
  });

  t('editing the other side updates the rows that hold the links (and a single link replaces)', async (s) => {
    const { v, projects, tasks, forward, reverse } = await projectsAndTasks(s);
    const p1 = await v.create({ database: projects.id, title: 'P1' });
    const p2 = await v.create({ database: projects.id, title: 'P2' });
    const t1 = await v.create({ database: tasks.id, title: 'T1' });
    const t2 = await v.create({ database: tasks.id, title: 'T2' });

    await v.update(p1.id, { props: { [reverse.id]: [t1.id, t2.id] } });
    assert.deepEqual((await s.get(t1.id))!.props[forward.id], [p1.id]);
    assert.deepEqual((await s.get(t2.id))!.props[forward.id], [p1.id]);
    await v.update(p1.id, { props: { [reverse.id]: [t2.id] } }); // t1 unlinked
    assert.equal((await s.get(t1.id))!.props[forward.id], undefined);
    assert.deepEqual((await v.get(p1.id))!.props[reverse.id], [t2.id]);
    // linking t2 to a second project from that side moves it when the link allows only one
    await v.update(tasks.id, { schema: (await v.get(tasks.id))!.schema!.map((d) => (d.id === forward.id ? { ...d, relation: { ...d.relation, single: true } } : d)) });
    await v.update(p2.id, { props: { [reverse.id]: [t2.id] } });
    assert.deepEqual((await s.get(t2.id))!.props[forward.id], [p2.id]);
    assert.deepEqual((await v.get(p1.id))!.props[reverse.id] ?? [], []);
  });

  t('links to rows that do not exist (or belong to another database) are dropped', async (s) => {
    const { v, projects, tasks, forward } = await projectsAndTasks(s);
    const p1 = await v.create({ database: projects.id, title: 'P1' });
    const other = await v.create({ title: 'Other db', kind: 'database' });
    const stray = await v.create({ database: other.id, title: 'Stray' });
    const task = await v.create({ database: tasks.id, title: 'T', props: { [forward.id]: [p1.id, stray.id, 'aaaaaaaaaaaaaaaa'] } });
    assert.deepEqual(task.props[forward.id], [p1.id]);
  });

  t('rollups work over the other side and over plain relations', async (s) => {
    const { v, projects, tasks, reverse } = await projectsAndTasks(s);
    const done = { id: 'isdone', name: 'Done', type: 'checkbox' as const };
    const hours = { id: 'hrs', name: 'Hours', type: 'number' as const };
    await v.update(tasks.id, { schema: [...(await v.get(tasks.id))!.schema!, done, hours] });
    const fwd = (await v.get(tasks.id))!.schema!.find((d) => d.type === 'relation')!;
    const roll: PropertyDef[] = [
      { id: 'prog', name: 'Progress', type: 'rollup', rollup: { relation: reverse.id, target: 'isdone', fn: 'percent_checked' } },
      { id: 'tot', name: 'Hours', type: 'rollup', rollup: { relation: reverse.id, target: 'hrs', fn: 'sum' } },
    ];
    await v.update(projects.id, { schema: [...(await v.get(projects.id))!.schema!, ...roll] });
    const p1 = await v.create({ database: projects.id, title: 'P1' });
    await v.create({ database: tasks.id, title: 'a', props: { [fwd.id]: [p1.id], isdone: true, hrs: 3 } });
    await v.create({ database: tasks.id, title: 'b', props: { [fwd.id]: [p1.id], hrs: 5 } });
    const rows = (await v.database(projects.id))!.rows;
    assert.equal(rows[0].props.prog, 50);
    assert.equal(rows[0].props.tot, 8);
    // rollups never accept writes
    const saved = await v.update(p1.id, { props: { prog: 99 } });
    assert.equal(saved.props.prog, 50);
  });

  t('deleting the relation removes the other side and rollups built on it', async (s) => {
    const { v, projects, tasks, forward, reverse } = await projectsAndTasks(s);
    await v.update(projects.id, { schema: [...(await v.get(projects.id))!.schema!, { id: 'cnt', name: 'N', type: 'rollup', rollup: { relation: reverse.id, fn: 'count' } }] });
    const remaining = (await v.get(tasks.id))!.schema!.filter((d) => d.id !== forward.id);
    await v.update(tasks.id, { schema: remaining });
    const proj = (await v.get(projects.id))!;
    assert.ok(!proj.schema!.some((d) => d.id === reverse.id));
    assert.ok(!proj.schema!.some((d) => d.id === 'cnt')); // its relation is gone, so it goes too
  });

  t('sub-items: a database linked to itself with a single parent', async (s) => {
    const v = as(s, VICKY);
    const db = await v.create({ title: 'Tasks', kind: 'database' });
    const { property } = await v.addRelation(db.id, { name: 'Parent', target: db.id, twoWay: true, reverseName: 'Sub-items', single: true });
    const fresh = (await v.get(db.id))!;
    const subs = fresh.schema!.find((d) => d.relation?.reverseOf === property.id)!;
    const a = await v.create({ database: db.id, title: 'A' });
    const b = await v.create({ database: db.id, title: 'B', props: { [property.id]: [a.id] } });
    await v.update(db.id, { views: [{ id: 'table', name: 'Table', type: 'table', filters: [], sorts: [], nestBy: property.id }] });
    assert.equal((await v.get(db.id))!.views![0].nestBy, property.id);
    assert.deepEqual((await v.get(a.id))!.props[subs.id], [b.id]);
    assert.deepEqual((await s.get(b.id))!.props[property.id], [a.id]);
  });

  t('relations stay inside one space: cross-space links are refused and linked databases cannot be moved away', async (s) => {
    const v = as(s, VICKY);
    const other = await v.createSpace('Other');
    const inPersonal = await v.create({ title: 'Mine', kind: 'database' });
    const inOther = await v.create({ title: 'Theirs', kind: 'database', space: other.id });
    await assert.rejects(() => v.addRelation(inPersonal.id, { name: 'X', target: inOther.id, twoWay: false }), /same space/);
    const { projects } = await projectsAndTasks(s);
    await assert.rejects(() => v.move(projects.id, other.id), /linked to another database/);
  });

  t('people: your name is remembered and members are listed by name', async (s) => {
    const v = as(s, VICKY);
    const proj = await v.createSpace('Team');
    await v.addMember(proj.id, ANDREW);
    const people = await v.people();
    assert.equal(people[VICKY], 'vicky');
    assert.equal(people[ANDREW], 'andrew'); // not signed in yet: falls back to the part before the @
    const people2 = await new Workspace(s, { email: ANDREW, name: 'Andrew Hung' }, ALLOWED).people();
    assert.equal(people2[ANDREW], 'Andrew Hung');
    assert.equal((await v.people())[ANDREW], 'Andrew Hung');
  });

  t('other people cannot see relations, rollups or rows from your Personal space', async (s) => {
    const { v, projects } = await projectsAndTasks(s);
    await v.create({ database: projects.id, title: 'Secret project' });
    const a = as(s, ANDREW);
    assert.equal(await a.database(projects.id), null);
    await assert.rejects(() => a.addRelation(projects.id, { name: 'X', target: projects.id, twoWay: false }), denied(404));
    await assert.rejects(() => a.addRelation(a.personalId, { name: 'X', target: projects.id, twoWay: false }), denied(404));
  });
}

test('derive: a rollup can summarise rows of the same database (sub-item progress)', () => {
  const schema: PropertyDef[] = [
    { id: 'parent', name: 'Parent', type: 'relation', relation: { database: DB_A, single: true } },
    { id: 'subs', name: 'Sub-items', type: 'relation', relation: { database: DB_A, reverseOf: 'parent' } },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'pct', name: 'Progress', type: 'rollup', rollup: { relation: 'subs', target: 'done', fn: 'percent_checked' } },
  ];
  const rows = [row('p1', {}), row('c1', { parent: ['p1'], done: true }), row('c2', { parent: ['p1'] })];
  const out = deriveRows(schema, rows, { rowsOf: () => rows, schemaOf: () => schema });
  assert.equal(out.find((r) => r.id === 'p1')!.props.pct, 50);
  assert.deepEqual(out.find((r) => r.id === 'p1')!.props.subs, ['c1', 'c2']);
  assert.equal(out.find((r) => r.id === 'c1')!.props.pct, undefined);
});
