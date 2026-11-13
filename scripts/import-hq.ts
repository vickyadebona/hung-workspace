/** One-off: build the TerraScape HQ workspace in ./content from scripts/hq-data.json (finance items already excluded). */
import fs from 'node:fs';
import path from 'node:path';
import { FilePageStore } from '../src/lib/storage.ts';

const d = JSON.parse(fs.readFileSync(process.argv[2] || 'scripts/hq-data.json', 'utf8'));
const store = new FilePageStore(path.resolve(process.env.CONTENT_DIR || './content'));
const COLORS = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink'];

function slug(s: string, used: Set<string>) {
  let b = s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'x';
  let id = b, i = 2;
  while (used.has(id)) id = b.slice(0, 18) + i++;
  used.add(id);
  return id;
}
/** build select options from distinct values, returns [options, valueToId] */
function opts(values: string[]) {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  const options: any[] = [];
  [...new Set(values.filter(Boolean))].forEach((v, i) => {
    const id = slug(v, used);
    map[v] = id;
    options.push({ id, name: v, color: COLORS[i % COLORS.length] });
  });
  return { options, map };
}
const col = <T,>(rows: T[], f: (r: T) => string) => rows.map(f);

const home = await store.create({
  title: 'TerraScape HQ',
  icon: '🌿',
  body: `TerraScape's shared home for Vicky, Andrew and the AI team. Custom terrariums with an engineered LED, fan and mister lid, built in Los Angeles. Everything in these pages is the source of truth: agents research and recommend, Vicky and Andrew decide.

## Where things stand

*As of 2026-11-10.*

- **Stage:** prototype, reset. Andrew's spec draft exists (Google Doc) and the planning pause is lifted (Decided 2026-11-10). TerraScape isn't registered as a business yet. A coming-soon page on the live site is proposed for now. The 2026-11-10 meeting set a January 2027 launch target (realism to confirm), anchored on the first physical unit.
- **Next milestones (no dates; the agents no longer suggest them):** Andrew's new lid unit, then the lineup and studio-planted vs kit, then lid configurations and real lead times. The modular lid working prototype keeps the end-of-November target (proposed).
- **Waiting on you two:** proposed decisions (see Decisions) and 14 new Inbox tasks from Andrew's docs and the 2026-11-10 meeting that need owners.

## How we work

- **Weekly planning:** Tuesdays 8:00 pm PT on the shared calendar. The AI digest lands Monday mornings.
- **Every task** has one owner (Vicky, Andrew or Both), a status and a *Done when* line. Agent suggestions start in Inbox.
- **Proposed** dates and decisions are drafts until we agree them. The agents don't suggest dates for our work; they say how long something will realistically take.
- **The AI team** runs from \`~/code/terrascape-ops\` on Vicky's Mac.

*Migrated from Notion on 2026-11-12. Finance pages, finance tasks and anything about pricing, tax, costs or budgets were left out on purpose and stay in Notion. Agent notes, weekly digests, roadmap, playbook, glossary and specifications have not been migrated yet.*
`,
});
const plan = await store.create({ title: 'Plan', icon: '🗺️', parent: home.id, body: 'Tasks, milestones, decisions and the content calendar.' });
const records = await store.create({ title: 'Records', icon: '🗂️', parent: home.id, body: 'Processed meetings.' });

// ---------- Milestones ----------
const msRows: any[] = d.M;
{
  const st = opts(col(msRows, (r) => r[2])), ow = opts(col(msRows, (r) => r[3])), ar = opts(col(msRows, (r) => r[4])), gate = opts(col(msRows, (r) => r[5])), ds = opts(col(msRows, (r) => r[7]));
  const db = await store.create({
    kind: 'database', title: 'Milestones', icon: '🏁', parent: plan.id,
    schema: [
      { id: 'status', name: 'Status', type: 'select', options: st.options },
      { id: 'owner', name: 'Owner', type: 'select', options: ow.options },
      { id: 'area', name: 'Area', type: 'select', options: ar.options },
      { id: 'gate', name: 'Gate', type: 'select', options: gate.options },
      { id: 'target', name: 'Target date', type: 'date' },
      { id: 'datestatus', name: 'Date status', type: 'select', options: ds.options },
    ],
  });
  for (const r of msRows) {
    await store.create({ database: db.id, title: r[1], body: r[8] ? `**Done when:** ${r[8]}` : '', props: {
      status: st.map[r[2]], owner: ow.map[r[3]] ?? null, area: ar.map[r[4]], gate: gate.map[r[5]], target: r[6], datestatus: ds.map[r[7]] } });
  }
}

