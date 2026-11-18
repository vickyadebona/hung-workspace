import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FDate, checkFormula, parseFormula, runFormula, type FValue } from '../src/lib/formula.ts';
import { deriveRows, sanitizeSchema, type PropertyDef, type Row } from '../src/lib/dbschema.ts';

const props: Record<string, FValue> = {
  price: 12.5,
  quantity: 4,
  name: 'Soft launch',
  done: false,
  due: new FDate('2026-12-10'),
  empty: null,
  tags: ['a', 'b'],
};
const env = {
  today: '2026-12-01',
  prop: (n: string) => {
    const k = n.toLowerCase();
    if (!(k in props)) throw new Error(`no property ${n}`);
    return props[k];
  },
};
const run = (src: string) => runFormula(src, env);

test('arithmetic, precedence and text joining', () => {
  assert.equal(run('prop("Price") * prop("Quantity")'), 50);
  assert.equal(run('1 + 2 * 3'), 7);
  assert.equal(run('(1 + 2) * 3'), 9);
  assert.equal(run('10 % 4'), 2);
  assert.equal(run('-3 + 5'), 2);
  assert.equal(run('"a" + "b" + 1'), 'ab1');
  assert.equal(run('prop("Empty") + 2'), 2); // empty counts as zero in sums
  assert.equal(run('1 / 0'), null); // dividing by zero leaves the cell empty
});

test('comparisons, logic and if()', () => {
  assert.equal(run('prop("Quantity") >= 4 && prop("Price") < 20'), true);
  assert.equal(run('prop("Done") or prop("Quantity") == 4'), true);
  assert.equal(run('not prop("Done")'), true);
  assert.equal(run('if(prop("Done"), "finished", "to do")'), 'to do');
  assert.equal(run('if(prop("Quantity") > 3, round(prop("Price") / 3, 2), 0)'), 4.17);
  assert.equal(run('prop("Name") == "Soft launch"'), true);
});

test('text functions', () => {
  assert.equal(run('upper(prop("Name"))'), 'SOFT LAUNCH');
  assert.equal(run('length(prop("Name"))'), 11);
  assert.equal(run('concat(prop("Name"), " (", prop("Quantity"), ")")'), 'Soft launch (4)');
  assert.equal(run('contains(prop("Name"), "LAUNCH")'), true);
  assert.equal(run('replace(prop("Name"), "Soft", "Hard")'), 'Hard launch');
  assert.equal(run('substring(prop("Name"), 0, 4)'), 'Soft');
  assert.equal(run('join(prop("Tags"), " / ")'), 'a / b');
  assert.equal(run('length(prop("Tags"))'), 2);
  assert.equal(run('empty(prop("Empty"))'), true);
});

test('math functions', () => {
  assert.equal(run('floor(3.7) + ceil(3.2) + abs(-1)'), 8);
  assert.equal(run('max(1, 9, 4) - min(3, 2)'), 7);
  assert.equal(run('sum(1, 2, 3)'), 6);
  assert.equal(run('pow(2, 10)'), 1024);
  assert.equal(run('toNumber("42") + 1'), 43);
});

test('dates', () => {
  assert.equal(run('dateBetween(prop("Due"), today(), "days")'), 9);
  assert.equal(run('dateBetween(today(), prop("Due"), "days")'), -9);
  assert.equal(run('dateAdd(prop("Due"), 1, "weeks")'), '2026-12-17');
  assert.equal(run('dateAdd(date("2026-01-31"), 1, "months")'), '2026-02-28'); // clamps to the end of a shorter month
  assert.equal(run('dateBetween(date("2027-03-01"), date("2026-12-01"), "months")'), 3);
  assert.equal(run('year(prop("Due")) * 100 + month(prop("Due"))'), 202612);
  assert.equal(run('formatDate(prop("Due"))'), 'Dec 10, 2026');
  assert.equal(run('prop("Due") < today()'), false);
  assert.equal(run('dateAdd(prop("Empty"), 1, "days")'), null);
});

