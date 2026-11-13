import type { APIRoute } from 'astro';
import { COOKIE, SESSION_DAYS, allowedEmails, createSession, env } from '../../lib/auth';

// Local-only shortcut. Refuses to work unless AUTH_DEV=1, and never over https.
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  if (env('AUTH_DEV') !== '1' || url.protocol === 'https:') return new Response('Not found', { status: 404 });
  const email = allowedEmails()[0] ?? 'dev@localhost';
  cookies.set(COOKIE, createSession(email, 'Dev user'), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
  return redirect('/');
};
