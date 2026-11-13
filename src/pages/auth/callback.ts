import type { APIRoute } from 'astro';
import { COOKIE, SESSION_DAYS, createSession, exchangeCode, isAllowed } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const saved = cookies.get('wn_state')?.value;
  cookies.delete('wn_state', { path: '/' });
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
