import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilePageStore } from '../src/lib/storage.ts';
import { Workspace } from '../src/lib/access.ts';
import { bucketOf, collectMyTasks, taskShape } from '../src/lib/mytasks.ts';
import type { PropertyDef } from '../src/lib/dbschema.ts';

const VICKY = 'vicky@example.com';
const ANDREW = 'andrew@example.com';
const ALLOWED = [VICKY, ANDREW];
const as = (s: FilePageStore, email: string) => new Workspace(s, { email, name: email.split('@')[0] }, ALLOWED);
const tmp = async () => new FilePageStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wn-mt-')));

test('the shape of a task database is found from property names and types', () => {
  const schema: PropertyDef[] = [
    { id: 'who', name: 'Assignee', type: 'person' },
    { id: 'st', name: 'Status', type: 'select', options: [{ id: 'a', name: 'To do', color: 'gray' }, { id: 'b', name: 'Done', color: 'green' }] },
    { id: 'pr', name: 'Priority', type: 'select', options: [{ id: 'h', name: 'High', color: 'red' }] },
    { id: 'd1', name: 'Created', type: 'date' },
    { id: 'd2', name: 'Due date', type: 'date' },
  ];
  const shape = taskShape(schema);
  assert.equal(shape.status?.id, 'st');
  assert.equal(shape.priority?.id, 'pr');
  assert.equal(shape.due?.id, 'd2'); // "Due date" beats the first date property
  assert.equal(shape.people.length, 1);
});

test('buckets: overdue, today, this week, later, no date', () => {
  const today = '2026-11-18';
  assert.equal(bucketOf('2026-11-17', today), 'overdue');
  assert.equal(bucketOf('2026-11-18', today), 'today');
  assert.equal(bucketOf('2026-11-25', today), 'week');
  assert.equal(bucketOf('2026-11-26', today), 'later');
  assert.equal(bucketOf(null, today), 'nodate');
});

test('tasks assigned to you are collected from every database in your spaces, and only yours', async () => {
  const s = await tmp();
  const v = as(s, VICKY);
  const a = as(s, ANDREW);
  const hq = await v.createSpace('HQ');
  await v.addMember(hq.id, ANDREW);
  const board = await v.create({ space: hq.id, title: 'Plan tasks', kind: 'database' });
  const fresh = (await v.get(board.id))!;
  await v.update(board.id, {
    schema: [
      ...fresh.schema!,
      { id: 'owner', name: 'Owner', type: 'person' },
      { id: 'due2', name: 'Due', type: 'date' },
    ],
  });
  const done = (await v.get(board.id))!.schema!.find((d) => d.id === 'status')!.options!.find((o) => o.name === 'Done')!.id;
  const t1 = await v.create({ database: board.id, title: 'Mine, late', props: { owner: [VICKY], due2: '2020-01-01' } });
  const t2 = await v.create({ database: board.id, title: 'Both of us', props: { owner: [VICKY, ANDREW], status: done } });
  await v.create({ database: board.id, title: 'Only Andrew', props: { owner: [ANDREW] } });
  await v.create({ database: board.id, title: 'Nobody' });

  const mine = await v.myTasks();
  assert.deepEqual(mine.map((t) => t.title).sort(), ['Both of us', 'Mine, late']);
  const late = mine.find((t) => t.id === t1.id)!;
  assert.equal(late.due, '2020-01-01');
  assert.equal(late.done, false);
  assert.equal(late.spaceName, 'HQ');
  const both = mine.find((t) => t.id === t2.id)!;
  assert.equal(both.done, true);
  assert.deepEqual(both.toggle, { propId: 'status', done, open: 'todo' });
  assert.deepEqual((await a.myTasks()).map((t) => t.title).sort(), ['Both of us', 'Only Andrew']);
});

test('your list never includes tasks from spaces you are not in', async () => {
  const s = await tmp();
  const v = as(s, VICKY);
  const a = as(s, ANDREW);
  const secret = await v.create({ title: 'Private db', kind: 'database' });
  await v.update(secret.id, { schema: [...(await v.get(secret.id))!.schema!, { id: 'who', name: 'Owner', type: 'person' }] });
  await v.create({ database: secret.id, title: 'Vicky private task', props: { who: [ANDREW] } }); // even if Andrew's email is on it
  assert.equal((await a.myTasks()).length, 0);
  assert.equal((await v.myTasks()).length, 0); // not Vicky's either: she isn't on it
});

test('adding a task creates your My tasks database once, assigned to you', async () => {
  const s = await tmp();
  const v = as(s, VICKY);
  const t1 = await v.addMyTask('Buy tape', '2026-12-01');
  const t2 = await v.addMyTask('  Call supplier  ');
  assert.equal(t1.due, '2026-12-01');
  assert.equal(t1.spaceName, 'Personal');
  assert.equal(t2.title, 'Call supplier');
  assert.equal(t2.due, null);
  const dbs = (await s.list()).filter((p) => p.kind === 'database' && p.title === 'My tasks');
  assert.equal(dbs.length, 1);
  assert.equal((await v.myTasks()).length, 2);
  assert.equal((await as(s, ANDREW).myTasks()).length, 0);
  await assert.rejects(() => v.addMyTask('   '), /Write the task/);
  assert.equal(collectMyTasks([], VICKY, []).length, 0);
});
