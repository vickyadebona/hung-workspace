/**
 * Formulas: small expressions that work out a value for each row of a database from that row's other properties.
 *
 *   prop("Price") * prop("Quantity")
 *   if(prop("Done"), "✓ finished", "to do")
 *   dateBetween(prop("Due"), today(), "days")
 *
 * This is a tiny interpreter, not JavaScript: there is no eval, no loops and no access to anything but the row.
 * Everything here is pure (no disk, no DOM) so it runs the same on the server and in the browser.
 */

export class FDate {
  constructor(readonly iso: string) {}
}
export type FValue = number | string | boolean | null | FDate | FValue[];

export class FormulaError extends Error {}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'un'; op: '-' | '!'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'call'; name: string; args: Node[] };

const MAX_LENGTH = 1000;
const MAX_NODES = 300;
const MAX_DEPTH = 40;

/* --------------------------------- tokens --------------------------------- */

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'end'; v: string; at: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if ((src.slice(i, j).match(/\./g) ?? []).length > 1) throw new FormulaError(`Bad number "${src.slice(i, j)}"`);
      out.push({ t: 'num', v: src.slice(i, j), at: i });
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError('A piece of text is missing its closing quote');
      out.push({ t: 'str', v: s, at: i });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), at: i });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
        out.push({ t: 'op', v: two, at: i });
        i += 2;
      } else if ('+-*/%<>!(),'.includes(c)) {
        out.push({ t: 'op', v: c, at: i });
        i++;
      } else throw new FormulaError(`Unexpected "${c}"`);
    }
  }
  out.push({ t: 'end', v: '', at: src.length });
  return out;
}

/* --------------------------------- parser --------------------------------- */

const BINARY: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const WORD_OPS: Record<string, string> = { and: '&&', or: '||' };

export function parseFormula(src: string): Node {
  if (src.length > MAX_LENGTH) throw new FormulaError(`Formulas can be at most ${MAX_LENGTH} characters`);
  const toks = tokenize(src);
  let p = 0;
  let nodes = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const count = () => {
    if (++nodes > MAX_NODES) throw new FormulaError('This formula is too long or too complicated');
  };

  const binOp = (t: Tok): string | null => (t.t === 'op' && t.v in BINARY ? t.v : t.t === 'id' && t.v in WORD_OPS ? WORD_OPS[t.v] : null);

  function expr(minPrec: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new FormulaError('This formula is nested too deeply');
    let left = unary(depth);
    for (;;) {
      const op = binOp(peek());
      if (!op || BINARY[op] < minPrec) return left;
      next();
      const right = expr(BINARY[op] + 1, depth + 1);
      count();
      left = { k: 'bin', op, l: left, r: right };
    }
  }

  function unary(depth: number): Node {
    const t = peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) {
      next();
      count();
      return { k: 'un', op: t.v as '-' | '!', e: unary(depth + 1) };
    }
    if (t.t === 'id' && t.v === 'not') {
      next();
      count();
      return { k: 'un', op: '!', e: unary(depth + 1) };
    }
    return primary(depth);
  }

  function primary(depth: number): Node {
    const t = next();
    count();
    if (t.t === 'num') return { k: 'num', v: Number(t.v) };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = expr(1, depth + 1);
      const close = next();
      if (!(close.t === 'op' && close.v === ')')) throw new FormulaError('Missing a closing ")"');
      return e;
    }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true' };
      const open = peek();
      if (open.t === 'op' && open.v === '(') {
        next();
        const args: Node[] = [];
        if (!(peek().t === 'op' && peek().v === ')')) {
          for (;;) {
            args.push(expr(1, depth + 1));
            const sep = next();
            if (sep.t === 'op' && sep.v === ',') continue;
            if (sep.t === 'op' && sep.v === ')') break;
            throw new FormulaError(`Expected "," or ")" in ${t.v}(…)`);
          }
        } else next();
        return { k: 'call', name: t.v.toLowerCase(), args };
      }
      throw new FormulaError(`"${t.v}" is not a function. To use a property, write prop("${t.v}")`);
    }
    throw new FormulaError(t.t === 'end' ? 'The formula ends too early' : `Unexpected "${t.v}"`);
  }

  const tree = expr(1, 0);
  if (peek().t !== 'end') throw new FormulaError(`Unexpected "${peek().v}"`);
  return tree;
}

