import type { APIRoute } from 'astro';
import {
  CALENDAR_STATE_PREFIX,
  COOKIE,
  SESSION_DAYS,
  createSession,
  exchangeCalendarCode,
  exchangeCode,
  isAllowed,
  readSession,
  sealingSecret,
} from '../../lib/auth';
import { connectCalendar } from '../../lib/gcal';
import { getStore } from '../../lib/store';

export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const saved = cookies.get('wn_state')?.value;
  cookies.delete('wn_state', { path: '/' });

  // Connecting Google Calendar (not signing in): the state says so, and you must already be signed in.
  if (state?.startsWith(CALENDAR_STATE_PREFIX)) {
    if (!saved || state !== saved) return redirect('/calendar?calendar=failed');
    if (url.searchParams.get('error')) return redirect('/calendar?calendar=denied');
    let session = null;
    try {
      session = readSession(cookies.get(COOKIE)?.value);
    } catch {
      session = null;
    }
    if (!session) return redirect('/auth/login');
    if (!code) return redirect('/calendar?calendar=failed');
    try {
      const google = await exchangeCalendarCode(url.origin, code);
      // Only attach the connection to the person who is signed in here, never to whoever the Google account turns out to be.
      if (google.email !== session.email) return redirect('/calendar?calendar=wrong-account');
      if (!google.refreshToken) return redirect('/calendar?calendar=failed');
      await connectCalendar(getStore(), sealingSecret(), session.email, google.refreshToken);
      return redirect('/calendar?calendar=connected');
    } catch {
      return redirect('/calendar?calendar=failed');
    }
  }

  if (!state || !saved || state !== saved || !code) return redirect('/auth/login?error=state');
  try {
    const user = await exchangeCode(url.origin, code);
    if (!user.verified || !isAllowed(user.email)) return redirect('/auth/login?error=denied');
    cookies.set(COOKIE, createSession(user.email, user.name), {
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      path: '/',
      maxAge: SESSION_DAYS * 86400,
    });
    return redirect('/');
  } catch {
    return redirect('/auth/login?error=failed');
  }
};
