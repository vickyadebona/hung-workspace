import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../../lib/workspace';
import { fail, json, readJson, str } from '../../../../lib/http';

/** Move a page (with its sub-pages, or a database with its rows) into another space you belong to. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const body = (await readJson(request)) ?? {};
  const space = str(body.space);
  if (!space) return json({ error: 'Choose a space to move it to' }, 400);
  try {
    return json({ moved: await workspaceFor(locals.user).move(params.id ?? '', space) });
  } catch (e) {
    return fail(e);
  }
};
