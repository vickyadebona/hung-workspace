import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeViews, type PropertyDef } from '../src/lib/dbschema.ts';

const schema: PropertyDef[] = [{ id: 'a', name: 'A', type: 'text' }, { id: 'b', name: 'B', type: 'number' }];

test('column widths are kept for real columns only, rounded and kept within sensible limits', () => {
  const [v] = sanitizeViews([{ id: 'v1', name: 'Table', type: 'table', filters: [], sorts: [], widths: { title: 333.4, a: 5, b: 99999, ghost: 200, bad: 'x' }, wrap: true }], schema);
  assert.deepEqual(v.widths, { title: 333, a: 60, b: 800 });
  assert.equal(v.wrap, true);
});

test('only table views have widths and wrapping; empty or false settings are dropped', () => {
  const [board, table] = sanitizeViews(
    [
      { id: 'v1', name: 'Board', type: 'board', filters: [], sorts: [], widths: { a: 200 }, wrap: true },
      { id: 'v2', name: 'Table', type: 'table', filters: [], sorts: [], widths: {}, wrap: false },
    ],
    [{ id: 's', name: 'S', type: 'select', options: [] }, ...schema],
  );
  assert.equal(board.widths, undefined);
  assert.equal(board.wrap, undefined);
  assert.equal(table.widths, undefined);
  assert.equal(table.wrap, undefined);
});
