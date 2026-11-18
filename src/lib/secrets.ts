import crypto from 'node:crypto';

/**
 * Seal a small secret (like a Google refresh token) so it is not readable in the database or files.
 * AES-256-GCM with a key derived from the app's SESSION_SECRET: change that secret and sealed values stop opening
 * (people just reconnect). Output looks like "v1.<base64url>".
 */
const keyFor = (secret: string) => crypto.createHash('sha256').update('hung-workspace/sealed-secrets/v1/' + secret).digest();

export function sealSecret(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Returns the original text, or null if the value is damaged or was sealed with a different secret. */
export function openSecret(sealed: string, secret: string): string | null {
  try {
    if (!sealed.startsWith('v1.')) return null;
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