/* ------------------------------- evaluation ------------------------------- */

export interface FormulaEnv {
  /** The value of a property of this row, by its name. Throws FormulaError if there is no such property. */
  prop(name: string): FValue;
  /** Today's date, YYYY-MM-DD. */
  today: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateIso = (s: string) => DATE_RE.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const toDay = (iso: string) => Math.floor(new Date(iso + 'T00:00:00Z').getTime() / 86_400_000);
const fromDay = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

function text(v: FValue): string {
  if (v === null) return '';
  if (v instanceof FDate) return v.iso;
  if (Array.isArray(v)) return v.map(text).join(', ');
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e12) / 1e12) : '';
  return String(v);
}

function num(v: FValue): number {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) ? n : NaN;
  }
  if (v instanceof FDate) return toDay(v.iso);
  return NaN;
}

function truthy(v: FValue): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function isEmpty(v: FValue): boolean {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && Number.isNaN(v));
}

function equal(a: FValue, b: FValue): boolean {
  if (a instanceof FDate && b instanceof FDate) return a.iso === b.iso;
  if (Array.isArray(a) || Array.isArray(b)) return text(a) === text(b);
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return a === b;
}

function compare(a: FValue, b: FValue): number | null {
  if (a === null || b === null) return null;
  if (a instanceof FDate && b instanceof FDate) return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  const x = num(a);
  const y = num(b);
  return Number.isNaN(x) || Number.isNaN(y) ? null : x - y;
}

const UNITS = ['day', 'week', 'month', 'year'];
function unit(v: FValue): string {
  const u = text(v).toLowerCase().replace(/s$/, '');
  if (!UNITS.includes(u)) throw new FormulaError('The unit must be "days", "weeks", "months" or "years"');
  return u;
}
function asDate(v: FValue, what: string): FDate {
  if (v instanceof FDate) return v;
  if (typeof v === 'string' && isDateIso(v)) return new FDate(v);
  throw new FormulaError(`${what} needs a date`);
}
function addToDate(d: FDate, n: number, u: string): FDate {
  const [y, m, day] = d.iso.split('-').map(Number);
  if (u === 'day') return new FDate(fromDay(toDay(d.iso) + n));
  if (u === 'week') return new FDate(fromDay(toDay(d.iso) + n * 7));
  const months = u === 'year' ? n * 12 : n;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return new FDate(target.toISOString().slice(0, 10));
}
function between(a: FDate, b: FDate, u: string): number {
  if (u === 'day') return toDay(a.iso) - toDay(b.iso);
  if (u === 'week') return Math.trunc((toDay(a.iso) - toDay(b.iso)) / 7);
  const [ya, ma, da] = a.iso.split('-').map(Number);
  const [yb, mb, db] = b.iso.split('-').map(Number);
  let months = (ya - yb) * 12 + (ma - mb);
  if (months > 0 && da < db) months--;
  else if (months < 0 && da > db) months++;
  return u === 'year' ? Math.trunc(months / 12) : months;
}

type Fn = (args: FValue[], env: FormulaEnv) => FValue;
const numeric = (f: (...n: number[]) => number): Fn => (args) => {
  const r = f(...args.map(num));
  return Number.isFinite(r) ? r : null;
};

