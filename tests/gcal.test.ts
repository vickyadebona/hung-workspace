import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilePageStore } from '../src/lib/storage.ts';
import { openSecret, sealSecret } from '../src/lib/secrets.ts';
import { PROVIDER, clearCalendarCache, connectCalendar, disconnectCalendar, isConnected, listEvents, normalizeEvent, type GcalDeps } from '../src/lib/gcal.ts';
import { CALENDAR_SCOPES, calendarAuthUrl, exchangeCalendarCode } from '../src/lib/auth.ts';

const VICKY = 'vicky@example.com';
const ANDREW = 'andrew@example.com';
const KEY = 'test-session-secret';
const FROM = '2026-11-18T00:00:00.000Z';
const TO = '2026-11-21T00:00:00.000Z';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A pretend Google. Records what it was asked, and answers from `calendars`/`events`. */
function fakeGoogle(opts: { calendars?: any[]; events?: Record<string, any[]>; tokenStatus?: number; failCalendar?: string } = {}) {
  const calls: { url: string; auth?: string; body?: string }[] = [];
  const f = (async (input: any, init?: any) => {
    const url = String(input);
    const auth = init?.headers?.authorization as string | undefined;
    calls.push({ url, auth, body: init?.body ? String(init.body) : undefined });
    if (url === 'https://oauth2.googleapis.com/token') {
      const refresh = new URLSearchParams(String(init.body)).get('refresh_token');
      if (opts.tokenStatus) return json({ error: 'invalid_grant' }, opts.tokenStatus);
      return json({ access_token: `access-for-${refresh}`, expires_in: 3600 });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') return json({});
    if (url.includes('/calendarList')) return json({ items: opts.calendars ?? [{ id: 'primary', summary: 'Vicky', backgroundColor: '#123456', selected: true, accessRole: 'owner' }] });
    const m = url.match(/\/calendars\/([^/]+)\/events/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (id === opts.failCalendar) return json({ error: 'nope' }, 403);
      return json({ items: opts.events?.[id] ?? [] });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetch: f, calls };
}

async function setup(google: ReturnType<typeof fakeGoogle>, now = () => 1_000_000) {
  const store = new FilePageStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wn-gc-')));
  const deps: GcalDeps = { fetch: google.fetch, clientId: 'cid', clientSecret: 'csecret', sealKey: KEY, store, now };
  clearCalendarCache();
  return { store, deps };
}

test('sealed secrets open only with the same key, and tampering is detected', () => {
  const sealed = sealSecret('refresh-token-123', KEY);
  assert.ok(sealed.startsWith('v1.'));
  assert.ok(!sealed.includes('refresh-token-123'));
  assert.equal(openSecret(sealed, KEY), 'refresh-token-123');
  assert.equal(openSecret(sealed, 'another-secret'), null);
  assert.equal(openSecret(sealed.slice(0, -3) + 'AAA', KEY), null);
  assert.equal(openSecret('garbage', KEY), null);
  assert.notEqual(sealSecret('x', KEY), sealSecret('x', KEY)); // a fresh random value each time
});

test('the stored connection is sealed on disk, never the plain token', async () => {
  const g = fakeGoogle();
  const { store, deps } = await setup(g);
  const dir = (store as any).dir as string;
  await connectCalendar(store, KEY, VICKY, 'super-secret-refresh-token');
  const raw = await fs.readFile(path.join(dir, '.integrations.json'), 'utf8');
  assert.ok(!raw.includes('super-secret-refresh-token'));
  assert.equal(await isConnected(deps, VICKY), true);
  assert.equal(await isConnected(deps, ANDREW), false);
  assert.equal(((await fs.stat(path.join(dir, '.integrations.json'))).mode & 0o077), 0); // owner-only file
});

test('not connected: nothing is requested from Google', async () => {
  const g = fakeGoogle();
  const { deps } = await setup(g);
  assert.deepEqual(await listEvents(deps, VICKY, FROM, TO), { connected: false, reason: 'not-connected' });
  assert.equal(g.calls.length, 0);
});

test('events come back merged from the calendars you have ticked, sorted, without declined or cancelled ones', async () => {
  const g = fakeGoogle({
    calendars: [
      { id: 'primary', summary: 'Vicky', backgroundColor: '#111', selected: true, accessRole: 'owner' },
      { id: 'work', summary: 'Work', summaryOverride: 'TerraScape', backgroundColor: '#222', selected: true, accessRole: 'reader' },
      { id: 'holidays', summary: 'Holidays', selected: false, accessRole: 'reader' }, // not ticked in Google Calendar
    ],
    events: {
      primary: [
        { id: 'e2', summary: 'Dentist', start: { dateTime: '2026-11-19T17:00:00Z' }, end: { dateTime: '2026-11-19T18:00:00Z' }, htmlLink: 'https://www.google.com/calendar/event?eid=a' },
        { id: 'e3', summary: 'Declined meeting', start: { dateTime: '2026-11-19T10:00:00Z' }, end: { dateTime: '2026-11-19T11:00:00Z' }, attendees: [{ self: true, responseStatus: 'declined' }] },
        { id: 'e4', status: 'cancelled', summary: 'Gone', start: { dateTime: '2026-11-19T12:00:00Z' }, end: { dateTime: '2026-11-19T13:00:00Z' } },
      ],
      work: [
        { id: 'w1', summary: 'Planning', location: 'Zoom', start: { dateTime: '2026-11-18T20:00:00Z' }, end: { dateTime: '2026-11-18T21:00:00Z' } },
        { id: 'w2', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } },
      ],
    },
  });
  const { store, deps } = await setup(g);
  await connectCalendar(store, KEY, VICKY, 'rt-vicky');
  const r = await listEvents(deps, VICKY, FROM, TO);
  assert.ok(r.connected);
  if (!r.connected) return;
  assert.deepEqual(r.calendars.map((c) => c.name), ['Vicky', 'TerraScape']);
  assert.deepEqual(r.events.map((e) => e.title), ['Planning', 'Dentist', '(No title)']);
  const planning = r.events[0];
  assert.equal(planning.calendarName, 'TerraScape');
  assert.equal(planning.location, 'Zoom');
  assert.equal(planning.allDay, false);
  assert.equal(r.events[2].allDay, true);
  assert.equal(r.events[2].start, '2026-11-20');
  assert.equal(r.events[1].link, 'https://www.google.com/calendar/event?eid=a');
  // the access token came from the refresh token, and the holidays calendar (not ticked) was never fetched
  assert.ok(g.calls.some((c) => c.auth === 'Bearer access-for-rt-vicky'));
  assert.ok(!g.calls.some((c) => c.url.includes('holidays')));
});

test('each person only ever gets their own calendar, using their own token', async () => {
  const g = fakeGoogle({ events: { primary: [{ id: 'x', summary: 'Shared name', start: { dateTime: '2026-11-19T10:00:00Z' }, end: { dateTime: '2026-11-19T11:00:00Z' } }] } });
  const { store, deps } = await setup(g);
  await connectCalendar(store, KEY, VICKY, 'rt-vicky');
  await connectCalendar(store, KEY, ANDREW, 'rt-andrew');
  await listEvents(deps, VICKY, FROM, TO);
  await listEvents(deps, ANDREW, FROM, TO);
  const eventCalls = g.calls.filter((c) => c.url.includes('/events'));
  assert.deepEqual(eventCalls.map((c) => c.auth), ['Bearer access-for-rt-vicky', 'Bearer access-for-rt-andrew']);
  // a person with no connection gets nothing, even though others are connected
  assert.deepEqual(await listEvents(deps, 'stranger@example.com', FROM, TO), { connected: false, reason: 'not-connected' });
});

test('access tokens and short-lived results are reused instead of asking Google every time', async () => {
  const g = fakeGoogle();
  let t = 1_000_000;
  const { store, deps } = await setup(g, () => t);
  await connectCalendar(store, KEY, VICKY, 'rt');
  await listEvents(deps, VICKY, FROM, TO);
  await listEvents(deps, VICKY, FROM, TO);
  assert.equal(g.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').length, 1);
  assert.equal(g.calls.filter((c) => c.url.includes('/events')).length, 1);
  t += 61_000; // a minute later the results are fetched again, but the access token is still good
  await listEvents(deps, VICKY, FROM, TO);
  assert.equal(g.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').length, 1);
  assert.equal(g.calls.filter((c) => c.url.includes('/events')).length, 2);
});

test('one calendar failing does not hide the others', async () => {
  const g = fakeGoogle({
    calendars: [{ id: 'a', summary: 'A', selected: true }, { id: 'b', summary: 'B', selected: true }],
    events: { b: [{ id: '1', summary: 'Still here', start: { dateTime: '2026-11-19T10:00:00Z' }, end: { dateTime: '2026-11-19T11:00:00Z' } }] },
    failCalendar: 'a',
  });
  const { store, deps } = await setup(g);
  await connectCalendar(store, KEY, VICKY, 'rt');
  const r = await listEvents(deps, VICKY, FROM, TO);
  assert.ok(r.connected && r.events.length === 1 && r.events[0].title === 'Still here');
});

test('when Google no longer accepts the connection it is forgotten, and the person is told to reconnect', async () => {
  const g = fakeGoogle({ tokenStatus: 400 });
  const { store, deps } = await setup(g);
  await connectCalendar(store, KEY, VICKY, 'revoked');
  assert.deepEqual(await listEvents(deps, VICKY, FROM, TO), { connected: false, reason: 'expired' });
  assert.equal(await store.getIntegration(VICKY, PROVIDER), null);
  assert.deepEqual(await listEvents(deps, VICKY, FROM, TO), { connected: false, reason: 'not-connected' });
});

test('a connection sealed with a different secret counts as expired', async () => {
  const g = fakeGoogle();
  const { store, deps } = await setup(g);
  await connectCalendar(store, 'old-secret', VICKY, 'rt');
  assert.deepEqual(await listEvents(deps, VICKY, FROM, TO), { connected: false, reason: 'expired' });
});

test('disconnecting forgets the token and asks Google to revoke it', async () => {
  const g = fakeGoogle();
  const { store, deps } = await setup(g);
  await connectCalendar(store, KEY, VICKY, 'rt-bye');
  await disconnectCalendar(deps, VICKY);
  assert.equal(await store.getIntegration(VICKY, PROVIDER), null);
  const revoke = g.calls.find((c) => c.url === 'https://oauth2.googleapis.com/revoke');
  assert.ok(revoke && revoke.body?.includes('rt-bye'));
});

test('time ranges are checked', async () => {
  const g = fakeGoogle();
  const { deps } = await setup(g);
  await assert.rejects(() => listEvents(deps, VICKY, 'nope', TO), /valid time range/);
  await assert.rejects(() => listEvents(deps, VICKY, TO, FROM), /valid time range/);
  await assert.rejects(() => listEvents(deps, VICKY, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'), /at most 45 days/);
});

test('events without a title or an unsafe link are cleaned up', () => {
  const e = normalizeEvent({ id: '1', start: { dateTime: '2026-11-19T10:00:00Z' }, end: { dateTime: '2026-11-19T11:00:00Z' }, htmlLink: 'javascript:alert(1)' }, { id: 'c', name: 'C', color: '#000' });
  assert.equal(e?.title, '(No title)');
  assert.equal(e?.link, '');
  assert.equal(normalizeEvent({ id: '2' }, { id: 'c', name: 'C', color: '#000' }), null);
});

test('connecting asks only for read-only calendar access, offline, and the code is tied to the right Google account', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'csecret';
  const url = new URL(calendarAuthUrl('https://app.example.com', 'cal.abc', VICKY));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('login_hint'), VICKY);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/auth/callback');
  const scopes = (url.searchParams.get('scope') ?? '').split(' ');
  assert.deepEqual(scopes.filter((s) => s.includes('calendar')).sort(), [...CALENDAR_SCOPES].sort());
  assert.ok(scopes.every((s) => ['openid', 'email'].includes(s) || s.endsWith('.readonly')), 'only read-only scopes');
  const fake = (async (input: any) => {
    const u = String(input);
    if (u.includes('token')) return json({ access_token: 'at', refresh_token: 'rt', scope: scopes.join(' ') });
    return json({ email: 'Vicky@Example.com', email_verified: true });
  }) as typeof fetch;
  const got = await exchangeCalendarCode('https://app.example.com', 'code', fake);
  assert.deepEqual(got, { email: VICKY, refreshToken: 'rt', scope: scopes.join(' ') });
  const unverified = (async (input: any) => (String(input).includes('token') ? json({ access_token: 'at' }) : json({ email: VICKY, email_verified: false }))) as typeof fetch;
  await assert.rejects(() => exchangeCalendarCode('https://app.example.com', 'c', unverified), /confirm/);
});
