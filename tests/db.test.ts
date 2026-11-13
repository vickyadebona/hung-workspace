import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilePageStore } from '../src/lib/storage.ts';
import {
  applyView, coerceValue, defaultSchema, defaultViews, groupRows, mergeProps, monthGrid,
  matchesFilter, reconcileProps, sanitizeSchema, sanitizeViews,
  type PropertyDef, type Row, type View,
} from '../src/lib/dbschema.ts';

const schema: PropertyDef[] = [
  { id: 'status', name: 'Status', type: 'select', options: [
    { id: 'todo', name: 'To do', color: 'gray' }, { id: 'done', name: 'Done', color: 'green' } ] },
  { id: 'tags', name: 'Tags', type: 'multiselect', options: [
    { id: 'aaaa', name: 'A', color: 'blue' }, { id: 'bbbb', name: 'B', color: 'red' } ] },
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'cost', name: 'Cost', type: 'number' },
  { id: 'paid', name: 'Paid', type: 'checkbox' },
  { id: 'note', name: 'Note', type: 'text' },
  { id: 'link', name: 'Link', type: 'url' },
];
const def = (id: string) => schema.find((p) => p.id === id)!;
const row = (id: string, title: string, props: Row['props'] = {}): Row => ({ id, title, props, createdAt: '', updatedAt: '' });

test('coerceValue keeps valid values and empties invalid ones', () => {
  assert.equal(coerceValue(def('status'), 'done'), 'done');
  assert.equal(coerceValue(def('status'), 'nope'), null);
  assert.deepEqual(coerceValue(def('tags'), ['aaaa', 'aaaa', 'zzzz']), ['aaaa']);
  assert.equal(coerceValue(def('tags'), []), null);
  assert.equal(coerceValue(def('due'), '2026-02-30'), null); // not a real date
  assert.equal(coerceValue(def('due'), '2026-11-12'), '2026-11-12');
  assert.equal(coerceValue(def('cost'), '12.5'), 12.5);
  assert.equal(coerceValue(def('cost'), 'abc'), null);
  assert.equal(coerceValue(def('cost'), ''), null);
  assert.equal(coerceValue(def('paid'), true), true);
  assert.equal(coerceValue(def('paid'), false), null);
  assert.equal(coerceValue(def('note'), ''), null);
  assert.equal(coerceValue(def('note'), 'x'.repeat(5000))?.toString().length, 2000);
});

test('mergeProps patches, clears with null, and drops unknown keys', () => {
  const out = mergeProps(schema, { status: 'todo', cost: 5 }, { cost: null, due: '2026-01-01', evil: 'x', status: 'bogus' });
  assert.deepEqual(out, { due: '2026-01-01' });
});

test('reconcileProps removes values orphaned by a schema change', () => {
  const smaller = schema.filter((p) => p.id !== 'cost').map((p) => p.id === 'status' ? { ...p, options: [p.options![0]] } : p);
  const out = reconcileProps(smaller, { cost: 3, status: 'done', due: '2026-01-01' });
  assert.deepEqual(out, { due: '2026-01-01' });
});

test('sanitizeSchema rejects bad input', () => {
  assert.throws(() => sanitizeSchema('x'));
  assert.throws(() => sanitizeSchema([{ id: 'title', name: 'x', type: 'text' }]), /duplicate|Invalid/);
  assert.throws(() => sanitizeSchema([{ id: 'abcd', name: 'x', type: 'bogus' }]));
  assert.throws(() => sanitizeSchema([{ id: 'abcd', name: 'x', type: 'text' }, { id: 'abcd', name: 'y', type: 'text' }]));
  assert.throws(() => sanitizeSchema([{ id: '../../x', name: 'x', type: 'text' }]));
  const ok = sanitizeSchema([{ id: 'abcd', name: '  Hi  ', type: 'select', options: [{ id: 'opt1', name: 'A', color: 'neon' }] }]);
  assert.equal(ok[0].name, 'Hi');
  assert.equal(ok[0].options![0].color, 'gray');
});

test('sanitizeViews fixes references to deleted properties', () => {
  const views = sanitizeViews([
    { id: 'v1', name: 'Board', type: 'board', groupBy: 'gone', filters: [{ propId: 'gone', op: 'is', value: 'x' }, { propId: 'cost', op: 'gt', value: 3 }], sorts: [{ propId: 'gone', dir: 'asc' }] },
    { id: 'v2', name: 'Cal', type: 'calendar', dateProp: 'note', filters: [], sorts: [] },
  ].map((v) => v), schema);
  assert.equal(views[0].groupBy, 'status');
  assert.deepEqual(views[0].filters, [{ propId: 'cost', op: 'gt', value: 3 }]);
  assert.deepEqual(views[0].sorts, []);
  assert.equal(views[1].dateProp, 'due');
  assert.throws(() => sanitizeViews([], schema));
});

