import type { APIRoute } from 'astro';
import { ConflictError, type UpdatePatch } from '../../../lib/storage';
import { getStore } from '../../../lib/store';
import { json, readJson, str } from '../../../lib/http';

export const GET: APIRoute = async ({ params }) => {
  const page = await getStore().get(params.id ?? '');
  return page ? json({ page }) : json({ error: 'Not found' }, 404);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  const patch: UpdatePatch = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.body === 'string') patch.body = body.body;
  if (typeof body.icon === 'string') patch.icon = body.icon;
  if (typeof body.order === 'number') patch.order = body.order;
  if (body.parent === null || typeof body.parent === 'string') patch.parent = body.parent || null;
  if (body.props && typeof body.props === 'object' && !Array.isArray(body.props)) patch.props = body.props as Record<string, unknown>;
  if (body.schema !== undefined) patch.schema = body.schema;
  if (body.views !== undefined) patch.views = body.views;
  try {
    const page = await getStore().update(params.id ?? '', patch, { baseUpdatedAt: str(body.baseUpdatedAt) });
    return json({ page });
  } catch (e: any) {
    if (e instanceof ConflictError) return json({ error: 'conflict', current: e.current }, 409);
    return json({ error: e.message }, e.message === 'Page not found' ? 404 : 400);
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const removed = await getStore().remove(params.id ?? '');
  return removed.length ? json({ removed }) : json({ error: 'Not found' }, 404);
};
