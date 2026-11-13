import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilePageStore, ConflictError } from '../src/lib/storage.ts';

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-'));
  return { dir, store: new FilePageStore(dir) };
}

test('create, read back, list', async () => {
  const { store } = await tmpStore();
  const a = await store.create({ title: 'A', body: '# Hello\n\n- [ ] task' });
  const got = await store.get(a.id);
  assert.equal(got?.title, 'A');
  assert.equal(got?.body.trim(), '# Hello\n\n- [ ] task');
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal('body' in list[0], false);
});

test('pages are plain markdown files with frontmatter', async () => {
  const { dir, store } = await tmpStore();
  const a = await store.create({ title: 'Plain', body: 'text' });
  const raw = await fs.readFile(path.join(dir, `${a.id}.md`), 'utf8');
  assert.match(raw, /^---\n/);
  assert.match(raw, /title: Plain/);
  assert.match(raw, /\ntext\n$/);
});

test('titles with colons and quotes survive', async () => {
  const { store } = await tmpStore();
  const a = await store.create({ title: 'Plan: "Q1" #goals', body: '' });
  assert.equal((await store.get(a.id))?.title, 'Plan: "Q1" #goals');
});

test('nesting, ordering and delete removes descendants (to trash)', async () => {
  const { dir, store } = await tmpStore();
  const root = await store.create({ title: 'Root' });
  const child = await store.create({ title: 'Child', parent: root.id });
  const grand = await store.create({ title: 'Grand', parent: child.id });
  const other = await store.create({ title: 'Other' });
  const removed = await store.remove(root.id);
  assert.deepEqual(new Set(removed), new Set([root.id, child.id, grand.id]));
  assert.deepEqual((await store.list()).map((p) => p.id), [other.id]);
  const trash = await fs.readdir(path.join(dir, '.trash'));
  assert.equal(trash.length, 3);
});

test('cannot move a page inside its own descendant', async () => {
  const { store } = await tmpStore();
  const a = await store.create({ title: 'A' });
  const b = await store.create({ title: 'B', parent: a.id });
  await assert.rejects(store.update(a.id, { parent: b.id }), /inside itself/);
  await assert.rejects(store.update(a.id, { parent: a.id }), /own parent/);
});

test('stale save is rejected with a conflict, fresh save passes', async () => {
  const { store } = await tmpStore();
  const a = await store.create({ title: 'A', body: 'one' });
  const first = await store.update(a.id, { body: 'two' }, { baseUpdatedAt: a.updatedAt });
  await assert.rejects(
    store.update(a.id, { body: 'three' }, { baseUpdatedAt: a.updatedAt }),
    (e) => e instanceof ConflictError && e.current.body.trim() === 'two',
  );
  const next = await store.update(a.id, { body: 'three' }, { baseUpdatedAt: first.updatedAt });
  assert.equal(next.body.trim(), 'three');
});

test('rapid saves still get strictly increasing timestamps', async () => {
  const { store } = await tmpStore();
  const a = await store.create({ title: 'A' });
  let base = a.updatedAt;
  for (let i = 0; i < 5; i++) {
    const p = await store.update(a.id, { body: String(i) }, { baseUpdatedAt: base });
    assert.ok(p.updatedAt > base);
    base = p.updatedAt;
  }
});

test('search finds title and body, ranks title first', async () => {
  const { store } = await tmpStore();
  await store.create({ title: 'Groceries', body: 'milk and eggs' });
  await store.create({ title: 'Milk run', body: 'nothing' });
  const r = await store.search('milk');
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Milk run');
  assert.deepEqual(await store.search('   '), []);
});

test('rejects path-traversal ids', async () => {
  const { store } = await tmpStore();
  assert.equal(await store.get('../../etc/passwd'), null);
  await assert.rejects(store.update('../x', { title: 'x' }), /Invalid|not found/);
});
