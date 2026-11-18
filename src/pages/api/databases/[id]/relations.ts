import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../../lib/workspace';
import { fail, json, readJson, str } from '../../../../lib/http';

/**
 * Add a relation property to a database. Body: { name, target (a database id), twoWay, reverseName?, single? }.
 * For sub-items send the database's own id as the target with single: true and twoWay: true.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const body = (await readJson(request)) ?? {};
  const target = str(body.target);
  if (!target) return json({ error: 'Choose a database to link to' }, 400);
  try {
    const result = await workspaceFor(locals.user).addRelation(params.id ?? '', {
      name: str(body.name) ?? '',
      target,
      twoWay: body.twoWay === true,
      reverseName: str(body.reverseName),
      single: body.single === true,
    });
    return json(result, 201);
  } catch (e) {
    return fail(e);
  }
};