test('filters', () => {
  const r = row('1', 'Buy Milk', { status: 'todo', tags: ['aaaa'], due: '2026-11-12', cost: 10, paid: true, note: 'dairy' });
  const e = row('2', 'Empty');
  const f = (propId: string, op: any, value?: any) => ({ propId, op, value });
  assert.ok(matchesFilter(r, f('title', 'contains', 'milk'), schema));
  assert.ok(!matchesFilter(r, f('title', 'is', 'milk'), schema));
  assert.ok(matchesFilter(r, f('status', 'is', 'todo'), schema));
  assert.ok(matchesFilter(e, f('status', 'is_not', 'todo'), schema));
  assert.ok(matchesFilter(r, f('tags', 'contains', 'aaaa'), schema));
  assert.ok(matchesFilter(e, f('tags', 'not_contains', 'aaaa'), schema));
  assert.ok(matchesFilter(r, f('due', 'before', '2026-12-01'), schema));
  assert.ok(!matchesFilter(r, f('due', 'after', '2026-12-01'), schema));
  assert.ok(!matchesFilter(e, f('due', 'before', '2026-12-01'), schema)); // empty dates never match before/after
  assert.ok(matchesFilter(r, f('cost', 'gt', 5), schema));
  assert.ok(!matchesFilter(r, f('cost', 'lt', 5), schema));
  assert.ok(matchesFilter(r, f('paid', 'checked'), schema));
  assert.ok(matchesFilter(e, f('paid', 'unchecked'), schema));
  assert.ok(matchesFilter(e, f('note', 'empty'), schema));
  assert.ok(matchesFilter(r, f('note', 'not_empty'), schema));
  assert.ok(matchesFilter(r, f('status', 'is', ''), schema)); // unfinished filter hides nothing
  assert.ok(matchesFilter(r, f('gone', 'is', 'x'), schema)); // deleted property ignored
});

test('sort: numbers numerically, select by option order, empties last both ways', () => {
  const rows = [row('a', 'a', { cost: 10 }), row('b', 'b'), row('c', 'c', { cost: 2 }), row('d', 'd', { cost: 33 })];
  const v = (dir: 'asc' | 'desc'): View => ({ id: 'v', name: 'v', type: 'table', filters: [], sorts: [{ propId: 'cost', dir }] });
  assert.deepEqual(applyView(rows, v('asc'), schema).map((r) => r.id), ['c', 'a', 'd', 'b']);
  assert.deepEqual(applyView(rows, v('desc'), schema).map((r) => r.id), ['d', 'a', 'c', 'b']);
  const sel = [row('x', 'x', { status: 'done' }), row('y', 'y', { status: 'todo' })];
  assert.deepEqual(applyView(sel, { id: 'v', name: 'v', type: 'table', filters: [], sorts: [{ propId: 'status', dir: 'asc' }] }, schema).map((r) => r.id), ['y', 'x']);
  assert.deepEqual(applyView(rows, { id: 'v', name: 'v', type: 'table', filters: [], sorts: [{ propId: 'title', dir: 'desc' }] }, schema).map((r) => r.id), ['d', 'c', 'b', 'a']);
});

test('groupRows: option order, plus a No value column only when needed', () => {
  const rows = [row('1', '1', { status: 'done' }), row('2', '2', { status: 'todo' }), row('3', '3')];
  const g = groupRows(rows, def('status'));
  assert.deepEqual(g.map((x) => x.label), ['No status', 'To do', 'Done']);
  assert.deepEqual(g.map((x) => x.rows.length), [1, 1, 1]);
  assert.deepEqual(groupRows([rows[0]], def('status')).map((x) => x.label), ['To do', 'Done']);
});

test('monthGrid: full Sunday-first weeks, correct leap/edge months', () => {
  const nov = monthGrid(2026, 10); // Nov 2026 starts on a Sunday
  assert.equal(nov[0][0], '2026-11-01');
  assert.equal(nov.at(-1)!.at(-1), '2026-12-05');
  assert.ok(nov.every((w) => w.length === 7));
  const feb = monthGrid(2024, 1); // leap year
  assert.ok(feb.flat().includes('2024-02-29'));
  assert.equal(feb[0][0], '2024-01-28');
  const dec = monthGrid(2026, 11);
  assert.ok(dec.flat().includes('2026-12-31'));
});

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-db-'));
  return { dir, store: new FilePageStore(dir) };
}

test('create database with defaults, add rows, values survive the Markdown round trip', async () => {
  const { dir, store } = await tmpStore();
  const db = await store.create({ title: 'Tasks', kind: 'database' });
  assert.equal(db.kind, 'database');
  assert.deepEqual(db.schema, defaultSchema());
  assert.deepEqual(db.views, defaultViews(db.schema!));
  const r = await store.create({ database: db.id, title: 'Pay rent', props: { status: 'doing', date: '2026-11-30', bogus: 1 } });
  const back = await store.get(r.id);
  assert.deepEqual(back?.props, { status: 'doing', date: '2026-11-30' }); // date stays a string, unknown key dropped
  assert.equal(back?.database, db.id);
  const raw = await fs.readFile(path.join(dir, `${r.id}.md`), 'utf8');
  assert.match(raw, /database: /);
  assert.match(raw, /status: doing/);
});

