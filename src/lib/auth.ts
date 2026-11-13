import crypto from 'node:crypto';

export interface Session {
  email: string;
  name: string;
  exp: number; // unix seconds
}

export const COOKIE = 'wn_session';
export const SESSION_DAYS = 30;

export function env(name: string): string {
  return process.env[name] ?? ((import.meta.env ?? {}) as Record<string, string | undefined>)[name] ?? '';
}

export function allowedEmails(): string[] {
  return env('ALLOWED_EMAILS')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string): boolean {
  return allowedEmails().includes(email.trim().toLowerCase());
}

function secret(): string {
  const s = env('SESSION_SECRET');
  if (!s || s === 'change-me') {
    if (env('AUTH_DEV') === '1') return 'dev-only-secret-not-for-production';
    throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in.');
  }
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function sign(data: string): string {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

export function createSession(email: string, name: string): string {
  const payload: Session = {
    email: email.toLowerCase(),
    name,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  };
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function readSession(value: string | undefined): Session | null {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Session;
    if (typeof s.exp !== 'number' || s.exp < Date.now() / 1000) return null;
    if (!isAllowed(s.email)) return null; // removing someone from ALLOWED_EMAILS signs them out
    return s;
  } catch {
    return null;
  }
}

export function googleConfigured(): boolean {
  return Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
}

export function redirectUri(origin: string): string {
  return `${origin}/auth/callback`;
}

export function googleAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(
  origin: string,
  code: string,
): Promise<{ email: string; name: string; verified: boolean }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri(origin),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error('Google rejected the sign-in code');
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) throw new Error('Could not read your Google profile');
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string };
  return { email: info.email ?? '', name: info.name ?? info.email ?? '', verified: info.email_verified === true };
}

export function randomState(): string {
  return crypto.randomBytes(16).toString('base64url');
}
