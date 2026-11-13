import type { APIRoute } from 'astro';
import { getStore } from '../../../lib/store';
import { json, readJson, str } from '../../../lib/http';

export const GET: APIRoute = async () => json({ pages: await getStore().list() });

export const POST: APIRoute = async ({ request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    const parent = body.parent === null ? null : (str(body.parent) ?? null);
    const page = await getStore().create({
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
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
