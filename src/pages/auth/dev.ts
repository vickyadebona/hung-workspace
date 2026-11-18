import type { APIRoute } from 'astro';
import { COOKIE, SESSION_DAYS, allowedEmails, createSession, env } from '../../lib/auth';

// Local-only shortcut. Refuses to work unless AUTH_DEV=1, and never over https.
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  if (env('AUTH_DEV') !== '1' || url.protocol === 'https:') return new Response('Not found', { status: 404 });
  // ?as=<allowed email> signs in as that person, to try the app as two different people on your Mac.
  const asEmail = (url.searchParams.get('as') ?? '').trim().toLowerCase();
  const email = asEmail && allowedEmails().includes(asEmail) ? asEmail : (allowedEmails()[0] ?? 'dev@localhost');
  cookies.set(COOKIE, createSession(email, email.split('@')[0]), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
  return redirect('/');
};
