import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../lib/workspace';
import { fail, json, readJson, str } from '../../../lib/http';

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    return json({ pages: await workspaceFor(locals.user).list(url.searchParams.get('space') ?? undefined) });
  } catch (e) {
    return fail(e);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    const parent = body.parent === null ? null : (str(body.parent) ?? null);
    const page = await workspaceFor(locals.user).create({
      space: str(body.space),
      title: str(body.title),
      parent,
      body: str(body.body),
      icon: str(body.icon),
      kind: body.kind === 'database' ? 'database' : 'page',
      database: str(body.database) ?? null,
      props: body.props && typeof body.props === 'object' && !Array.isArray(body.props) ? (body.props as Record<string, unknown>) : undefined,
      schema: body.schema,
    });
    return json({ page }, 201);
  } catch (e) {
    return fail(e);
  }
};
