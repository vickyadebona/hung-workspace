import { CALENDAR_SCOPES, env, googleConfigured, sealingSecret } from './auth';
import { listEvents, mockEvents, disconnectCalendar, isConnected, type CalendarResult, type GcalDeps } from './gcal';
import { getStore } from './store';

export { CALENDAR_SCOPES };

function deps(): GcalDeps {
  return { fetch, clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET'), sealKey: sealingSecret(), store: getStore() };
}

/** Example events are only for trying the screens locally: they need AUTH_DEV=1 (never on the live site) and CALENDAR_MOCK=1. */
const mockOn = () => env('AUTH_DEV') === '1' && env('CALENDAR_MOCK') === '1';

export interface CalendarStatus {
  /** Is Google sign-in set up for this app at all? Without it the calendar can't be connected. */
  configured: boolean;
  connected: boolean;
}

export async function calendarStatus(email: string): Promise<CalendarStatus> {
  if (mockOn()) return { configured: true, connected: true };
  return { configured: googleConfigured(), connected: await isConnected(deps(), email) };
}

export async function calendarEvents(email: string, from: string, to: string): Promise<CalendarResult & { configured: boolean }> {
  if (mockOn()) return { ...mockEvents(from, to), configured: true };
  return { ...(await listEvents(deps(), email, from, to)), configured: googleConfigured() };
}

export async function disconnect(email: string): Promise<void> {
  await disconnectCalendar(deps(), email);
}
