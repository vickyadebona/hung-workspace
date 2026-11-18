import { useMemo } from 'react';
import { CalendarDaysIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from '@/components/ui/sidebar';
import { addDays, dayLabel, groupByDay, localKey, startOfDay, timeLabel } from '../lib/calendar-days';
import { useCalendar } from './use-calendar';

const DAYS = 3;
const MAX_SHOWN = 8;

/** The next three days of your own Google Calendar, in the sidebar (read only). */
export default function UpcomingEvents({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const { from, to, keys } = useMemo(() => {
    const start = startOfDay(new Date());
    return { from: start, to: addDays(start, DAYS), keys: Array.from({ length: DAYS }, (_, i) => localKey(addDays(start, i))) };
    // a new day starts a new window; checking the day on each render is cheap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localKey(new Date())]);
  const { state } = useCalendar(from, to);

  if (state.kind === 'not-configured') return null; // Google isn't set up for this app, so there is nothing to connect

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Upcoming</SidebarGroupLabel>
      <SidebarGroupContent className="px-2 text-sm">
        {state.kind === 'loading' && (
          <div className="flex flex-col gap-2 py-1" role="status" aria-label="Loading your calendar">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}

        {(state.kind === 'not-connected' || state.kind === 'expired') && (
          <div className="rounded-lg border bg-sidebar-accent/40 p-2.5">
            <p className="mb-2 text-xs text-muted-foreground">
              {state.kind === 'expired' ? 'Your Google Calendar connection ended. Reconnect to see your next 3 days.' : 'Connect Google Calendar to see your next 3 days here. Read only.'}
            </p>
            <Button size="sm" variant="outline" className="w-full" onClick={() => (window.location.href = '/auth/calendar')}>
              <CalendarDaysIcon /> {state.kind === 'expired' ? 'Reconnect' : 'Connect Google Calendar'}
            </Button>
          </div>
        )}

        {state.kind === 'error' && <p className="text-xs text-muted-foreground">Couldn't load your calendar right now.</p>}

        {state.kind === 'ready' && <Agenda events={state.events} keys={keys} onOpenCalendar={onOpenCalendar} />}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function Agenda({ events, keys, onOpenCalendar }: { events: Parameters<typeof groupByDay>[0]; keys: string[]; onOpenCalendar: () => void }) {
  const grouped = groupByDay(events, keys);
  let shown = 0;
  let hidden = 0;
  const total = keys.reduce((n, k) => n + (grouped.get(k)?.length ?? 0), 0);
  return (
    <div className="flex flex-col gap-2 pb-1">
      {total === 0 && <p className="text-xs text-muted-foreground">Nothing on your calendar for the next 3 days.</p>}
      {keys.map((k) => {
        const list = grouped.get(k) ?? [];
        if (list.length === 0) return null;
        const room = Math.max(0, MAX_SHOWN - shown);
        const visible = list.slice(0, room);
        shown += visible.length;
        hidden += list.length - visible.length;
        if (visible.length === 0) return null;
        return (
          <section key={k} aria-label={dayLabel(k)}>
            <h3 className="mb-0.5 text-xs font-medium text-muted-foreground">{dayLabel(k)}</h3>
            <ul>
              {visible.map((e) => {
                const inner = (
                  <>
                    <span className="mt-1.5 size-2 flex-none rounded-full" style={{ background: e.color }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {timeLabel(e)}
                        {e.location ? ` · ${e.location}` : ''}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={`${k}-${e.id}`}>
                    {e.link ? (
                      <a href={e.link} target="_blank" rel="noopener noreferrer" className="flex gap-2 rounded-md px-1 py-1 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring" title="Open in Google Calendar">
                        {inner}
                      </a>
                    ) : (
                      <div className="flex gap-2 px-1 py-1">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <Button variant="ghost" size="sm" className="justify-start px-1 text-xs text-muted-foreground" onClick={onOpenCalendar}>
        {hidden > 0 ? `+${hidden} more · ` : ''}Open calendar
      </Button>
    </div>
  );
}
