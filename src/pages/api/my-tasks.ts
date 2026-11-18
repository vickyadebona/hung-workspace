import type { APIRoute } from 'astro';
import { workspaceFor } from '../../lib/workspace';
import { fail, json, readJson, str } from '../../lib/http';

/** Every task assigned to the signed-in person, across their spaces. */
export const GET: APIRoute = async ({ locals }) => {
  try {
    return json({ tasks: await workspaceFor(locals.user).myTasks() });
  } catch (e) {
    return fail(e);
  }
};

/** Add a task for yourself: { title, due? }. */
export const POST: APIRoute = async ({ locals, request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    return json({ task: await workspaceFor(locals.user).addMyTask(str(body.title) ?? '', str(body.due)) }, 201);
  } catch (e) {
    return fail(e);
  }
};
