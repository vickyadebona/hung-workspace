import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../lib/workspace';
import { fail, json, readJson, str } from '../../../lib/http';

export const GET: APIRoute = async ({ locals }) => {
  try {
    const ws = workspaceFor(locals.user);
    const spaces = await ws.spaces();
    return json({ spaces, personal: ws.personalId, me: ws.email, people: await ws.people() });
  } catch (e) {
    return fail(e);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    return json({ space: await workspaceFor(locals.user).createSpace(str(body.name) ?? '', str(body.icon)) }, 201);
  } catch (e) {
    return fail(e);
  }
};
