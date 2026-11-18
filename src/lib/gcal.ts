import { openSecret, sealSecret } from './secrets.ts';

/**
 * Reading a person's own Google Calendar. Nothing here can change a calendar (the permissions asked for are read-only).
 * Everything is keyed by the signed-in person's email: a request can never ask for anyone else's events.
 */

export const PROVIDER = 'google-calendar';
const MAX_CALENDARS = 12;
const MAX_RANGE_DAYS = 45;

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string; // the calendar's colour in Google Calendar
  title: string;
  start: string; // an ISO date-time, or YYYY-MM-DD for all-day events
  end: string; // same; for all-day events the end date is the day AFTER the last day (Google's way)
  allDay: boolean;
  location: string;
  link: string; // opens the event in Google Calendar
}

export type CalendarResult =
  | { connected: false; reason: 'not-connected' | 'expired' }
  | { connected: true; events: CalendarEvent[]; calendars: { id: string; name: string; color: string }[] };

/** What this module needs from the outside world, so tests can supply fakes. */
export interface GcalDeps {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  /** The key material used to seal stored tokens. */
  sealKey: string;
  store: {
    getIntegration(email: string, provider: string): Promise<string | null>;
    deleteIntegration(email: string, provider: string): Promise<void>;
  };
  now?: () => number;
}

/** Remember a person's refresh token, sealed. */
export async function connectCalendar(
  store: { saveIntegration(email: string, provider: string, sealed: string): Promise<void> },
  sealKey: string,
  email: string,
  refreshToken: string,
): Promise<void> {
  await store.saveIntegration(email, PROVIDER, sealSecret(JSON.stringify({ refreshToken }), sealKey));
}

export async function isConnected(deps: Pick<GcalDeps, 'store' | 'sealKey'>, email: string): Promise<boolean> {
  const sealed = await deps.store.getIntegration(email, PROVIDER);
  return !!sealed && openSecret(sealed, deps.sealKey) !== null;
}

/** Forget the connection and (best effort) tell Google to revoke it. */
export async function disconnectCalendar(deps: GcalDeps, email: string): Promise<void> {
  const sealed = await deps.store.getIntegration(email, PROVIDER);
  const plain = sealed ? openSecret(sealed, deps.sealKey) : null;
  await deps.store.deleteIntegration(email, PROVIDER);
  cache.delete(email);
  if (plain) {
    try {
      const { refreshToken } = JSON.parse(plain) as { refreshToken: string };
      await deps.fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch {
      /* revoking is a courtesy; the stored token is already gone */
    }
  }
}

/* Short-lived memory so a page full of requests doesn't ask Google every time. Per server instance; never shared between people. */
interface Cached {
  accessToken?: { value: string; expires: number };
  calendars?: { at: number; list: { id: string; name: string; color: string }[] };
  events: Map<string, { at: number; events: CalendarEvent[] }>;
}
const cache = new Map<string, Cached>();
const cacheFor = (email: string): Cached => {
  let c = cache.get(email);
  if (!c) cache.set(email, (c = { events: new Map() }));
  return c;
};
/** Test helper. */
export function clearCalendarCache() {
  cache.clear();
}

class Expired extends Error {}

async function accessToken(deps: GcalDeps, email: string): Promise<string | null> {
  const now = (deps.now ?? Date.now)();
  const c = cacheFor(email);
  if (c.accessToken && c.accessToken.expires > now + 30_000) return c.accessToken.value;
  const sealed = await deps.store.getIntegration(email, PROVIDER);
  if (!sealed) return null;
  const plain = openSecret(sealed, deps.sealKey);
  if (!plain) throw new Expired(); // sealed with an old secret or damaged: reconnect
  const { refreshToken } = JSON.parse(plain) as { refreshToken: string };
  const res = await deps.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: deps.clientId, client_secret: deps.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'invalid_grant' || res.status === 400 || res.status === 401) throw new Expired(); // revoked, or Google's 7-day limit for apps in testing
    throw new Error(`Google answered ${res.status}`);
  }
  const tok = (await res.json()) as { access_token: string; expires_in?: number };
  c.accessToken = { value: tok.access_token, expires: now + (tok.expires_in ?? 3600) * 1000 };
  return tok.access_token;
}

async function api<T>(deps: GcalDeps, token: string, url: string): Promise<T> {
  const res = await deps.fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Expired();
  if (!res.ok) throw new Error(`Google Calendar answered ${res.status}`);
  return (await res.json()) as T;
}

interface RawCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  selected?: boolean;
  accessRole?: string;
  deleted?: boolean;
}
interface RawEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

