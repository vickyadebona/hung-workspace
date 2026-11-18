import { useCallback, useEffect, useState } from 'react';
import { api, type CalendarEvent } from './api';

export type CalendarState =
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'not-connected' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; events: CalendarEvent[]; calendars: { id: string; name: string; color: string }[] };

/** Your own calendar events between two moments; refreshes every few minutes and when you come back to the tab. */
export function useCalendar(from: Date, to: Date): { state: CalendarState; reload: () => void } {
  const [state, setState] = useState<CalendarState>({ kind: 'loading' });
  const fromMs = from.getTime();
  const toMs = to.getTime();

  const load = useCallback(async () => {
    try {
      const r = await api.calendar(new Date(fromMs), new Date(toMs));
      if (!r.configured) setState({ kind: 'not-configured' });
      else if (!r.connected) setState({ kind: r.reason === 'expired' ? 'expired' : 'not-connected' });
      else setState({ kind: 'ready', events: r.events, calendars: r.calendars });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, [fromMs, toMs]);

  useEffect(() => {
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    load();
    const timer = setInterval(load, 5 * 60_000);
    const on = () => load();
    window.addEventListener('focus', on);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', on);
    };
  }, [load]);

  return { state, reload: load };
}
