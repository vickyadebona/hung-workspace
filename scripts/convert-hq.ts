/**
 * One-off: upgrade the TerraScape HQ databases to use Phase 5 features.
 *
 *   npm run convert-hq                      # shows what it would do, changes nothing
 *   npm run convert-hq -- --apply           # does it
 *
 * What it does (each step is skipped if it was already done, so running it twice is safe):
 *   1. Tasks: the plain-text "Milestone" column becomes a real two-way link to the Milestones database
 *      (and Milestones gets a "Tasks" column listing them). The old text column is removed only if every
 *      value found its milestone.
 *   2. Tasks, Milestones, Content calendar: "Owner" (Vicky / Andrew / Both) becomes a Person property.
 *   3. Milestones: adds "Task count" and "Progress" (percent of linked tasks that are Done).
 *
 * Reads the pages from CONTENT_DIR (default ./content), or from the database when DATABASE_URL is set.
 * Take a backup first: npm run backup -- --force
 * Who is who: --vicky=email --andrew=email (defaults below).
 */
import path from 'node:path';
import { Workspace } from '../src/lib/access.ts';
import { uid, type PropertyDef } from '../src/lib/dbschema.ts';
import { FilePageStore, LEGACY_SPACE_ID, type Page, type PageStore } from '../src/lib/storage.ts';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const APPLY = process.argv.includes('--apply');
const VICKY = arg('vicky', 'vadebona411@gmail.com').toLowerCase();
const ANDREW = arg('andrew', 'andrew.hung93@gmail.com').toLowerCase();
const SPACE = arg('space', LEGACY_SPACE_ID);

async function openStore(): Promise<PageStore> {
  const url = process.env.DATABASE_URL;
  if (!url) return new FilePageStore(path.resolve(process.env.CONTENT_DIR || './content'));
  const { PgPageStore } = await import('../src/lib/pgstore.ts');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url, { fullResults: true });
  return new PgPageStore(async () => ({ query: (t, p) => sql.query(t, p as any[]) as any }));
}

const store = await openStore();
const ws = new Workspace(store, { email: VICKY, name: 'Vicky' }, [VICKY, ANDREW]);
await ws.spaces(); // makes sure the shared space exists

const say = (m: string) => console.log((APPLY ? '' : '[dry run] ') + m);
const metas = (await store.list()).filter((p) => p.space === SPACE);
const findDb = (title: string) => metas.find((p) => p.kind === 'database' && p.title === title);
const fresh = async (id: string) => (await store.get(id)) as Page;
const rowsOf = async (dbId: string) => (await store.list()).filter((p) => p.database === dbId);

const tasks = findDb('Tasks');
const milestones = findDb('Milestones');
if (!tasks || !milestones) {
  console.error(`Could not find the Tasks and Milestones databases in space ${SPACE}. Nothing changed.`);
  process.exit(1);
}

