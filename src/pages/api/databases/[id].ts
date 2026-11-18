import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../lib/workspace';
import { json } from '../../../lib/http';

/** A database page plus all of its rows (metadata and properties, not row bodies). */
export const GET: APIRoute = async ({ params, locals }) => {
  const result = await workspaceFor(locals.user).database(params.id ?? '');
  return result ? json(result) : json({ error: 'Not found' }, 404);
};
