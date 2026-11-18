import type { APIRoute } from 'astro';
import { calendarEvents, calendarStatus, disconnect } from '../../lib/calendar-service';
import { fail, json } from '../../lib/http';

/**
 * Your own Google Calendar events, read only. With ?from=&to= (ISO date-times, at most 45 days apart) it returns the events;
 * without them it only says whether you are connected. The person is always the signed-in one; there is no way to ask for anyone else's.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  try {
    if (!from || !to) return json(await calendarStatus(locals.user.email));
    return json(await calendarEvents(locals.user.email, from, to));
  } catch (e) {
    return fail(e);
  }
};

/** Disconnect your Google Calendar: forgets the stored permission and asks Google to revoke it. */
export const DELETE: APIRoute = async ({ locals }) => {
  try {
    await disconnect(locals.user.email);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
};