// ---------- Tasks ----------
const tasks: any[] = d.T;
{
  const st = opts(['Inbox', 'Next', 'In progress', 'Blocked', 'Done']), ow = opts(['Vicky', 'Andrew', 'Both']), pr = opts(['High', 'Medium', 'Low']);
  const ar = opts(col(tasks, (r) => r[5]));
  const db = await store.create({
    kind: 'database', title: 'Tasks', icon: '✅', parent: plan.id,
    schema: [
      { id: 'status', name: 'Status', type: 'select', options: st.options },
      { id: 'owner', name: 'Owner', type: 'select', options: ow.options },
      { id: 'priority', name: 'Priority', type: 'select', options: pr.options },
      { id: 'area', name: 'Area', type: 'select', options: ar.options },
      { id: 'thisweek', name: 'This week', type: 'checkbox' },
      { id: 'due', name: 'Due', type: 'date' },
      { id: 'milestone', name: 'Milestone', type: 'text' },
      { id: 'tsid', name: 'ID', type: 'text' },
    ],
  });
  const ID = (k: string) => (d.MS as any)[k];
  for (const r of tasks) {
    const body = [r[9] ? `**Done when:** ${r[9]}` : '', r[10] ? `**Notes:** ${r[10]}` : ''].filter(Boolean).join('\n\n');
    await store.create({ database: db.id, title: r[1], body, props: {
      status: st.map[r[2]], owner: ow.map[r[3]] ?? null, priority: pr.map[r[4]] ?? null, area: ar.map[r[5]], thisweek: !!r[6],
      due: r[7], milestone: r[8] ? ID(r[8]) : null, tsid: `TS-${r[0]}` } });
  }
  const views: any[] = [
    { id: 'board', name: 'Board', type: 'board', filters: [], sorts: [], groupBy: 'status' },
    { id: 'thisweek', name: 'This week', type: 'board', filters: [{ propId: 'thisweek', op: 'checked' }], sorts: [], groupBy: 'status' },
    { id: 'table', name: 'All tasks', type: 'table', filters: [], sorts: [{ propId: 'tsid', dir: 'asc' }] },
  ];
  await store.update(db.id, { views });
}

// ---------- Decisions ----------
const dec: any[] = d.D;
{
  const st = opts(col(dec, (r) => r[1])), ar = opts(col(dec, (r) => r[2])), by = opts(col(dec, (r) => r[4]));
  const db = await store.create({
    kind: 'database', title: 'Decisions', icon: '⚖️', parent: plan.id,
    schema: [
      { id: 'status', name: 'Status', type: 'select', options: st.options },
      { id: 'area', name: 'Area', type: 'select', options: ar.options },
      { id: 'date', name: 'Date', type: 'date' },
      { id: 'decidedby', name: 'Decided by', type: 'select', options: by.options },
      { id: 'recby', name: 'Recommended by', type: 'text' },
    ],
  });
  for (const r of dec) {
    await store.create({ database: db.id, title: r[0], body: `**Why:** ${r[6]}`, props: { status: st.map[r[1]], area: ar.map[r[2]], date: r[3], decidedby: by.map[r[4]] ?? null, recby: r[5] } });
  }
  await store.update(db.id, { views: [
    { id: 'board', name: 'Board', type: 'board', filters: [], sorts: [], groupBy: 'status' },
    { id: 'table', name: 'By date', type: 'table', filters: [], sorts: [{ propId: 'date', dir: 'desc' }] },
  ] });
}

// ---------- Content calendar ----------
const cc: any[] = d.C;
{
  const st = opts(['Idea', 'Drafting', 'Ready', 'Posted']), ow = opts(col(cc, (r) => r[2])), ch = opts(cc.flatMap((r) => r[3])), pl = opts(col(cc, (r) => r[4]));
  const db = await store.create({
    kind: 'database', title: 'Content calendar', icon: '📅', parent: plan.id,
    schema: [
      { id: 'status', name: 'Status', type: 'select', options: st.options },
      { id: 'owner', name: 'Owner', type: 'select', options: ow.options },
      { id: 'channel', name: 'Channel', type: 'multiselect', options: ch.options },
      { id: 'pillar', name: 'Pillar', type: 'select', options: pl.options },
      { id: 'publish', name: 'Publish date', type: 'date' },
    ],
  });
  for (const r of cc) {
    await store.create({ database: db.id, title: r[0], body: `**Hook:** ${r[5]}\n\n**Asset needed:** ${r[6]}\n\n**Caption draft:** ${r[7]}`, props: {
      status: st.map[r[1]], owner: ow.map[r[2]], channel: r[3].map((c: string) => ch.map[c]), pillar: pl.map[r[4]] } });
  }
  await store.update(db.id, { views: [
    { id: 'board', name: 'Board', type: 'board', filters: [], sorts: [], groupBy: 'status' },
    { id: 'cal', name: 'Calendar', type: 'calendar', filters: [], sorts: [], dateProp: 'publish' },
    { id: 'table', name: 'All posts', type: 'table', filters: [], sorts: [] },
  ] });
}

// ---------- Meeting log ----------
const mt: any[] = d.G;
{
  const db = await store.create({
    kind: 'database', title: 'Meeting log', icon: '🎙️', parent: records.id,
    schema: [
      { id: 'date', name: 'Date', type: 'date' },
      { id: 'processed', name: 'Processed', type: 'checkbox' },
      { id: 'processedon', name: 'Processed on', type: 'date' },
      { id: 'granola', name: 'Granola notes', type: 'url' },
    ],
  });
  for (const r of mt) {
    await store.create({ database: db.id, title: r[0], body: r[5], props: { date: r[4], processed: !!r[1], processedon: r[3], granola: r[2] } });
  }
  await store.update(db.id, { views: [{ id: 'table', name: 'By date', type: 'table', filters: [], sorts: [{ propId: 'date', dir: 'desc' }] }] });
}
console.log('done', (await store.list()).length, 'pages');
