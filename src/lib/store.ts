import path from 'node:path';
import { FilePageStore, type PageStore } from './storage.ts';
import { PgPageStore } from './pgstore.ts';

/**
 * Which store to use:
 *  - DATABASE_URL set  -> Postgres (Neon). Needed on Vercel, which has no permanent disk.
 *  - otherwise         -> Markdown files in CONTENT_DIR (default ./content). Used on your Mac.
 */
let store: PageStore | null = null;
export function getStore(): PageStore {
  if (!store) {
    const env = (k: string) => process.env[k] || ((import.meta.env ?? {}) as Record<string, string | undefined>)[k] || '';
    const url = env('DATABASE_URL');
    if (url) {
      store = new PgPageStore(async () => {
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(url, { fullResults: true });
        return { query: (text, params) => sql.query(text, params as any[]) as any };
      });
    } else {
      store = new FilePageStore(path.resolve(env('CONTENT_DIR') || './content'));
    }
  }
  return store;
}
