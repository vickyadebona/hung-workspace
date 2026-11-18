import type { APIRoute } from 'astro';
import { workspaceFor } from '../../lib/workspace';
import { fail, json } from '../../lib/http';

export const GET: APIRoute = async ({ url, locals }) => {
  try {
    return json({ results: await workspaceFor(locals.user).search(url.searchParams.get('q') ?? '') });
  } catch (e) {
    return fail(e);
  }
};
