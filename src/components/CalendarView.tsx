import { useEffect, useMemo, useState } from 'react';
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addDays, dayLabel, groupByDay, localKey, startOfDay, timeLabel } from '../lib/calendar-days';
import type { CalendarEvent } from './api';
import { pageShell } from './PageEditor';
import { useCalendar } from './use-calendar';

type Mode = 'week' | 'agenda';

const NOTES: Record<string, string> = {
  connected: 'Google Calendar is connected.',
  denied: 'Google Calendar was not connected (you chose not to allow it).',
  failed: 'Something went wrong connecting Google Calendar. Please try again.',
  'wrong-account': 'That was a different Google account from the one you are signed in with. Choose the same account.',
  'not-configured': 'Google sign-in has not been set up for this app, so the calendar cannot be connected.',
};

/** Your own Google Calendar at a glance: a week, or a list of the next two weeks. Read only. */
export default function CalendarView() {
  const [mode, setMode] = useState<Mode>(() => (typeof window !== 'undefined' && window.innerWidth < 800 ? 'agenda' : 'week'));
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [note, setNote] = useState<string | null>(null);

  // Coming back from Google: show what happened, then tidy the address.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('calendar');
    if (q && NOTES[q]) {
      setNote(NOTES[q]);
      history.replaceState(null, '', '/calendar');
    }
  }, []);

  const weekStart = useMemo(() => addDays(anchor, -anchor.getDay()), [anchor]); // weeks start on Sunday
  const range = useMemo(() => (mode === 'week' ? { from: weekStart, days: 7 } : { from: anchor, days: 14 }), [mode, weekStart, anchor]);
  const to = useMemo(() => addDays(range.from, range.days), [range]);
  const keys = useMemo(() => Array.from({ length: range.days }, (_, i) => localKey(addDays(range.from, i))), [range]);
  const { state } = useCalendar(range.from, to);
  const todayKey = localKey(new Date());
  const step = mode === 'week' ? 7 : 14;
  const title =
    mode === 'week'
      ? `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
      : `From ${anchor.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;

  return (
    <div className={cn(pageShell, 'max-w-[1200px]')}>
      <div className="mb-1 flex items-center gap-3 md:pl-[54px]">
        <CalendarDaysIcon className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Calendar</h1>
      </div>
      <p className="mb-4 text-sm text-muted-foreground md:pl-[54px]">Your Google Calendar at a glance. Read only: edit events in Google Calendar.</p>

      {note && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm md:ml-[54px]" role="status">
          {note}
          <Button size="xs" variant="ghost" onClick={() => setNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {(state.kind === 'not-connected' || state.kind === 'expired') && <ConnectCard expired={state.kind === 'expired'} />}
      {state.kind === 'not-configured' && <p className="text-muted-foreground md:pl-[54px]">Google sign-in is not set up for this app, so the calendar cannot be connected.</p>}
      {state.kind === 'error' && <p className="text-muted-foreground md:pl-[54px]">Couldn't load your calendar: {state.message}</p>}

      {(state.kind === 'loading' || state.kind === 'ready') && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 md:pl-[54px]">
            <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
              Today
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => setAnchor((a) => addDays(a, -step))}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => setAnchor((a) => addDays(a, step))}>
              <ChevronRightIcon />
            </Button>
            <strong className="ml-1 text-sm" aria-live="polite">
              {title}
            </strong>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="ml-auto">
              <TabsList>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="agenda">Agenda</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {state.kind === 'loading' ? (
            <div className="grid gap-2 md:pl-[54px]" role="status" aria-label="Loading your calendar">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : mode === 'week' ? (
            <WeekGrid events={state.events} keys={keys} todayKey={todayKey} />
          ) : (
            <AgendaList events={state.events} keys={keys} todayKey={todayKey} />
          )}

          {state.kind === 'ready' && state.calendars.length > 0 && (
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:pl-[54px]">
              {state.calendars.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden /> {c.name}
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ConnectCard({ expired }: { expired: boolean }) {
  return (
    <div className="max-w-xl rounded-xl border bg-card p-5 text-card-foreground md:ml-[54px]">
      <h2 className="mb-1 font-medium">{expired ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {expired ? 'Google stopped accepting the earlier connection (it can expire or be revoked). ' : ''}
        You will be asked to allow <strong>read-only</strong> access to your events. Hung Workspace can see them but never change them. Only you see your own calendar here, and you can disconnect any time in Settings.
      </p>
      <Button onClick={() => (window.location.href = '/auth/calendar')}>
        <CalendarDaysIcon /> {expired ? 'Reconnect' : 'Connect Google Calendar'}
      </Button>
    </div>
  );
}

function EventRow({ e, compact }: { e: CalendarEvent; compact?: boolean }) {
  const body = (
    <>
      <span className="w-1 flex-none self-stretch rounded-full" style={{ background: e.color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{timeLabel(e)}</span>
        <span className={cn('block font-medium', compact ? 'text-xs' : 'text-sm')}>{e.title}</span>
        {e.location && <span className="block truncate text-xs text-muted-foreground">{e.location}</span>}
      </span>
      {e.link && !compact && <ExternalLinkIcon className="mt-0.5 size-3.5 flex-none text-muted-foreground opacity-0 group-hover/event:opacity-100" aria-hidden />}
    </>
  );
  const cls = 'group/event flex gap-2 rounded-md border bg-card px-2 py-1.5 text-left';
  return e.link ? (
    <a href={e.link} target="_blank" rel="noopener noreferrer" className={cn(cls, 'outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50')} title="Open in Google Calendar">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function WeekGrid({ events, keys, todayKey }: { events: CalendarEvent[]; keys: string[]; todayKey: string }) {
  const grouped = groupByDay(events, keys);
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {keys.map((k) => {
        const d = new Date(k + 'T00:00:00');
        const list = grouped.get(k) ?? [];
        return (
          <section key={k} aria-label={d.toDateString()} className={cn('min-h-32 rounded-lg border p-1.5', k === todayKey && 'border-primary/60 bg-primary/5')}>
            <h3 className="mb-1.5 flex items-baseline gap-1.5 px-1 text-xs text-muted-foreground">
              <span className="uppercase">{d.toLocaleDateString([], { weekday: 'short' })}</span>
              <span className={cn('text-sm font-semibold text-foreground', k === todayKey && 'rounded-full bg-primary px-1.5 text-primary-foreground')}>{d.getDate()}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {list.map((e) => (
                <li key={`${k}-${e.id}`}>
                  <EventRow e={e} compact />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AgendaList({ events, keys, todayKey }: { events: CalendarEvent[]; keys: string[]; todayKey: string }) {
  const grouped = groupByDay(events, keys);
  const days = keys.filter((k) => (grouped.get(k)?.length ?? 0) > 0 || k === todayKey);
  return (
    <div className="flex max-w-2xl flex-col gap-4 md:pl-[54px]">
      {days.map((k) => (
        <section key={k} aria-label={dayLabel(k)}>
          <h3 className="mb-1.5 text-sm font-medium">
            {dayLabel(k)} <span className="font-normal text-muted-foreground">{new Date(k + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          </h3>
          {(grouped.get(k) ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(grouped.get(k) ?? []).map((e) => (
                <li key={`${k}-${e.id}`}>
                  <EventRow e={e} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {days.length === 0 && <p className="text-muted-foreground">Nothing on your calendar for these two weeks.</p>}
    </div>
  );
}
