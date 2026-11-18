import crypto from 'node:crypto';
import type { PageStore } from './storage.ts';
import { openSecret, sealSecret } from './secrets.ts';

/**
 * Personal access tokens: let a tool you trust (Claude, Duet, a script) act as you over the connector at /mcp.
 * A token looks like "hw_<your email, encoded>.<random secret>". Only a hash of the secret is stored (sealed, per person),
 * so a token is shown once when it is made and cannot be read back, only revoked.
 */
const PROVIDER = 'api-tokens';
const MAX_TOKENS = 10;

interface Entry {
  id: string;
  label: string;
  hash: string;
  createdAt: string;
}
export interface TokenInfo {
  id: string;
  label: string;
  createdAt: string;
}

const hashOf = (secret: string) => crypto.createHash('sha256').update(secret).digest('hex');
const emailKey = (email: string) => email.trim().toLowerCase();

async function load(store: PageStore, sealKey: string, email: string): Promise<Entry[]> {
  const sealed = await store.getIntegration(email, PROVIDER);
  const plain = sealed ? openSecret(sealed, sealKey) : null;
  if (!plain) return [];
  try {
    const v = JSON.parse(plain);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function save(store: PageStore, sealKey: string, email: string, entries: Entry[]): Promise<void> {
  if (entries.length === 0) await store.deleteIntegration(email, PROVIDER);
  else await store.saveIntegration(email, PROVIDER, sealSecret(JSON.stringify(entries), sealKey));
}

const strip = (e: Entry): TokenInfo => ({ id: e.id, label: e.label, createdAt: e.createdAt });

export async function listTokens(store: PageStore, sealKey: string, email: string): Promise<TokenInfo[]> {
  return (await load(store, sealKey, emailKey(email))).map(strip);
}

/** Makes a token. The returned `token` is the only time it can be seen. */
export async function createToken(store: PageStore, sealKey: string, email: string, label: string): Promise<{ info: TokenInfo; token: string }> {
  const who = emailKey(email);
  const entries = await load(store, sealKey, who);
  if (entries.length >= MAX_TOKENS) throw new Error(`You can have up to ${MAX_TOKENS} tokens. Revoke one you no longer use first.`);
  const secret = crypto.randomBytes(32).toString('base64url');
  const entry: Entry = {
    id: crypto.randomBytes(6).toString('hex'),
    label: label.trim().slice(0, 60) || 'Untitled',
    hash: hashOf(secret),
    createdAt: new Date().toISOString(),
  };
  await save(store, sealKey, who, [...entries, entry]);
  return { info: strip(entry), token: `hw_${Buffer.from(who).toString('base64url')}.${secret}` };
}

export async function revokeToken(store: PageStore, sealKey: string, email: string, id: string): Promise<boolean> {
  const who = emailKey(email);
  const entries = await load(store, sealKey, who);
  const rest = entries.filter((e) => e.id !== id);
  if (rest.length === entries.length) return false;
  await save(store, sealKey, who, rest);
  return true;
}

/** The email a token belongs to, or null if it is not (or no longer) valid. */
export async function verifyToken(store: PageStore, sealKey: string, token: string): Promise<string | null> {
  const m = /^hw_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,})$/.exec(token.trim());
  if (!m) return null;
  let email = '';
  try {
    email = Buffer.from(m[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email.includes('@')) return null;
  const want = Buffer.from(hashOf(m[2]));
  const entries = await load(store, sealKey, emailKey(email));
  let ok = false;
  for (const e of entries) {
    const have = Buffer.from(e.hash);
    if (have.length === want.length && crypto.timingSafeEqual(have, want)) ok = true; // no early exit: same work either way
  }
  return ok ? emailKey(email) : null;
}
