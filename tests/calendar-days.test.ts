import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, eventDays, groupByDay, localKey, timeLabel } from '../src/lib/calendar-days.ts';
import type { CalendarEvent } from '../src/lib/gcal.ts';

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: 'x', calendarId: 'c', calendarName: 'C', color: '#000', title: 'T', start: '', end: '', allDay: false, location: '', link: '', ...over });
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

test('a timed event belongs to its own day; one ending exactly at midnight does not spill over', () => {
  assert.deepEqual(eventDays(ev({ start: local(2026, 11, 18, 15), end: local(2026, 11, 18, 16) })), ['2026-11-18']);
  assert.deepEqual(eventDays(ev({ start: local(2026, 11, 18, 22), end: local(2026, 11, 19, 0) })), ['2026-11-18']);
  assert.deepEqual(eventDays(ev({ start: local(2026, 11, 18, 22), end: local(2026, 11, 19, 1) })), ['2026-11-18', '2026-11-19']);
});

test('an all-day event covers its days; Google gives the end as the day after the last one', () => {
  assert.deepEqual(eventDays(ev({ allDay: true, start: '2026-11-20', end: '2026-11-21' })), ['2026-11-20']);
  assert.deepEqual(eventDays(ev({ allDay: true, start: '2026-11-20', end: '2026-11-23' })), ['2026-11-20', '2026-11-21', '2026-11-22']);
});

test('grouping puts all-day events first, then earlier before later, and ignores days outside the window', () => {
  const events = [
    ev({ id: 'late', title: 'Late', start: local(2026, 11, 18, 20), end: local(2026, 11, 18, 21) }),
    ev({ id: 'ad', title: 'Birthday', allDay: true, start: '2026-11-18', end: '2026-11-19' }),
    ev({ id: 'early', title: 'Early', start: local(2026, 11, 18, 8), end: local(2026, 11, 18, 9) }),
    ev({ id: 'far', title: 'Far', start: local(2026, 12, 25, 8), end: local(2026, 12, 25, 9) }),
  ];
  const g = groupByDay(events, ['2026-11-18', '2026-11-19']);
  assert.deepEqual(g.get('2026-11-18')!.map((e) => e.id), ['ad', 'early', 'late']);
  assert.deepEqual(g.get('2026-11-19'), []);
  assert.equal(g.has('2026-12-25'), false);
});

test('labels', () => {
  const today = new Date(2026, 10, 18, 12);
  assert.equal(dayLabel('2026-11-18', today), 'Today');
  assert.equal(dayLabel('2026-11-19', today), 'Tomorrow');
  assert.match(dayLabel('2026-11-21', today), /Nov/);
  assert.equal(timeLabel(ev({ allDay: true, start: '2026-11-18', end: '2026-11-19' })), 'All day');
  assert.match(timeLabel(ev({ start: local(2026, 11, 18, 15, 30), end: local(2026, 11, 18, 16) })), /3:30/);
  assert.equal(localKey(new Date(2026, 0, 5)), '2026-01-05');
});
