/** Which part of the day-by-day picture a task falls in, relative to `today` (YYYY-MM-DD). Kept apart from the server code so the browser can use it. */
export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'nodate';

export function bucketOf(due: string | null, today: string): TaskBucket {
  if (!due) return 'nodate';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const week = new Date(today + 'T00:00:00Z');
  week.setUTCDate(week.getUTCDate() + 7);
  return due <= week.toISOString().slice(0, 10) ? 'week' : 'later';
}
