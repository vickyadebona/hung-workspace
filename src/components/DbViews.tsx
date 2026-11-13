import { useEffect, useMemo, useState } from 'react';
import {
  groupRows,
  isoDate,
  monthGrid,
  type PropertyDef,
  type PropValue,
  type Row,
  type View,
} from '../lib/dbschema';
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, LinkIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DeleteButton from './ConfirmDelete';
import PropEditor, { Chip, cellInput, isSafeUrl } from './PropEditor';
import SimpleSelect from './SimpleSelect';

export interface ViewProps {
  schema: PropertyDef[];
  view: View;
  rows: Row[]; // already filtered and sorted
  focusRowId: string | null;
  onOpen: (id: string) => void;
  onAdd: (initial: { props?: Record<string, unknown> }) => void;
  onProp: (rowId: string, propId: string, value: PropValue) => void;
  onTitle: (rowId: string, title: string) => void;
  onDelete: (rowId: string) => void;
  onCreateOption: (propId: string, name: string) => Promise<string | null>;
}

const meta = 'inline-flex items-center gap-1 text-xs text-muted-foreground';
const empty = 'px-1 py-4 text-sm text-muted-foreground';
const addBtn = 'mt-1 justify-start text-muted-foreground';

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Read-only display of one value (used on cards, list rows and calendar chips). */
export function ValueView({ def, value }: { def: PropertyDef; value: PropValue }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return null;
  switch (def.type) {
    case 'select':
    case 'multiselect': {
      const ids = Array.isArray(value) ? value : [value as string];
      return (
        <>
          {ids.map((id) => {
            const o = def.options?.find((x) => x.id === id);
            return o ? <Chip key={id} name={o.name} color={o.color} /> : null;
          })}
        </>
      );
    }
    case 'date':
      return (
        <span className={meta}>
          <CalendarIcon className="size-3" /> {fmtDate(String(value))}
        </span>
      );
    case 'checkbox':
      return (
        <span className={meta}>
          <CheckIcon className="size-3" /> {def.name}
        </span>
      );
    case 'url':
      return isSafeUrl(value) ? (
        <span className={meta}>
          <LinkIcon className="size-3" /> {value.replace(/^https?:\/\//i, '').slice(0, 30)}
        </span>
      ) : (
        <span className={meta}>{String(value).slice(0, 30)}</span>
      );
    default:
      return <span className={meta}>{String(value).slice(0, 40)}</span>;
  }
}

function TitleInput({ row, autoFocus, onTitle }: { row: Row; autoFocus: boolean; onTitle: (id: string, t: string) => void }) {
  const [local, setLocal] = useState(row.title);
  useEffect(() => setLocal(row.title), [row.title]);
  return (
    <Input
      className={cn(cellInput, 'font-medium')}
      aria-label="Name"
      value={local}
      autoFocus={autoFocus}
      placeholder="Untitled"
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => autoFocus && e.target.select()}
      onBlur={() => local !== row.title && onTitle(row.id, local)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setLocal(row.title);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function RowDelete({ row, onDelete, className }: { row: Row; onDelete: (id: string) => void; className?: string }) {
  return (
    <DeleteButton
      className={className}
      label={row.title || 'row'}
      title={`Delete “${row.title || 'Untitled'}”?`}
      description="This row and its page are removed from the database."
      onConfirm={() => onDelete(row.id)}
    />
  );
}

// Row actions stay out of the way until the row is hovered or focused (always visible on touch screens).
const reveal = 'md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100';

/* ------------------------------ Table ------------------------------ */

export function TableView(p: ViewProps) {
  return (
    <div>
      <Table className="min-w-[600px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 min-w-56 text-xs font-medium text-muted-foreground">Name</TableHead>
            {p.schema.map((d) => (
              <TableHead key={d.id} className="h-8 text-xs font-medium text-muted-foreground">
                {d.name}
              </TableHead>
            ))}
            <TableHead className="h-8 w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.rows.map((r) => (
            <TableRow key={r.id} data-row-id={r.id} className="group/row hover:bg-transparent">
              <TableCell className="px-1 py-0.5">
                <div className="flex items-center gap-1">
                  <TitleInput row={r} autoFocus={p.focusRowId === r.id} onTitle={p.onTitle} />
                  <Button variant="outline" size="xs" className={cn('text-muted-foreground', reveal)} onClick={() => p.onOpen(r.id)} aria-label={`Open ${r.title || 'Untitled'}`}>
                    Open
                  </Button>
                </div>
              </TableCell>
              {p.schema.map((d) => (
                <TableCell key={d.id} className="px-1 py-0.5 whitespace-normal">
                  <PropEditor def={d} value={r.props[d.id] ?? null} onChange={(v) => p.onProp(r.id, d.id, v)} onCreateOption={p.onCreateOption} />
                </TableCell>
              ))}
              <TableCell className="px-1 py-0.5 text-right">
                <RowDelete row={r} onDelete={p.onDelete} className={reveal} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {p.rows.length === 0 && <div className={empty}>No rows to show.</div>}
      <Button variant="ghost" size="sm" className={addBtn} onClick={() => p.onAdd({})}>
        <PlusIcon /> New
      </Button>
    </div>
  );
}

/* ------------------------------ Board ------------------------------ */

export function BoardView(p: ViewProps) {
  const def = p.schema.find((d) => d.id === p.view.groupBy && d.type === 'select');
  const [over, setOver] = useState<string | null>(null);
  const groups = useMemo(() => (def ? groupRows(p.rows, def) : []), [p.rows, def]);
  if (!def) return <div className={empty}>Add a Select property (like Status) to group this board by.</div>;
  const others = p.schema.filter((d) => d.id !== def.id);
  const columns = [{ value: '', label: `No ${def.name.toLowerCase()}` }, ...(def.options ?? []).map((o) => ({ value: o.id, label: o.name }))];

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-3">
      {groups.map((g) => (
        <div
          key={g.key || 'none'}
          className={cn('min-h-28 flex-none basis-[78vw] rounded-xl border-2 border-transparent bg-muted/60 p-2 md:basis-64', over === g.key && 'border-primary')}
          data-group={g.key || 'none'}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(g.key);
          }}
          onDragLeave={() => setOver((o) => (o === g.key ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData('text/plain');
            const row = p.rows.find((r) => r.id === id);
            if (row && (row.props[def.id] ?? '') !== g.key) p.onProp(id, def.id, g.key || null);
          }}
        >
          <div className="flex items-center gap-2 px-1 pt-0.5 pb-2">
            {g.color ? <Chip name={g.label} color={g.color} /> : <span className="text-sm text-muted-foreground">{g.label}</span>}
            <span className="text-xs text-muted-foreground">{g.rows.length}</span>
          </div>
          {g.rows.map((r) => (
            <Card key={r.id} size="sm" className="mb-2 cursor-grab gap-1.5 p-2.5 shadow-xs" draggable data-row-id={r.id} onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}>
              <button className="w-full rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50" onClick={() => p.onOpen(r.id)}>
                {r.title || 'Untitled'}
              </button>
              <div className="flex flex-wrap gap-1 empty:hidden">
                {others.map((d) => (
                  <ValueView key={d.id} def={d} value={r.props[d.id] ?? null} />
                ))}
              </div>
              <SimpleSelect
                className="w-full text-xs text-muted-foreground"
                aria-label={`Move ${r.title || 'card'} to column`}
                value={(r.props[def.id] as string) ?? ''}
                onChange={(v) => p.onProp(r.id, def.id, v || null)}
                options={columns}
              />
            </Card>
          ))}
          <Button variant="ghost" size="sm" className={cn(addBtn, 'w-full')} onClick={() => p.onAdd({ props: { [def.id]: g.key || null } })}>
            <PlusIcon /> New
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ List ------------------------------ */

export function ListView(p: ViewProps) {
  return (
    <div>
      <ul>
        {p.rows.map((r) => (
          <li key={r.id} data-row-id={r.id} className="group/row flex items-center gap-2.5 border-b px-1 py-1">
            <Button variant="ghost" size="sm" className="-ml-1 max-w-[45%] flex-none justify-start font-medium" onClick={() => p.onOpen(r.id)}>
              <span className="truncate">{r.title || 'Untitled'}</span>
            </Button>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {p.schema.map((d) => (
                <ValueView key={d.id} def={d} value={r.props[d.id] ?? null} />
              ))}
            </span>
            <RowDelete row={r} onDelete={p.onDelete} className={reveal} />
          </li>
        ))}
      </ul>
      {p.rows.length === 0 && <div className={empty}>No rows to show.</div>}
      <Button variant="ghost" size="sm" className={addBtn} onClick={() => p.onAdd({})}>
        <PlusIcon /> New
      </Button>
    </div>
  );
}

/* ----------------------------- Calendar ----------------------------- */

function todayIso(): string {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

const calItem =
  'max-w-full cursor-grab truncate rounded-sm bg-accent px-1.5 py-0.5 text-left text-xs text-accent-foreground outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50';

export function CalendarView(p: ViewProps) {
  const def = p.schema.find((d) => d.id === p.view.dateProp && d.type === 'date');
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [over, setOver] = useState<string | null>(null);
  const byDate = useMemo(() => {
    const m = new Map<string, Row[]>();
    if (!def) return m;
    for (const r of p.rows) {
      const v = r.props[def.id];
      if (typeof v === 'string') m.set(v, [...(m.get(v) ?? []), r]);
    }
    return m;
  }, [p.rows, def]);
  if (!def) return <div className={empty}>Add a Date property to show this calendar.</div>;

  const undated = p.rows.filter((r) => typeof r.props[def.id] !== 'string');
  const weeks = monthGrid(ym.y, ym.m);
  const today = todayIso();
  const title = new Date(Date.UTC(ym.y, ym.m, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shift = (d: number) => {
    const t = new Date(Date.UTC(ym.y, ym.m + d, 1));
    setYm({ y: t.getUTCFullYear(), m: t.getUTCMonth() });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeftIcon />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRightIcon />
        </Button>
        <strong className="ml-1 text-sm" aria-live="polite">
          {title}
        </strong>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>
          Today
        </Button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border-t border-l">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="border-r border-b px-1.5 py-1 text-xs text-muted-foreground">
            {d}
          </div>
        ))}
        {weeks.flat().map((iso) => {
          const inMonth = Number(iso.slice(5, 7)) - 1 === ym.m;
          return (
            <div
              key={iso}
              data-date={iso}
              className={cn(
                'group/cell flex min-h-24 min-w-0 flex-col gap-0.5 border-r border-b p-1',
                !inMonth && 'bg-muted/50 text-muted-foreground',
                over === iso && 'outline-2 -outline-offset-2 outline-primary',
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(iso);
              }}
              onDragLeave={() => setOver((o) => (o === iso ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) p.onProp(id, def.id, iso);
              }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className={cn(iso === today && 'rounded-full bg-primary px-1.5 text-primary-foreground')}>{Number(iso.slice(8))}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5 text-muted-foreground md:opacity-0 md:group-hover/cell:opacity-100 md:focus-visible:opacity-100"
                  aria-label={`Add item on ${iso}`}
                  onClick={() => p.onAdd({ props: { [def.id]: iso } })}
                >
                  <PlusIcon />
                </Button>
              </div>
              {(byDate.get(iso) ?? []).map((r) => (
                <button key={r.id} className={calItem} draggable data-row-id={r.id} onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)} onClick={() => p.onOpen(r.id)}>
                  {r.title || 'Untitled'}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
          <span className="text-xs text-muted-foreground">No date:</span>
          {undated.map((r) => (
            <button key={r.id} className={calItem} draggable data-row-id={r.id} onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)} onClick={() => p.onOpen(r.id)}>
              {r.title || 'Untitled'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