test('tricky option ids and values survive YAML (yes/no/null/true/numeric-looking)', async () => {
  const { store } = await tmpStore();
  const schema = [{ id: 'sel1', name: 'S', type: 'select', options: [
    { id: 'yes', name: 'Yes', color: 'green' }, { id: 'no', name: 'No', color: 'red' },
    { id: 'null', name: 'Null', color: 'gray' }, { id: 'true', name: 'True', color: 'blue' },
    { id: '12345678', name: 'Num', color: 'pink' } ] },
    { id: 'txt1', name: 'T', type: 'text' }, { id: 'dat1', name: 'D', type: 'date' }];
  const db = await store.create({ kind: 'database', title: 'Odd', schema });
  for (const opt of ['yes', 'no', 'null', 'true', '12345678']) {
    const r = await store.create({ database: db.id, title: opt, props: { sel1: opt, txt1: opt === 'null' ? 'null' : 'a: b # c', dat1: '2026-01-02' } });
    const g = await store.get(r.id);
    assert.equal(g?.props.sel1, opt, `select ${opt}`);
    assert.equal(g?.props.dat1, '2026-01-02');
  }
  const reread = await store.get(db.id);
  assert.deepEqual(reread?.schema, db.schema);
});

test('props-only edits do not change updatedAt (no false conflicts)', async () => {
  const { store } = await tmpStore();
  const db = await store.create({ kind: 'database' });
  const r = await store.create({ database: db.id, title: 'x' });
  const u = await store.update(r.id, { props: { status: 'done' } }, { baseUpdatedAt: r.updatedAt });
  assert.equal(u.updatedAt, r.updatedAt);
  const t = await store.update(r.id, { title: 'y' }, { baseUpdatedAt: r.updatedAt });
  assert.ok(t.updatedAt > r.updatedAt);
});

test('changing the schema cleans row values and view references', async () => {
  const { store } = await tmpStore();
  const db = await store.create({ kind: 'database' });
  const r = await store.create({ database: db.id, title: 'x', props: { status: 'done', date: '2026-01-01' } });
  const newSchema = db.schema!.filter((p) => p.id !== 'status'); // delete the Status property
  const updated = await store.update(db.id, { schema: newSchema });
  assert.equal(updated.schema!.length, 1);
  assert.ok(updated.views!.every((v) => v.type !== 'board' || v.groupBy === undefined)); // board has nothing left to group by
  assert.deepEqual((await store.get(r.id))!.props, { date: '2026-01-01' });
});

test('rows cannot be created in a normal page, nested, or given a schema', async () => {
  const { store } = await tmpStore();
  const page = await store.create({ title: 'plain' });
  await assert.rejects(store.create({ database: page.id, title: 'x' }), /Database not found/);
  await assert.rejects(store.create({ database: 'nope12345', title: 'x' }), /Database not found/);
  await assert.rejects(store.update(page.id, { schema: [] }), /Only databases/);
  await assert.rejects(store.update(page.id, { props: { a: 1 } }), /Only database rows/);
  const db = await store.create({ kind: 'database' });
  const r = await store.create({ database: db.id });
  await assert.rejects(store.update(r.id, { parent: page.id }), /Rows cannot be moved/);
  await assert.rejects(store.create({ parent: r.id, title: 'child of a row' }), /Parent page not found/);
});

test('deleting a database removes its rows (to trash) and nothing else', async () => {
  const { dir, store } = await tmpStore();
  const keep = await store.create({ title: 'keep' });
  const db = await store.create({ kind: 'database' });
  const r1 = await store.create({ database: db.id, title: '1' });
  const r2 = await store.create({ database: db.id, title: '2' });
  const removed = await store.remove(db.id);
  assert.deepEqual(new Set(removed), new Set([db.id, r1.id, r2.id]));
  assert.deepEqual((await store.list()).map((p) => p.id), [keep.id]);
  assert.equal((await fs.readdir(path.join(dir, '.trash'))).length, 3);
});

test('search finds rows by title and by body and labels them with their database', async () => {
  const { store } = await tmpStore();
  const db = await store.create({ kind: 'database', title: 'Groceries' });
  await store.create({ database: db.id, title: 'Oat milk' });
  const r = await store.search('oat');
  assert.equal(r.length, 1);
  assert.equal(r[0].database, db.id);
  assert.equal(r[0].snippet, 'in Groceries');
});

test('a hand-broken schema still opens with defaults', async () => {
  const { dir, store } = await tmpStore();
  const db = await store.create({ kind: 'database' });
  const f = path.join(dir, `${db.id}.md`);
  const raw = await fs.readFile(f, 'utf8');
  await fs.writeFile(f, raw.replace(/schema:[\s\S]*?\nviews:/, 'schema: oops\nviews:'));
  const got = await store.get(db.id);
  assert.deepEqual(got?.schema, defaultSchema());
});
