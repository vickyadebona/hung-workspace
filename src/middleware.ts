import { defineMiddleware } from 'astro:middleware';
import { COOKIE, readSession } from './lib/auth';

// Public: the sign-in pages and the files a browser needs before you are signed in (icons, install manifest).
const PUBLIC_PREFIXES = ['/auth/', '/favicon', '/_astro/', '/icons/', '/manifest.webmanifest'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  // /mcp is the connector for Claude and other tools: it checks its own access token instead of a sign-in cookie.
  if (pathname === '/mcp' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return next();

  let session = null;
  try {
    session = readSession(context.cookies.get(COOKIE)?.value);
  } catch {
    session = null;
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return context.redirect('/auth/login');
  }

  // Block cross-site writes. Browsers send Origin on POST/PUT/DELETE; its host must match the host
  // this request was addressed to (compared by host, so localhost vs 127.0.0.1 and proxies still work).
  if (pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(context.request.method)) {
    const h = context.request.headers;
    const origin = h.get('origin');
    let sameSite = true;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      const hosts = [h.get('host'), h.get('x-forwarded-host'), context.url.host].filter(Boolean);
      sameSite = hosts.includes(originHost);
    }
    if (h.get('sec-fetch-site') === 'cross-site') sameSite = false;
    if (!sameSite) {
      return new Response(JSON.stringify({ error: 'Bad origin' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  context.locals.user = session;
  return next();
});