/** name -> [min args, max args (Infinity for any), implementation]. `if` and `prop` are handled in the evaluator. */
const FUNCTIONS: Record<string, [number, number, Fn]> = {
  and: [1, Infinity, (a) => a.every(truthy)],
  or: [1, Infinity, (a) => a.some(truthy)],
  not: [1, 1, (a) => !truthy(a[0])],
  empty: [1, 1, (a) => isEmpty(a[0])],
  // text
  concat: [1, Infinity, (a) => a.map(text).join('')],
  length: [1, 1, (a) => (Array.isArray(a[0]) ? a[0].length : text(a[0]).length)],
  lower: [1, 1, (a) => text(a[0]).toLowerCase()],
  upper: [1, 1, (a) => text(a[0]).toUpperCase()],
  trim: [1, 1, (a) => text(a[0]).trim()],
  contains: [2, 2, (a) => (Array.isArray(a[0]) ? a[0].some((x) => equal(x, a[1])) : text(a[0]).toLowerCase().includes(text(a[1]).toLowerCase()))],
  replace: [3, 3, (a) => text(a[0]).split(text(a[1])).join(text(a[2]))],
  substring: [2, 3, (a) => text(a[0]).slice(num(a[1]), a[2] === undefined ? undefined : num(a[2]))],
  join: [1, 2, (a) => (Array.isArray(a[0]) ? a[0].map(text).join(a[1] === undefined ? ', ' : text(a[1])) : text(a[0]))],
  format: [1, 1, (a) => text(a[0])],
  tonumber: [1, 1, (a) => { const n = num(a[0]); return Number.isNaN(n) ? null : n; }],
  // numbers
  round: [1, 2, (a) => { const f = 10 ** (a[1] === undefined ? 0 : num(a[1])); const r = Math.round(num(a[0]) * f) / f; return Number.isFinite(r) ? r : null; }],
  floor: [1, 1, numeric(Math.floor)],
  ceil: [1, 1, numeric(Math.ceil)],
  abs: [1, 1, numeric(Math.abs)],
  sqrt: [1, 1, numeric(Math.sqrt)],
  pow: [2, 2, numeric(Math.pow)],
  min: [1, Infinity, numeric(Math.min)],
  max: [1, Infinity, numeric(Math.max)],
  sum: [1, Infinity, numeric((...n) => n.reduce((x, y) => x + y, 0))],
  // dates
  today: [0, 0, (_a, env) => new FDate(env.today)],
  now: [0, 0, (_a, env) => new FDate(env.today)],
  date: [1, 1, (a) => { const s = text(a[0]); if (!isDateIso(s)) throw new FormulaError('date() needs text like "2026-12-31"'); return new FDate(s); }],
  dateadd: [3, 3, (a) => (a[0] === null ? null : addToDate(asDate(a[0], 'dateAdd'), num(a[1]), unit(a[2])))],
  datesubtract: [3, 3, (a) => (a[0] === null ? null : addToDate(asDate(a[0], 'dateSubtract'), -num(a[1]), unit(a[2])))],
  datebetween: [3, 3, (a) => (a[0] === null || a[1] === null ? null : between(asDate(a[0], 'dateBetween'), asDate(a[1], 'dateBetween'), unit(a[2])))],
  year: [1, 1, (a) => (a[0] === null ? null : Number(asDate(a[0], 'year').iso.slice(0, 4)))],
  month: [1, 1, (a) => (a[0] === null ? null : Number(asDate(a[0], 'month').iso.slice(5, 7)))],
  day: [1, 1, (a) => (a[0] === null ? null : Number(asDate(a[0], 'day').iso.slice(8, 10)))],
  formatdate: [1, 1, (a) => (a[0] === null ? null : new Date(asDate(a[0], 'formatDate').iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }))],
  // lists
  first: [1, 1, (a) => (Array.isArray(a[0]) ? (a[0][0] ?? null) : a[0])],
};

export const FORMULA_FUNCTIONS = ['prop', 'if', ...Object.keys(FUNCTIONS)];

