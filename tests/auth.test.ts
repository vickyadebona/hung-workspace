import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-value';
process.env.ALLOWED_EMAILS = 'Vicky@Example.com, andrew@example.com';
const { createSession, readSession, isAllowed } = await import('../src/lib/auth.ts');

test('valid session round-trips', () => {
  const s = readSession(createSession('vicky@example.com', 'Vicky'));
  assert.equal(s?.email, 'vicky@example.com');
});

test('allow-list is case-insensitive and trims', () => {
  assert.ok(isAllowed('VICKY@example.com'));
  assert.ok(isAllowed(' andrew@example.com '));
  assert.ok(!isAllowed('eve@example.com'));
});

test('tampered cookie is rejected', () => {
  const c = createSession('vicky@example.com', 'Vicky');
  const [body, sig] = c.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'eve@example.com', name: 'x', exp: 9999999999 })).toString('base64url');
  assert.equal(readSession(`${forged}.${sig}`), null);
  assert.equal(readSession(`${body}.AAAA`), null);
  assert.equal(readSession('garbage'), null);
  assert.equal(readSession(undefined), null);
});

test('someone removed from the allow-list is signed out', () => {
  const c = createSession('andrew@example.com', 'Andrew');
  process.env.ALLOWED_EMAILS = 'vicky@example.com';
  assert.equal(readSession(c), null);
  process.env.ALLOWED_EMAILS = 'Vicky@Example.com, andrew@example.com';
});
