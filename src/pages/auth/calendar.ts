import type { APIRoute } from 'astro';
import { CALENDAR_STATE_PREFIX, COOKIE, calendarAuthUrl, googleConfigured, randomState, readSession } from '../../lib/auth';

/** Start connecting your Google Calendar (read-only). You must already be signed in. */
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  let session = null;
  try {
    session = readSession(cookies.get(COOKIE)?.value);
  } catch {
    session = null;
  }
  if (!session) return redirect('/auth/login');
  if (!googleConfigured()) return redirect('/calendar?calendar=not-configured');
  const state = CALENDAR_STATE_PREFIX + randomState();
  cookies.set('wn_state', state, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/', maxAge: 600 });
  return redirect(calendarAuthUrl(url.origin, state, session.email));
};
