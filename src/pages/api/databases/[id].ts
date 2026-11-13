import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { json } from '../../../lib/http';

/** A database page plus all of its rows (metadata and properties, not row bodies). */
export const GET: APIRoute = async ({ params }) => {
  const store = getStore();
  const database = await store.get(params.id ?? '');
  if (!database || database.kind !== 'database') return json({ error: 'Not found' }, 404);
  const rows = (await store.list()).filter((p) => p.database === database.id);
  return json({ database, rows });
};