function evalNode(n: Node, env: FormulaEnv): FValue {
  switch (n.k) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v;
    case 'un': {
      const v = evalNode(n.e, env);
      if (n.op === '!') return !truthy(v);
      const x = num(v);
      return Number.isNaN(x) ? null : -x;
    }
    case 'bin': {
      if (n.op === '&&') return truthy(evalNode(n.l, env)) && truthy(evalNode(n.r, env));
      if (n.op === '||') return truthy(evalNode(n.l, env)) || truthy(evalNode(n.r, env));
      const l = evalNode(n.l, env);
      const r = evalNode(n.r, env);
      switch (n.op) {
        case '==':
          return equal(l, r);
        case '!=':
          return !equal(l, r);
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const c = compare(l, r);
          if (c === null) return false;
          return n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : c >= 0;
        }
        case '+': {
          if (l instanceof FDate && typeof r === 'number') return addToDate(l, r, 'day');
          if (typeof l === 'string' || typeof r === 'string' || Array.isArray(l) || Array.isArray(r) || l instanceof FDate || r instanceof FDate) return text(l) + text(r);
          const s = num(l) + num(r);
          return Number.isNaN(s) ? null : s;
        }
        default: {
          const a = num(l);
          const b = num(r);
          if (Number.isNaN(a) || Number.isNaN(b)) return null;
          if (n.op === '-') return l instanceof FDate && r instanceof FDate ? a - b : a - b;
          if (n.op === '*') return a * b;
          if (b === 0) return null; // dividing by zero gives an empty result, not an error
          return n.op === '/' ? a / b : a % b;
        }
      }
    }
    case 'call': {
      if (n.name === 'if') {
        if (n.args.length !== 3) throw new FormulaError('if() needs three parts: if(condition, then, else)');
        return truthy(evalNode(n.args[0], env)) ? evalNode(n.args[1], env) : evalNode(n.args[2], env);
      }
      if (n.name === 'prop') {
        if (n.args.length !== 1) throw new FormulaError('prop() needs one property name, like prop("Price")');
        return env.prop(text(evalNode(n.args[0], env)));
      }
      const f = FUNCTIONS[n.name];
      if (!f) throw new FormulaError(`Unknown function "${n.name}"`);
      if (n.args.length < f[0] || n.args.length > f[1]) throw new FormulaError(`${n.name}() takes ${f[0] === f[1] ? f[0] : `${f[0]} to ${f[1] === Infinity ? 'any number of' : f[1]}`} value(s)`);
      return f[2](n.args.map((a) => evalNode(a, env)), env);
    }
  }
}

/** What a formula leaves in a cell: a number, text, true/false, or a date as YYYY-MM-DD. Empty is null. */
export type FormulaResult = number | string | boolean | null;

export function normalizeResult(v: FValue): FormulaResult {
  if (v === null) return null;
  if (v instanceof FDate) return v.iso;
  if (Array.isArray(v)) return v.length ? text(v) : null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e12) / 1e12 : null;
  return v;
}

export function runFormula(src: string, env: FormulaEnv): FormulaResult {
  return normalizeResult(evalNode(parseFormula(src), env));
}

/** Check a formula without a row: is it well formed, does it use known functions, do its property names exist? Returns a message, or null if fine. */
export function checkFormula(src: string, propertyNames: string[]): string | null {
  try {
    if (!src.trim()) return 'Write a formula';
    const tree = parseFormula(src);
    const known = new Set(propertyNames.map((n) => n.toLowerCase()));
    const walk = (n: Node): void => {
      if (n.k === 'un') walk(n.e);
      else if (n.k === 'bin') {
        walk(n.l);
        walk(n.r);
      } else if (n.k === 'call') {
        if (!FORMULA_FUNCTIONS.includes(n.name)) throw new FormulaError(`Unknown function "${n.name}"`);
        if (n.name === 'prop') {
          const a = n.args[0];
          if (n.args.length !== 1) throw new FormulaError('prop() needs one property name, like prop("Price")');
          if (a?.k === 'str' && !known.has(a.v.toLowerCase())) throw new FormulaError(`There is no property called "${a.v}"`);
        } else if (n.name === 'if') {
          if (n.args.length !== 3) throw new FormulaError('if() needs three parts: if(condition, then, else)');
        } else {
          const f = FUNCTIONS[n.name];
          if (n.args.length < f[0] || n.args.length > f[1]) throw new FormulaError(`${n.name}() takes ${f[0] === f[1] ? f[0] : `${f[0]} to ${f[1] === Infinity ? 'any number of' : f[1]}`} value(s)`);
        }
        n.args.forEach(walk);
      }
    };
    walk(tree);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : 'This formula could not be read';
  }
}
