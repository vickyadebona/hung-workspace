import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../lib/workspace';
import { fail, json, readJson, str } from '../../../lib/http';

/**
 * Change a space. Send any of: { name, icon } to rename, { addMember: "email" }, { removeMember: "email" }.
 * Only the owner can rename or add people; anyone can remove themselves.
 */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  const id = params.id ?? '';
  try {
    const ws = workspaceFor(locals.user);
    let space = await ws.space(id);
    if (typeof body.name === 'string' || typeof body.icon === 'string') space = await ws.renameSpace(id, { name: str(body.name), icon: str(body.icon) });
    if (typeof body.addMember === 'string') space = await ws.addMember(id, body.addMember);
    if (typeof body.removeMember === 'string') space = await ws.removeMember(id, body.removeMember);
    return json({ space });
  } catch (e) {
    return fail(e);
  }
};
