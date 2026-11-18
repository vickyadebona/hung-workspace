import type { PropertyDef, SelectOption } from './dbschema.ts';
import type { PageMeta } from './storage.ts';

/** One task assigned to a person, wherever it lives. */
export interface MyTask {
  id: string;
  title: string;
  database: string;
  databaseTitle: string;
  databaseIcon: string;
  space: string;
  spaceName: string;
  due: string | null; // YYYY-MM-DD
  status: { name: string; color: string } | null;
  priority: { name: string; color: string } | null;
  done: boolean;
  /** How to tick this task off (and back): which property to set and to what. `open: null` clears it. */
  toggle: { propId: string; done: string | true; open: string | null } | null;
}

const DONE_WORDS = /^(done|complete|completed|finished|shipped|closed|resolved|cancel+ed|won'?t do)$/i;
const OPEN_WORDS = /^(not started|to ?do|todo|inbox|next|backlog|open|new)$/i;

const firstMatch = (defs: PropertyDef[], type: PropertyDef['type'], ...patterns: RegExp[]): PropertyDef | undefined => {
  const ofType = defs.filter((d) => d.type === type);
  for (const p of patterns) {
    const hit = ofType.find((d) => p.test(d.name));
    if (hit) return hit;
  }
  return ofType[0];
};

/** The properties of a database that say who a task is for, how it is going, and when it is due. */
export function taskShape(schema: PropertyDef[]) {
  const people = schema.filter((d) => d.type === 'person');
  const status = firstMatch(schema, 'select', /^status$/i, /status|state|stage/i);
  const doneBox = schema.find((d) => d.type === 'checkbox' && /done|complete/i.test(d.name));
  const due = firstMatch(schema, 'date', /^(due|due date|deadline)$/i, /due|deadline/i);
  const priority = schema.find((d) => d.type === 'select' && /priorit/i.test(d.name) && d.id !== status?.id);
  return { people, status, doneBox, due, priority };
}

const optionOf = (def: PropertyDef | undefined, id: unknown): SelectOption | undefined => (typeof id === 'string' ? def?.options?.find((o) => o.id === id) : undefined);

/**
 * Every task assigned to `email`: rows of any database (in the given spaces) that has a Person property
 * containing them. Nothing here reads other people's pages; the caller passes only pages in spaces the person belongs to.
 */
export function collectMyTasks(metas: PageMeta[], email: string, spaces: { id: string; name: string }[]): MyTask[] {
  const me = email.trim().toLowerCase();
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
  const out: MyTask[] = [];
  for (const db of metas) {
    if (db.kind !== 'database' || !spaceName.has(db.space) || !db.schema) continue;
    const shape = taskShape(db.schema);
    if (shape.people.length === 0) continue;
    const done = shape.status?.options?.filter((o) => DONE_WORDS.test(o.name.trim())) ?? [];
    const open = shape.status?.options?.find((o) => OPEN_WORDS.test(o.name.trim())) ?? shape.status?.options?.find((o) => !DONE_WORDS.test(o.name.trim()));
    for (const row of metas) {
      if (row.database !== db.id) continue;
      const mine = shape.people.some((p) => {
        const v = row.props[p.id];
        return Array.isArray(v) && v.includes(me);
      });
      if (!mine) continue;
      const statusOpt = optionOf(shape.status, row.props[shape.status?.id ?? '']);
      const boxed = shape.doneBox ? row.props[shape.doneBox.id] === true : false;
      const dueValue = shape.due ? row.props[shape.due.id] : null;
      const prio = optionOf(shape.priority, row.props[shape.priority?.id ?? '']);
      out.push({
        id: row.id,
        title: row.title || 'Untitled',
        database: db.id,
        databaseTitle: db.title,
        databaseIcon: db.icon,
        space: db.space,
        spaceName: spaceName.get(db.space) ?? '',
        due: typeof dueValue === 'string' ? dueValue : null,
        status: statusOpt ? { name: statusOpt.name, color: statusOpt.color } : null,
        priority: prio ? { name: prio.name, color: prio.color } : null,
        done: boxed || (!!statusOpt && done.some((o) => o.id === statusOpt.id)),
        toggle: shape.doneBox
          ? { propId: shape.doneBox.id, done: true, open: null }
          : shape.status && done[0]
            ? { propId: shape.status.id, done: done[0].id, open: open?.id ?? null }
            : null,
      });
    }
  }
  // soonest due first; tasks with no date last; ties by title
  return out.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title));
}

export { bucketOf, type TaskBucket } from './mytasks-buckets.ts';
