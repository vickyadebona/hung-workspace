import type { APIRoute } from 'astro';
import { googleAuthUrl, googleConfigured, randomState } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  if (!googleConfigured()) return redirect('/auth/login?error=failed');
  const state = randomState();
  cookies.set('wn_state', state, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/', maxAge: 600 });
  return redirect(googleAuthUrl(url.origin, state));
};
