import type { APIRoute } from 'astro';
import { allowedEmails, sealingSecret } from '../lib/auth';
import { verifyToken } from '../lib/apitokens';
import { handleRpc } from '../lib/mcp';
import { getStore } from '../lib/store';
import { workspaceFor } from '../lib/workspace';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const unauthorized = () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid token' } }), {
    status: 401,
    headers: { ...headers, 'www-authenticate': 'Bearer realm="hung-workspace"' },
  });

/** The connector for Claude, Duet and other MCP clients. Signed in with a personal access token (Settings → Integrations). */
export const POST: APIRoute = async ({ request, url }) => {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  const token = bearer ?? url.searchParams.get('token') ?? '';
  const email = token ? await verifyToken(getStore(), sealingSecret(), token) : null;
  if (!email || !allowedEmails().includes(email)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const ws = workspaceFor({ email, name: email.split('@')[0] });
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? (body as any[]).slice(0, 20) : [body]).map((m) => handleRpc(m as any, ws)))).filter((r) => r !== null);
  if (out.length === 0) return new Response(null, { status: 202 });
  return reply(batch ? out : out[0]);
};

// No server-initiated streams: tell clients so instead of leaving them waiting.
export const GET: APIRoute = () => new Response('Use POST', { status: 405, headers: { allow: 'POST' } });
export const DELETE: APIRoute = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
