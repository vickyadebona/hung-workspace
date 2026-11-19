import type { APIRoute } from 'astro';
import { createToken, listTokens, revokeToken } from '../../lib/apitokens';
import { sealingSecret } from '../../lib/auth';
import { fail, json, readJson, str } from '../../lib/http';
import { getStore } from '../../lib/store';

/** Your personal access tokens for the connector (names only; a token is shown once, when it is made). */
export const GET: APIRoute = async ({ locals }) => {
  try {
    return json({ tokens: await listTokens(getStore(), sealingSecret(), locals.user.email) });
  } catch (e) {
    return fail(e);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    const { info, token } = await createToken(getStore(), sealingSecret(), locals.user.email, str(body.label) ?? '');
    return json({ token: info, secret: token }, 201);
  } catch (e) {
    return fail(e);
  }
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  try {
    const gone = await revokeToken(getStore(), sealingSecret(), locals.user.email, url.searchParams.get('id') ?? '');
    return gone ? json({ ok: true }) : json({ error: 'No such token' }, 404);
  } catch (e) {
    return fail(e);
  }
};
