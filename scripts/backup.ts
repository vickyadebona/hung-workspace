/**
 * Back up every page as a compressed archive of plain Markdown files.
 *
 *   npm run backup                      # make a backup now (skipped if nothing changed since the last one)
 *   npm run backup -- --force           # make one even if nothing changed
 *   npm run backup -- list              # show the backups that exist
 *   npm run backup -- restore <file>    # unpack a backup into a NEW folder (never overwrites your pages)
 *
 * Where it reads from:
 *   - DATABASE_URL set  -> the Postgres database (what runs online)
 *   - otherwise         -> the CONTENT_DIR folder (default ./content), what runs on your Mac
 *
 * Where it writes (each folder gets its own copy; either may be left out):
 *   - BACKUP_DIR         default ~/Backups/hung-workspace
 *   - BACKUP_MIRROR_DIR  optional second copy, e.g. a folder inside Google Drive
 *
 * How long backups are kept (in each folder): everything from the last 2 days, then the newest backup of each
 * day for KEEP_DAYS days (default 30). Anything older is deleted.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIX = 'hung-workspace-';
const SUFFIX = '.tar.gz';
const HASH_FILE = '.last-content-hash';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [mode = 'backup', ...rest] = args.filter((a) => !a.startsWith('--'));

const home = os.homedir();
const expand = (p: string) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);
const primary = path.resolve(expand(process.env.BACKUP_DIR || '~/Backups/hung-workspace'));
const mirror = process.env.BACKUP_MIRROR_DIR ? path.resolve(expand(process.env.BACKUP_MIRROR_DIR)) : null;
const keepDays = Math.max(1, Number(process.env.KEEP_DAYS) || 30);
const destinations = [primary, ...(mirror && mirror !== primary ? [mirror] : [])];

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupsIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .sort();
}

/** Delete backups that are no longer worth keeping (see the note at the top). Returns how many were removed. */
function prune(dir: string, now = new Date()): number {
  const all = backupsIn(dir);
  const when = (f: string) => {
    const m = f.slice(PREFIX.length).match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  };
  const newestOfDay = new Map<string, string>();
  for (const f of all) newestOfDay.set(f.slice(PREFIX.length, PREFIX.length + 10), f); // sorted, so the last one wins
  let removed = 0;
  for (const f of all) {
    const t = when(f);
    if (!t) continue; // not one of ours to judge
    const ageDays = (now.getTime() - t.getTime()) / 86_400_000;
    const keepIt = ageDays < 2 || (ageDays <= keepDays && newestOfDay.get(f.slice(PREFIX.length, PREFIX.length + 10)) === f);
    if (!keepIt) {
      fs.rmSync(path.join(dir, f));
      removed++;
    }
  }
  return removed;
}

/** A fingerprint of every file's name and contents, so an unchanged workspace doesn't pile up identical backups. */
function fingerprint(dir: string): string {
  const h = crypto.createHash('sha256');
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        h.update(path.relative(dir, full) + '\0');
        h.update(fs.readFileSync(full));
        h.update('\0');
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function countFiles(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

/** Put the current pages in a folder we can archive: the content folder as is, or a fresh download from the database. */
async function gatherSource(): Promise<{ dir: string; label: string; cleanup: () => void }> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const dir = path.resolve(process.env.CONTENT_DIR || './content');
    if (!fs.existsSync(dir)) throw new Error(`No pages folder at ${dir}. Run this from the project folder, or set CONTENT_DIR.`);
    return { dir, label: dir, cleanup: () => {} };
  }
  const { FilePageStore } = await import('../src/lib/storage.ts');
  const { PgPageStore } = await import('../src/lib/pgstore.ts');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url, { fullResults: true });
  const pg = new PgPageStore(async () => ({ query: (t, p) => sql.query(t, p as any[]) as any }));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hung-backup-'));
  const files = new FilePageStore(tmp);
  const metas = await pg.list();
  for (const m of metas) {
    const page = await pg.get(m.id);
    if (page) await files.import(page);
  }
  return { dir: tmp, label: 'the database', cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

async function backup() {
  const src = await gatherSource();
  try {
    const hash = fingerprint(src.dir);
    const pending = destinations.filter((d) => {
      if (force) return true;
      const f = path.join(d, HASH_FILE);
      return !(fs.existsSync(f) && fs.readFileSync(f, 'utf8').trim() === hash && backupsIn(d).length > 0);
    });
    if (pending.length === 0) {
      console.log('Nothing has changed since the last backup, so no new one was made. (Use --force to make one anyway.)');
      return;
    }

    const name = `${PREFIX}${stamp()}${SUFFIX}`;
    const files = countFiles(src.dir);
    const made: string[] = [];
    let failed = 0;
    for (const dest of pending) {
      try {
        fs.mkdirSync(dest, { recursive: true });
        const target = path.join(dest, name);
        // Write to a temporary name first so a half-written archive is never mistaken for a good one.
        const partial = `${target}.partial`;
        execFileSync('tar', ['-czf', partial, '-C', src.dir, '.']);
        fs.renameSync(partial, target);
        fs.writeFileSync(path.join(dest, HASH_FILE), hash + '\n');
        prune(dest);
        made.push(target);
      } catch (err) {
        failed++;
        console.error(`Could not write a backup to ${dest}: ${(err as Error).message}`);
      }
    }
    for (const t of made) console.log(`Backed up ${files} files from ${src.label} -> ${t}`);
    if (failed) process.exitCode = 1;
  } finally {
    src.cleanup();
  }
}

function list() {
  for (const dest of destinations) {
    const all = backupsIn(dest);
    console.log(`${dest}  (${all.length} backup${all.length === 1 ? '' : 's'})`);
    for (const f of all.slice(-10)) {
      const kb = Math.round(fs.statSync(path.join(dest, f)).size / 1024);
      console.log(`  ${f}  ${kb} KB`);
    }
    if (all.length > 10) console.log(`  … and ${all.length - 10} older`);
  }
}

function restore() {
  const file = rest[0];
  if (!file) {
    console.error('Usage: npm run backup -- restore <backup file> [--to=<new folder>]');
    process.exit(1);
  }
  const archive = path.resolve(expand(file));
  if (!fs.existsSync(archive)) {
    console.error(`No such file: ${archive}`);
    process.exit(1);
  }
  const toArg = process.argv.find((a) => a.startsWith('--to='));
  const to = path.resolve(toArg ? expand(toArg.slice(5)) : `./content-restored-${stamp()}`);
  if (fs.existsSync(to) && fs.readdirSync(to).length > 0) {
    console.error(`${to} already has files in it. Pick a new folder with --to=… so nothing is overwritten.`);
    process.exit(1);
  }
  fs.mkdirSync(to, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', to]);
  console.log(`Restored ${countFiles(to)} files into ${to}`);
  console.log('Your current pages were not touched. To use the restored copy, check it over, then either');
  console.log('  - point CONTENT_DIR at it, or');
  console.log('  - move it into place as ./content after setting the old folder aside.');
}

if (mode === 'backup') await backup();
else if (mode === 'list') list();
else if (mode === 'restore') restore();
else {
  console.error('Usage: npm run backup [-- list | restore <file> | --force]');
  process.exit(1);
}
