/**
 * Shared database logic (runs on the server for validation and in the browser for views).
 * A database is a page with a `schema` (its properties) and `views`; its rows are pages
 * whose `props` hold one value per property. Nothing here touches the disk or the DOM.
 */

export const PROP_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url'] as const;
export type PropType = (typeof PROP_TYPES)[number];

export const COLORS = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink'] as const;
export type Color = (typeof COLORS)[number];

export interface SelectOption {
  id: string;
  name: string;
  color: Color;
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropType;
  options?: SelectOption[]; // select / multiselect only
}

/** select -> option id, multiselect -> option ids, date -> YYYY-MM-DD, others as their JS type */
export type PropValue = string | number | boolean | string[] | null;
export type Props = Record<string, PropValue>;

export const VIEW_TYPES = ['table', 'board', 'list', 'calendar'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const FILTER_OPS = [
  'contains',
  'not_contains',
  'is',
  'is_not',
  'empty',
  'not_empty',
  'gt',
  'lt',
  'before',
  'after',
  'checked',
  'unchecked',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const TITLE_ID = 'title'; // the built-in Name column

export interface Filter {
  propId: string;
  op: FilterOp;
  value?: string | number;
}
export interface Sort {
  propId: string;
  dir: 'asc' | 'desc';
}
export interface View {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  sorts: Sort[];
  groupBy?: string; // board: a select property id
  dateProp?: string; // calendar: a date property id
}

export interface Row {
  id: string;
  title: string;
  props: Props;
  createdAt: string;
  updatedAt: string;
}

const ID_RE = /^[a-z0-9]{1,24}$/;
const MAX_PROPS = 40;
const MAX_OPTIONS = 60;
const MAX_VIEWS = 20;
const MAX_FILTERS = 12;

export function uid(): string {
  let s = '';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function typeLabel(t: PropType | 'title'): string {
  return (
    { title: 'Name', text: 'Text', number: 'Number', select: 'Select', multiselect: 'Multi-select', date: 'Date', checkbox: 'Checkbox', url: 'URL' } as const
  )[t];
}

/* ---------- defaults ---------- */

export function defaultSchema(): PropertyDef[] {
  return [
    {
      id: 'status',
      name: 'Status',
      type: 'select',
      options: [
        { id: 'todo', name: 'Not started', color: 'gray' },
        { id: 'doing', name: 'In progress', color: 'blue' },
        { id: 'done', name: 'Done', color: 'green' },
      ],
    },
    { id: 'date', name: 'Date', type: 'date' },
  ];
}

export function defaultViews(schema: PropertyDef[]): View[] {
  const firstSelect = schema.find((p) => p.type === 'select');
  const firstDate = schema.find((p) => p.type === 'date');
  const views: View[] = [{ id: 'table', name: 'Table', type: 'table', filters: [], sorts: [] }];
  if (firstSelect) views.push({ id: 'board', name: 'Board', type: 'board', filters: [], sorts: [], groupBy: firstSelect.id });
  if (firstDate) views.push({ id: 'calendar', name: 'Calendar', type: 'calendar', filters: [], sorts: [], dateProp: firstDate.id });
  return views;
}

/* ---------- validation of untrusted input (used by the API) ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanName = (v: unknown, fallback: string, max = 60) =>
  (typeof v === 'string' ? v.trim().slice(0, max) : '') || fallback;

export function sanitizeSchema(input: unknown): PropertyDef[] {
  if (!Array.isArray(input)) throw new Error('schema must be a list');
  if (input.length > MAX_PROPS) throw new Error('Too many properties');
  const seen = new Set<string>([TITLE_ID]);
  return input.map((raw) => {
    if (!isObj(raw)) throw new Error('Invalid property');
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!ID_RE.test(id) || seen.has(id)) throw new Error('Invalid or duplicate property id');
    seen.add(id);
    const type = raw.type as PropType;
    if (!PROP_TYPES.includes(type)) throw new Error('Invalid property type');
    const def: PropertyDef = { id, name: cleanName(raw.name, 'Property'), type };
    if (type === 'select' || type === 'multiselect') {
      const opts = Array.isArray(raw.options) ? raw.options : [];
      if (opts.length > MAX_OPTIONS) throw new Error('Too many options');
      const oseen = new Set<string>();
      def.options = opts.map((o) => {
        if (!isObj(o)) throw new Error('Invalid option');
        const oid = typeof o.id === 'string' ? o.id : '';
        if (!ID_RE.test(oid) || oseen.has(oid)) throw new Error('Invalid or duplicate option id');
        oseen.add(oid);
        const color = COLORS.includes(o.color as Color) ? (o.color as Color) : 'gray';
        return { id: oid, name: cleanName(o.name, 'Option', 40), color };
      });
    }
    return def;
  });
}

export function sanitizeViews(input: unknown, schema: PropertyDef[]): View[] {
  if (!Array.isArray(input)) throw new Error('views must be a list');
  if (input.length === 0) throw new Error('A database needs at least one view');
  if (input.length > MAX_VIEWS) throw new Error('Too many views');
  const ids = new Set<string>([TITLE_ID, ...schema.map((p) => p.id)]);
  const seen = new Set<string>();
  return input.map((raw) => {
    if (!isObj(raw)) throw new Error('Invalid view');
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!ID_RE.test(id) || seen.has(id)) throw new Error('Invalid or duplicate view id');
    seen.add(id);
    const type = raw.type as ViewType;
    if (!VIEW_TYPES.includes(type)) throw new Error('Invalid view type');
    const filters: Filter[] = (Array.isArray(raw.filters) ? raw.filters : []).slice(0, MAX_FILTERS).flatMap((f) => {
      if (!isObj(f) || typeof f.propId !== 'string' || !ids.has(f.propId) || !FILTER_OPS.includes(f.op as FilterOp)) return [];
      const value = typeof f.value === 'string' ? f.value.slice(0, 200) : typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : undefined;
      return [{ propId: f.propId, op: f.op as FilterOp, ...(value !== undefined ? { value } : {}) }];
    });
    const sorts: Sort[] = (Array.isArray(raw.sorts) ? raw.sorts : []).slice(0, 4).flatMap((s) =>
      isObj(s) && typeof s.propId === 'string' && ids.has(s.propId) ? [{ propId: s.propId, dir: s.dir === 'desc' ? ('desc' as const) : ('asc' as const) }] : [],
    );
    const view: View = { id, name: cleanName(raw.name, 'View'), type, filters, sorts };
    const sel = schema.find((p) => p.id === raw.groupBy && p.type === 'select');
    if (type === 'board' && sel) view.groupBy = sel.id;
    else if (type === 'board') {
      const first = schema.find((p) => p.type === 'select');
      if (first) view.groupBy = first.id;
    }
    const dt = schema.find((p) => p.id === raw.dateProp && p.type === 'date');
    if (type === 'calendar' && dt) view.dateProp = dt.id;
    else if (type === 'calendar') {
      const first = schema.find((p) => p.type === 'date');
      if (first) view.dateProp = first.id;
    }
    return view;
  });
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Make one value safe for its property type. Anything invalid becomes null (empty). */
export function coerceValue(def: PropertyDef, v: unknown): PropValue {
  switch (def.type) {
    case 'text':
    case 'url':
      return typeof v === 'string' && v !== '' ? v.slice(0, 2000) : null;
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case 'select':
      return typeof v === 'string' && def.options?.some((o) => o.id === v) ? v : null;
    case 'multiselect': {
      if (!Array.isArray(v)) return null;
      const ok = [...new Set(v.filter((x): x is string => typeof x === 'string' && !!def.options?.some((o) => o.id === x)))];
      return ok.length ? ok : null;
    }
    case 'date':
      return typeof v === 'string' && isValidDate(v) ? v : null;
    case 'checkbox':
      return v === true ? true : null; // unchecked == empty, keeps files tidy
  }
}

/** Merge a patch into existing props: unknown keys are dropped, null clears a value. */
export function mergeProps(schema: PropertyDef[], existing: Props, patch: Record<string, unknown>): Props {
  const out: Props = {};
  for (const def of schema) if (existing[def.id] != null) out[def.id] = existing[def.id];
  for (const def of schema) {
    if (!(def.id in patch)) continue;
    const val = coerceValue(def, patch[def.id]);
    if (val === null) delete out[def.id];
    else out[def.id] = val;
  }
  return out;
}

/** After the schema changes, drop values that no longer fit (deleted property, removed option, new type). */
export function reconcileProps(schema: PropertyDef[], props: Props): Props {
  return mergeProps(schema, {}, Object.fromEntries(schema.map((d) => [d.id, props[d.id]])));
}

/* ---------- filtering, sorting, grouping ---------- */

export function opsFor(type: PropType | 'title'): FilterOp[] {
  switch (type) {
    case 'title':
    case 'text':
    case 'url':
      return ['contains', 'not_contains', 'is', 'empty', 'not_empty'];
    case 'number':
      return ['is', 'gt', 'lt', 'empty', 'not_empty'];
    case 'select':
      return ['is', 'is_not', 'empty', 'not_empty'];
    case 'multiselect':
      return ['contains', 'not_contains', 'empty', 'not_empty'];
    case 'date':
      return ['is', 'before', 'after', 'empty', 'not_empty'];
    case 'checkbox':
      return ['checked', 'unchecked'];
  }
}

export function opLabel(op: FilterOp, type: PropType | 'title'): string {
  if (type === 'number' && op === 'gt') return 'is greater than';
  if (type === 'number' && op === 'lt') return 'is less than';
  return (
    {
      contains: 'contains',
      not_contains: 'does not contain',
      is: 'is',
      is_not: 'is not',
      empty: 'is empty',
      not_empty: 'is not empty',
      gt: '>',
      lt: '<',
      before: 'is before',
      after: 'is after',
      checked: 'is checked',
      unchecked: 'is not checked',
    } as const
  )[op];
}

export function opNeedsValue(op: FilterOp): boolean {
  return !['empty', 'not_empty', 'checked', 'unchecked'].includes(op);
}

function cellValue(row: Row, propId: string): PropValue {
  return propId === TITLE_ID ? row.title : (row.props[propId] ?? null);
}

export function matchesFilter(row: Row, f: Filter, schema: PropertyDef[]): boolean {
  const def = f.propId === TITLE_ID ? null : schema.find((p) => p.id === f.propId);
  if (f.propId !== TITLE_ID && !def) return true; // property was deleted: ignore the filter
  const type: PropType | 'title' = def ? def.type : 'title';
  const v = cellValue(row, f.propId);
  const isEmpty = v === null || v === '' || (Array.isArray(v) && v.length === 0);
  if (f.op === 'empty') return isEmpty;
  if (f.op === 'not_empty') return !isEmpty;
  if (f.op === 'checked') return v === true;
  if (f.op === 'unchecked') return v !== true;
  if (f.value === undefined || f.value === '') return true; // an unfinished filter doesn't hide anything

  switch (type) {
    case 'title':
    case 'text':
    case 'url': {
      const a = String(v ?? '').toLowerCase();
      const b = String(f.value).toLowerCase();
      return f.op === 'contains' ? a.includes(b) : f.op === 'not_contains' ? !a.includes(b) : a === b;
    }
    case 'number': {
      if (typeof v !== 'number') return false;
      const n = Number(f.value);
      if (Number.isNaN(n)) return true;
      return f.op === 'gt' ? v > n : f.op === 'lt' ? v < n : v === n;
    }
    case 'select':
      return f.op === 'is' ? v === f.value : v !== f.value;
    case 'multiselect': {
      const has = Array.isArray(v) && v.includes(String(f.value));
      return f.op === 'contains' ? has : !has;
    }
    case 'date': {
      if (typeof v !== 'string') return false;
      const d = String(f.value);
      return f.op === 'before' ? v < d : f.op === 'after' ? v > d : v === d;
    }
    default:
      return true;
  }
}

function compareValues(a: PropValue, b: PropValue, def: PropertyDef | null): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === true || b === true) return (a === true ? 1 : 0) - (b === true ? 1 : 0);
  if (def && def.type === 'select') {
    const order = (x: PropValue) => def.options?.findIndex((o) => o.id === x) ?? -1;
    return order(a) - order(b);
  }
  const sa = Array.isArray(a) ? a.join(',') : String(a ?? '');
  const sb = Array.isArray(b) ? b.join(',') : String(b ?? '');
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

export function applyView(rows: Row[], view: View, schema: PropertyDef[]): Row[] {
  let out = rows.filter((r) => view.filters.every((f) => matchesFilter(r, f, schema)));
  const sorts = view.sorts.filter((s) => s.propId === TITLE_ID || schema.some((p) => p.id === s.propId));
  if (sorts.length) {
    out = [...out].sort((x, y) => {
      for (const s of sorts) {
        const def = s.propId === TITLE_ID ? null : (schema.find((p) => p.id === s.propId) ?? null);
        const a = cellValue(x, s.propId);
        const b = cellValue(y, s.propId);
        const ae = a === null || a === '' || (Array.isArray(a) && a.length === 0);
        const be = b === null || b === '' || (Array.isArray(b) && b.length === 0);
        if (ae && be) continue;
        if (ae) return 1; // empty values always last, in either direction
        if (be) return -1;
        const c = compareValues(a, b, def);
        if (c !== 0) return s.dir === 'asc' ? c : -c;
      }
      return 0;
    });
  }
  return out;
}

export interface Group {
  key: string; // option id, or '' for "No value"
  label: string;
  color: Color | null;
  rows: Row[];
}

export function groupRows(rows: Row[], def: PropertyDef): Group[] {
  const groups: Group[] = (def.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color, rows: [] }));
  const none: Group = { key: '', label: `No ${def.name.toLowerCase()}`, color: null, rows: [] };
  for (const r of rows) {
    const v = r.props[def.id];
    const g = typeof v === 'string' ? groups.find((x) => x.key === v) : undefined;
    (g ?? none).rows.push(r);
  }
  return none.rows.length ? [none, ...groups] : groups;
}

/* ---------- calendar helpers ---------- */

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoDate(y: number, m0: number, d: number): string {
  // m0 is 0-based; Date.UTC normalises overflow (e.g. day 32)
  const dt = new Date(Date.UTC(y, m0, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Weeks (Sunday first) covering the month, as ISO dates. Always full weeks. */
export function monthGrid(year: number, month0: number): string[][] {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const weeks: string[][] = [];
  const total = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  for (let i = 0; i < total; i += 7) {
    weeks.push(Array.from({ length: 7 }, (_, j) => isoDate(year, month0, i + j - firstDow + 1)));
  }
  return weeks;
}
