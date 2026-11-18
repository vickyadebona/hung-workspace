import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecksIcon, PlusIcon, SlidersHorizontalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { bucketOf, type TaskBucket } from '../lib/mytasks-buckets';
import { api, type MyTask } from './api';
import { pageShell } from './PageEditor';
import Popover from './Popover';

const SECTIONS: { key: TaskBucket; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'nodate', label: 'No date' },
];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const niceDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Everything assigned to you, across all your spaces, grouped by when it is due. */
export default function MyTasksView({ onOpen }: { onOpen: (id: string) => void }) {
  const [tasks, setTasks] = useState<MyTask[] | null>(null);
  const [error, setError] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  // databases you have chosen to leave out of this list (remembered on this device)
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('wn_mytasks_hidden') || '[]');
    } catch {
      return [];
    }
  });
  const today = localToday();

  const load = useCallback(async () => {
    try {
      setTasks(await api.myTasks());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    // pick up changes made elsewhere when you come back to this tab
    const on = () => load();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [load]);

  const sources = useMemo(() => {
    const m = new Map<string, { id: string; title: string; icon: string; space: string; count: number }>();
    for (const t of tasks ?? []) {
      const cur = m.get(t.database) ?? { id: t.database, title: t.databaseTitle, icon: t.databaseIcon, space: t.spaceName, count: 0 };
      cur.count++;
      m.set(t.database, cur);
    }
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [tasks]);
  const shown = useMemo(() => (tasks ?? []).filter((t) => !hidden.includes(t.database)), [tasks, hidden]);
  const open = useMemo(() => shown.filter((t) => !t.done), [shown]);
  const finished = useMemo(() => shown.filter((t) => t.done), [shown]);
  const setSourceShown = (id: string, on: boolean) => {
    const next = on ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem('wn_mytasks_hidden', JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || adding) return;
    setAdding(true);
    setAddError('');
    try {
      const t = await api.addMyTask(title, due || undefined);
      setTasks((prev) => [...(prev ?? []), t].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title)));
      setTitle('');
      setDue('');
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (t: MyTask) => {
    if (!t.toggle) return;
    const next = t.done ? t.toggle.open : t.toggle.done;
    setTasks((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    const res = await api.update(t.id, { props: { [t.toggle.propId]: next } }).catch(() => null);
    if (!res || !res.ok) load();
  };

  return (
    <div className={pageShell}>
      <div className="mb-1 flex items-center gap-3 md:pl-[54px]">
        <ListChecksIcon className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">My tasks</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground md:pl-[54px]">Everything assigned to you, across all your spaces.</p>

      <form onSubmit={add} className="mb-6 flex flex-wrap items-center gap-2 md:pl-[54px]">
        <Input className="min-w-56 flex-1" placeholder="Add a task for yourself…" aria-label="New task" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <Input className="w-40" type="date" aria-label="Due date (optional)" value={due} onChange={(e) => setDue(e.target.value)} />
        <Button type="submit" disabled={!title.trim() || adding}>
          <PlusIcon /> Add
        </Button>
        {sources.length > 1 && (
          <Popover
            align="end"
            className="w-72"
            trigger={
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
                <SlidersHorizontalIcon /> Sources{hidden.length ? ` · ${sources.length - hidden.filter((h) => sources.some((x) => x.id === h)).length} of ${sources.length}` : ''}
              </Button>
            }
          >
            {() => (
              <>
                <div className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Which databases to include</div>
                {sources.map((src) => (
                  <label key={src.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <Checkbox checked={!hidden.includes(src.id)} onCheckedChange={(c) => setSourceShown(src.id, c === true)} />
                    <span className="truncate">
                      {src.icon} {src.title}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{src.space} · {src.count}</span>
                  </label>
                ))}
              </>
            )}
          </Popover>
        )}
        {addError && (
          <div className="w-full text-sm text-destructive" role="alert">
            {addError}
          </div>
        )}
      </form>

      <div className="md:pl-[54px]">
        {tasks === null && !error && (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading tasks">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-4 rounded-sm" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="text-muted-foreground">
            <p>Couldn't load your tasks.</p>
            <Button variant="outline" className="mt-2" onClick={load}>
              Try again
            </Button>
          </div>
        )}
        {tasks !== null && open.length === 0 && finished.length === 0 && (
          <p className="text-muted-foreground">Nothing is assigned to you yet. Add a task above, or put yourself in a Person property on a task in any database.</p>
        )}
        {tasks !== null && open.length === 0 && finished.length > 0 && <p className="mb-4 text-muted-foreground">You're all caught up.</p>}

        {SECTIONS.map(({ key, label }) => {
          const rows = open.filter((t) => bucketOf(t.due, today) === key);
          if (rows.length === 0) return null;
          return (
            <section key={key} className="mb-6" aria-label={label}>
              <h2 className={cn('mb-1 text-xs font-medium tracking-wide uppercase', key === 'overdue' ? 'text-destructive' : 'text-muted-foreground')}>
                {label} <span className="font-normal">· {rows.length}</span>
              </h2>
              <ul>
                {rows.map((t) => (
                  <TaskRow key={t.id} t={t} today={today} onOpen={onOpen} onToggle={toggle} />
                ))}
              </ul>
            </section>
          );
        })}

        {finished.length > 0 && (
          <section aria-label="Completed">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide' : 'Show'} completed ({finished.length})
            </Button>
            {showDone && (
              <ul className="mt-1">
                {finished.map((t) => (
                  <TaskRow key={t.id} t={t} today={today} onOpen={onOpen} onToggle={toggle} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function TaskRow({ t, today, onOpen, onToggle }: { t: MyTask; today: string; onOpen: (id: string) => void; onToggle: (t: MyTask) => void }) {
  const late = !t.done && t.due !== null && t.due < today;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5">
      <Checkbox checked={t.done} disabled={!t.toggle} aria-label={`${t.done ? 'Reopen' : 'Complete'} ${t.title}`} onCheckedChange={() => onToggle(t)} />
      <button type="button" className={cn('min-w-0 flex-1 truncate text-left text-sm font-medium outline-none hover:underline focus-visible:underline', t.done && 'text-muted-foreground line-through')} onClick={() => onOpen(t.id)}>
        {t.title}
      </button>
      {t.priority && <Badge variant="secondary" className={`c-${t.priority.color} rounded-md font-normal`}>{t.priority.name}</Badge>}
      {t.status && !t.done && <Badge variant="secondary" className={`c-${t.status.color} rounded-md font-normal`}>{t.status.name}</Badge>}
      {t.due && <span className={cn('text-xs', late ? 'font-medium text-destructive' : 'text-muted-foreground')}>{t.due === today ? 'Today' : niceDate(t.due)}</span>}
      <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:inline" title={`${t.databaseTitle} · ${t.spaceName}`}>
        {t.databaseIcon} {t.databaseTitle} · {t.spaceName}
      </span>
    </li>
  );
}
