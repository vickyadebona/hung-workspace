/**
 * Copy pages between the Markdown folder and the Postgres database (ids and timestamps are kept).
 *
 *   DATABASE_URL=postgres://... npm run store -- up     # content/ -> database  (first-time upload, or restore)
 *   DATABASE_URL=postgres://... npm run store -- down   # database -> content/  (backup you can open in any editor)
 *
 * Add --dir=<folder> to use a folder other than ./content. Existing pages with the same id are replaced.
 */
import path from 'node:path';
import { FilePageStore } from '../src/lib/storage.ts';
import { PgPageStore } from '../src/lib/pgstore.ts';

const [mode] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const dir = path.resolve(dirArg ? dirArg.slice(6) : process.env.CONTENT_DIR || './content');
const url = process.env.DATABASE_URL;

if (!url || (mode !== 'up' && mode !== 'down')) {
  console.error('Usage: DATABASE_URL=... npm run store -- up|down [--dir=content]');
  process.exit(1);
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(url, { fullResults: true });
const pg = new PgPageStore(async () => ({ query: (t, p) => sql.query(t, p as any[]) as any }));
const files = new FilePageStore(dir);

const [from, to] = mode === 'up' ? [files, pg] : [pg, files];
const metas = await from.list();
let n = 0;
for (const m of metas) {
  const page = await from.get(m.id);
  if (!page) continue;
  await to.import(page);
  n++;
}
console.log(`${mode === 'up' ? 'Uploaded' : 'Downloaded'} ${n} of ${metas.length} pages (${mode === 'up' ? `${dir} -> database` : `database -> ${dir}`}).`);