async function calendarsFor(deps: GcalDeps, email: string, token: string) {
  const c = cacheFor(email);
  const now = (deps.now ?? Date.now)();
  if (c.calendars && now - c.calendars.at < 10 * 60_000) return c.calendars.list;
  const data = await api<{ items?: RawCalendar[] }>(deps, token, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=100&fields=items(id,summary,summaryOverride,backgroundColor,selected,accessRole,deleted)');
  // the calendars you have ticked in Google Calendar (the same ones its own side bar shows)
  const list = (data.items ?? [])
    .filter((x) => x.selected && !x.deleted)
    .slice(0, MAX_CALENDARS)
    .map((x) => ({ id: x.id, name: x.summaryOverride || x.summary || x.id, color: x.backgroundColor || '#4285f4' }));
  c.calendars = { at: now, list };
  return list;
}

export function normalizeEvent(raw: RawEvent, cal: { id: string; name: string; color: string }): CalendarEvent | null {
  if (raw.status === 'cancelled') return null;
  if (raw.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const start = raw.start?.dateTime ?? raw.start?.date;
  const end = raw.end?.dateTime ?? raw.end?.date ?? start;
  if (!start || !end) return null;
  return {
    id: `${cal.id}:${raw.id}`,
    calendarId: cal.id,
    calendarName: cal.name,
    color: cal.color,
    title: raw.summary?.trim() || '(No title)',
    start,
    end,
    allDay: !raw.start?.dateTime,
    location: raw.location ?? '',
    link: raw.htmlLink && raw.htmlLink.startsWith('https://') ? raw.htmlLink : '',
  };
}

/**
 * The events on a person's selected calendars between two moments (ISO date-times, at most 45 days apart), earliest first.
 * Returns { connected: false } when they haven't connected, or when Google no longer accepts their connection (in which
 * case it is forgotten, so the app offers "Connect" again).
 */
export async function listEvents(deps: GcalDeps, email: string, from: string, to: string): Promise<CalendarResult> {
  const t0 = Date.parse(from);
  const t1 = Date.parse(to);
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) throw new Error('Choose a valid time range');
  if ((t1 - t0) / 86_400_000 > MAX_RANGE_DAYS) throw new Error(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  const now = (deps.now ?? Date.now)();
  const c = cacheFor(email);
  try {
    const token = await accessToken(deps, email);
    if (!token) return { connected: false, reason: 'not-connected' };
    const calendars = await calendarsFor(deps, email, token);
    const key = `${from}|${to}`;
    const hit = c.events.get(key);
    if (hit && now - hit.at < 60_000) return { connected: true, events: hit.events, calendars };
    const batches = await Promise.all(
      calendars.map(async (cal) => {
        const url =
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250` +
          `&timeMin=${encodeURIComponent(new Date(t0).toISOString())}&timeMax=${encodeURIComponent(new Date(t1).toISOString())}` +
          `&fields=items(id,status,summary,location,htmlLink,start,end,attendees(self,responseStatus))`;
        try {
          return ((await api<{ items?: RawEvent[] }>(deps, token, url)).items ?? []).map((e) => normalizeEvent(e, cal)).filter((e): e is CalendarEvent => !!e);
        } catch (e) {
          if (e instanceof Expired) throw e;
          return []; // one calendar failing (say, one you lost access to) shouldn't hide the rest
        }
      }),
    );
    const events = batches.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
    // keep the memory small: at most a handful of ranges per person
    if (c.events.size > 8) c.events.clear();
    c.events.set(key, { at: now, events });
    return { connected: true, events, calendars };
  } catch (e) {
    if (e instanceof Expired) {
      await deps.store.deleteIntegration(email, PROVIDER);
      cache.delete(email);
      return { connected: false, reason: 'expired' };
    }
    throw e;
  }
}

/** Example events for trying the screens on a computer without a Google connection. Only ever used with AUTH_DEV=1 and CALENDAR_MOCK=1. */
export function mockEvents(from: string, to: string): CalendarResult {
  const t0 = new Date(from);
  const day = (n: number, h: number, m = 0, len = 60) => {
    const s = new Date(t0);
    s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() + n);
    s.setHours(h, m, 0, 0);
    return { start: s.toISOString(), end: new Date(s.getTime() + len * 60_000).toISOString() };
  };
  const cal = { id: 'primary', name: 'Vicky', color: '#4285f4' };
  const work = { id: 'work', name: 'TerraScape', color: '#0b8043' };
  const mk = (id: string, title: string, c: typeof cal, when: { start: string; end: string }, location = ''): CalendarEvent => ({
    id: `${c.id}:${id}`, calendarId: c.id, calendarName: c.name, color: c.color, title, ...when, allDay: false, location, link: 'https://calendar.google.com/',
  });
  const events: CalendarEvent[] = [
    mk('1', 'Weekly planning', work, day(0, 20, 0, 60)),
    mk('2', 'Lunch with Andrew', cal, day(1, 12, 30, 90), 'Silver Lake'),
    mk('3', 'Supplier call: plant crates', work, day(1, 15, 0, 30)),
    mk('4', 'Dentist', cal, day(2, 9, 0, 60), '123 Main St'),
    mk('5', 'Launch checklist review', work, day(3, 11, 0, 45)),
    mk('6', 'Bible study prep', cal, day(4, 19, 0, 90)),
    { id: 'primary:ad', calendarId: 'primary', calendarName: 'Vicky', color: '#4285f4', title: 'Mom’s birthday', start: day(2, 0).start.slice(0, 10), end: day(3, 0).start.slice(0, 10), allDay: true, location: '', link: 'https://calendar.google.com/' },
  ];
  // keep the ones that fall in (or touch) the asked-for range
  const lo = Date.parse(from) - 86_400_000;
  const hi = Date.parse(to) + 86_400_000;
  const when = (e: CalendarEvent) => Date.parse(e.allDay ? e.start + 'T12:00:00' : e.start);
  return { connected: true, events: events.filter((e) => when(e) >= lo && when(e) <= hi), calendars: [cal, work] };
}