/* ---- 1. Milestone text -> relation ---- */
{
  const t = await fresh(tasks.id);
  const textProp = t.schema?.find((d) => d.name === 'Milestone' && d.type === 'text');
  const alreadyLinked = t.schema?.some((d) => d.type === 'relation' && d.relation?.database === milestones.id && !d.relation.reverseOf);
  if (alreadyLinked) say('Tasks already link to Milestones: skipping step 1.');
  else if (!textProp) say('Tasks has no text "Milestone" column: skipping step 1.');
  else {
    const taskRows = await rowsOf(tasks.id);
    const msRows = await rowsOf(milestones.id);
    const byTitle = new Map(msRows.map((r) => [r.title.trim().toLowerCase(), r.id]));
    const withText = taskRows.filter((r) => typeof r.props[textProp.id] === 'string' && r.props[textProp.id]);
    const unmatched = withText.filter((r) => !byTitle.has(String(r.props[textProp.id]).trim().toLowerCase()));
    say(`Step 1: link ${withText.length - unmatched.length} of ${withText.length} tasks to their milestone${unmatched.length ? ` (${unmatched.length} have no matching milestone and keep their text)` : ''}.`);
    for (const r of unmatched) say(`   no match: "${r.props[textProp.id]}" (task "${r.title}")`);
    if (APPLY) {
      const { property } = await ws.addRelation(tasks.id, { name: 'Milestone link', target: milestones.id, twoWay: true, reverseName: 'Tasks' });
      for (const r of withText) {
        const id = byTitle.get(String(r.props[textProp.id]).trim().toLowerCase());
        if (id) await store.update(r.id, { props: { [property.id]: [id] } });
      }
      if (unmatched.length === 0) {
        const cur = await fresh(tasks.id);
        await store.update(tasks.id, { schema: (cur.schema ?? []).filter((d) => d.id !== textProp.id).map((d) => (d.id === property.id ? { ...d, name: 'Milestone' } : d)) });
        say('   removed the old text column and named the link "Milestone".');
      }
    }
  }
}

/* ---- 2. Owner select -> Person ---- */
const people: Record<string, string[]> = { vicky: [VICKY], andrew: [ANDREW], both: [VICKY, ANDREW] };
for (const title of ['Tasks', 'Milestones', 'Content calendar']) {
  const meta = findDb(title);
  if (!meta) continue;
  const db = await fresh(meta.id);
  const owner = db.schema?.find((d) => d.name === 'Owner' && d.type === 'select');
  if (!owner) {
    say(`${title}: no select "Owner" column: skipping step 2 here.`);
    continue;
  }
  const rows = await rowsOf(db.id);
  say(`Step 2: ${title}: turn Owner into a Person property (${rows.filter((r) => r.props[owner.id]).length} rows have an owner).`);
  if (!APPLY) continue;
  const person: PropertyDef = { id: uid(), name: 'Owner (new)', type: 'person' };
  await store.update(db.id, { schema: [...(db.schema ?? []), person] });
  for (const r of rows) {
    const optName = owner.options?.find((o) => o.id === r.props[owner.id])?.name.toLowerCase();
    const emails = optName ? people[optName] : undefined;
    if (emails) await store.update(r.id, { props: { [person.id]: emails } });
  }
  const cur = await fresh(db.id);
  await store.update(db.id, { schema: (cur.schema ?? []).filter((d) => d.id !== owner.id).map((d) => (d.id === person.id ? { ...d, name: 'Owner' } : d)) });
}

/* ---- 3. Milestones: task count and progress ---- */
{
  const ms = await fresh(milestones.id);
  const rev = ms.schema?.find((d) => d.type === 'relation' && d.relation?.database === tasks.id && d.relation.reverseOf);
  const t = await fresh(tasks.id);
  const status = t.schema?.find((d) => d.name === 'Status' && d.type === 'select');
  const done = status?.options?.find((o) => o.name === 'Done');
  const has = (name: string) => ms.schema?.some((d) => d.type === 'rollup' && d.name === name);
  if (!rev) say('Milestones has no "Tasks" link yet: skipping step 3.');
  else if (has('Task count') && has('Progress')) say('Milestones already have Task count and Progress: skipping step 3.');
  else {
    say('Step 3: add "Task count" and "Progress" to Milestones.');
    if (APPLY) {
      const add: PropertyDef[] = [{ id: uid(), name: 'Task count', type: 'rollup', rollup: { relation: rev.id, fn: 'count' } }];
      if (status && done) add.push({ id: uid(), name: 'Progress', type: 'rollup', rollup: { relation: rev.id, target: status.id, fn: 'percent_option', options: [done.id] } });
      await store.update(ms.id, { schema: [...(ms.schema ?? []), ...add.filter((d) => !has(d.name))] });
    }
  }
}
say(APPLY ? 'Done.' : 'Nothing was changed. Run again with --apply to do it.');
