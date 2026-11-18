import { HttpError } from './access';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Turn anything thrown while handling a request into a JSON error response. */
export function fail(e: unknown, fallbackStatus = 400): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, fallbackStatus);
}
