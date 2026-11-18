import type { CalendarEvent } from './gcal.ts';

/** Helpers for laying events out by day in the browser's own time zone. Pure, so they can be tested. */

const pad = (n: number) => String(n).padStart(2, '0');

/** A date as YYYY-MM-DD in local time. */
export function localKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** A date-only string (an all-day event's start or end) as a local date. */
function dateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Every local day (YYYY-MM-DD) an event covers. All-day events end the day before their `end`; timed events that stop exactly at midnight don't spill into that day. */
export function eventDays(e: CalendarEvent): string[] {
  if (e.allDay) {
    const first = dateOnly(e.start);
    const lastExclusive = dateOnly(e.end);
    const out: string[] = [];
    for (let d = first; d < lastExclusive && out.length < 62; d = addDays(d, 1)) out.push(localKey(d));
    return out.length ? out : [localKey(first)];
  }
  const start = new Date(e.start);
  const end = new Date(e.end);
  const out: string[] = [];
  const last = end > start && end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 ? addDays(startOfDay(end), -1) : startOfDay(end);
  for (let d = startOfDay(start); d <= last && out.length < 62; d = addDays(d, 1)) out.push(localKey(d));
  return out.length ? out : [localKey(start)];
}

/** Events grouped under each of the given days; all-day events first, then by start time. */
export function groupByDay(events: CalendarEvent[], keys: string[]): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>(keys.map((k) => [k, []]));
  for (const e of events) for (const k of eventDays(e)) out.get(k)?.push(e);
  const startMs = (e: CalendarEvent) => (e.allDay ? dateOnly(e.start).getTime() : Date.parse(e.start));
  for (const list of out.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || startMs(a) - startMs(b) || a.title.localeCompare(b.title));
  return out;
}

export function timeLabel(e: CalendarEvent): string {
  if (e.allDay) return 'All day';
  return new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Tomorrow", or "Fri, Nov 20". */
export function dayLabel(key: string, today: Date = new Date()): string {
  const d = dateOnly(key);
  const t = startOfDay(today);
  if (localKey(d) === localKey(t)) return 'Today';
  if (localKey(d) === localKey(addDays(t, 1))) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