test('mistakes are caught with a plain message, not a crash', () => {
  assert.match(checkFormula('1 +', ['A']) ?? '', /ends too early/);
  assert.match(checkFormula('foo(1)', ['A']) ?? '', /Unknown function/);
  assert.match(checkFormula('prop("Nope")', ['A']) ?? '', /no property called/);
  assert.match(checkFormula('Price * 2', ['Price']) ?? '', /prop\("Price"\)/);
  assert.match(checkFormula('if(1, 2)', ['A']) ?? '', /three parts/);
  assert.match(checkFormula('"abc', ['A']) ?? '', /closing quote/);
  assert.match(checkFormula('round()', ['A']) ?? '', /takes/);
  assert.equal(checkFormula('prop("a") * 2', ['A']), null);
  assert.equal(checkFormula('', ['A']), 'Write a formula');
});

test('formulas cannot run away: size limits and no code execution', () => {
  assert.throws(() => parseFormula('1+'.repeat(600) + '1'), /1000 characters|too long/);
  assert.throws(() => parseFormula('('.repeat(200) + '1' + ')'.repeat(200)), /deeply|too long/);
  assert.throws(() => run('process.exit(1)'), /Unexpected|not a function/);
  assert.throws(() => run('constructor("return 1")()'), /Unknown function|Unexpected/);
  assert.throws(() => run('__proto__'), /not a function/);
});

/* ------------------------------ inside a database ------------------------------ */

const schema: PropertyDef[] = [
  { id: 'price', name: 'Price', type: 'number' },
  { id: 'qty', name: 'Quantity', type: 'number' },
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'st', name: 'Status', type: 'select', options: [{ id: 'd', name: 'Done', color: 'green' }] },
  { id: 'total', name: 'Total', type: 'formula', formula: { expression: 'prop("Price") * prop("Quantity")' } },
  { id: 'big', name: 'Big?', type: 'formula', formula: { expression: 'prop("Total") > 100' } },
  { id: 'late', name: 'Days late', type: 'formula', formula: { expression: 'if(prop("Status") == "Done", 0, dateBetween(today(), prop("Due"), "days"))' } },
  { id: 'bad', name: 'Broken', type: 'formula', formula: { expression: 'prop("Missing") + 1' } },
];
const row = (id: string, p: Row['props'], title = id): Row => ({ id, title, props: p, createdAt: '', updatedAt: '' });

test('formulas fill in each row, can use earlier formulas and select names, and a broken one leaves cells empty', () => {
  const rows = [row('a', { price: 30, qty: 5, due: '2000-01-01' }), row('b', { price: 2, qty: 3, st: 'd', due: '2000-01-01' }), row('c', {})];
  const out = deriveRows(schema, rows, { rowsOf: () => rows, schemaOf: () => schema });
  assert.equal(out[0].props.total, 150);
  assert.equal(out[0].props.big, true);
  assert.equal(out[1].props.total, 6);
  assert.equal(out[1].props.big, false);
  assert.equal(typeof out[0].props.late, 'number');
  assert.ok((out[0].props.late as number) > 9000); // long overdue
  assert.equal(out[1].props.late, 0); // done, so not late
  assert.equal(out[2].props.total, 0); // empty values count as zero
  assert.equal(out[0].props.bad, undefined); // unknown property: empty, never a crash
});

test('formula properties validate and never accept stored values', () => {
  assert.throws(() => sanitizeSchema([{ id: 'f', name: 'F', type: 'formula', formula: { expression: '   ' } }]), /needs an expression/);
  assert.throws(() => sanitizeSchema([{ id: 'f', name: 'F', type: 'formula' }]), /needs an expression/);
  const ok = sanitizeSchema([{ id: 'f', name: 'F', type: 'formula', formula: { expression: ' 1 + 1 ' } }]);
  assert.equal(ok[0].formula?.expression, '1 + 1');
});
