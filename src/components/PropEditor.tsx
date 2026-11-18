import { useEffect, useState } from 'react';
import { CheckIcon, ExternalLinkIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import type { Color, PropertyDef, PropValue } from '../lib/dbschema';
import Popover from './Popover';
import { nameOf, titleOf, type CellCtx, emptyCtx } from './cells';

/** A person: a small round initial and their name. */
export function PersonChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-2 pl-0.5 text-xs">
      <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground uppercase" aria-hidden>
        {name.trim().charAt(0) || '?'}
      </span>
      {name}
    </span>
  );
}

/** A linked row, shown by its title. */
export function RowChip({ title }: { title: string }) {
  return <span className="inline-flex max-w-48 items-center truncate rounded-md bg-muted px-1.5 py-0.5 text-xs">{title || 'Untitled'}</span>;
}

export function Chip({ name, color }: { name: string; color: Color }) {
  return (
    <Badge variant="secondary" className={`c-${color} rounded-md font-normal`}>
      {name}
    </Badge>
  );
}

export function isSafeUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v);
}

/** An input that looks like plain text until you hover or focus it (table cells, property rows). */
export const cellInput =
  'h-7 rounded-md border-transparent bg-transparent px-1.5 shadow-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-0 dark:bg-transparent dark:hover:bg-muted';

interface Props {
  def: PropertyDef;
  value: PropValue;
  onChange: (v: PropValue) => void;
  /** Create a new select option by name; resolves to its id, or null if it could not be created. */
  onCreateOption?: (propId: string, name: string) => Promise<string | null>;
  /** People, members and linked databases (needed for person, relation and rollup properties). */
  ctx?: CellCtx;
}

export default function PropEditor({ def, value, onChange, onCreateOption, ctx = emptyCtx }: Props) {
  switch (def.type) {
    case 'text':
    case 'url':
    case 'number':
      return <TextLike def={def} value={value} onChange={onChange} />;
    case 'date':
      return (
        <Input
          className={cn(cellInput, 'w-auto')}
          type="date"
          aria-label={def.name}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'checkbox':
      return <Checkbox className="mx-1.5" aria-label={def.name} checked={value === true} onCheckedChange={(c) => onChange(c === true ? true : null)} />;
    case 'select':
    case 'multiselect':
      return <SelectLike def={def} value={value} onChange={onChange} onCreateOption={onCreateOption} />;
    case 'person':
      return <PersonEditor def={def} value={value} onChange={onChange} ctx={ctx} />;
    case 'relation':
      return <RelationEditor def={def} value={value} onChange={onChange} ctx={ctx} />;
    case 'rollup':
      return <RollupCell def={def} value={value} />;
    case 'formula':
      return <FormulaCell value={value} />;
  }
}

function TextLike({ def, value, onChange }: Omit<Props, 'onCreateOption'>) {
  const shown = value === null || value === undefined ? '' : String(value);
  const [local, setLocal] = useState(shown);
  useEffect(() => setLocal(shown), [shown]);

  const commit = () => {
    if (local === shown) return;
    if (def.type === 'number') {
      const n = local.trim() === '' ? null : Number(local);
      onChange(n === null || Number.isFinite(n) ? n : null);
    } else {
      onChange(local === '' ? null : local);
    }
  };

  return (
    <span className="flex items-center gap-0.5">
      <Input
        className={cellInput}
        type={def.type === 'number' ? 'number' : 'text'}
        aria-label={def.name}
        value={local}
        placeholder={def.type === 'url' ? 'https://' : ''}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setLocal(shown);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {def.type === 'url' && isSafeUrl(shown) && (
        <Button asChild variant="ghost" size="icon-xs" className="text-primary">
          <a href={shown} target="_blank" rel="noopener noreferrer" aria-label={`Open ${def.name}`} title="Open link">
            <ExternalLinkIcon />
          </a>
        </Button>
      )}
    </span>
  );
}

function SelectLike({ def, value, onChange, onCreateOption }: Props) {
  const multi = def.type === 'multiselect';
  const options = def.options ?? [];
  const selected: string[] = multi ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : [];
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id: string, close: () => void) => {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      onChange(next.length ? next : null);
    } else {
      onChange(selected[0] === id ? null : id);
      close();
    }
  };

  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const canCreate = !!onCreateOption && q.trim() !== '' && !exact;

  const create = async (close: () => void) => {
    if (!onCreateOption || busy) return;
    setBusy(true);
    const id = await onCreateOption(def.id, q.trim());
    setBusy(false);
    if (!id) return;
    if (multi) onChange([...selected.filter((x) => x !== id), id]);
    else onChange(id);
    setQ('');
    if (!multi) close();
  };

  return (
    <Popover
      className="w-60 p-0"
      trigger={
        <button
          className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted"
          aria-label={def.name}
          type="button"
        >
          {selected.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
          {selected.map((id) => {
            const o = options.find((x) => x.id === id);
            return o ? <Chip key={id} name={o.name} color={o.color} /> : null;
          })}
        </button>
      }
    >
      {(close) => (
        // Matching is done above (so "create" can be offered), not by the list itself.
        <Command shouldFilter={false} aria-label={`${def.name} options`}>
          <CommandInput value={q} onValueChange={setQ} placeholder={canCreate || options.length === 0 ? 'Find or create…' : 'Find…'} />
          <CommandList>
            {!canCreate && <CommandEmpty>No options</CommandEmpty>}
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem key={o.id} value={o.id} onSelect={() => toggle(o.id, close)}>
                  <Chip name={o.name} color={o.color} />
                  {selected.includes(o.id) && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem value="__create__" disabled={busy} onSelect={() => create(close)} className="text-primary">
                  <PlusIcon /> Create “{q.trim()}”
                </CommandItem>
              )}
              {!multi && selected.length > 0 && (
                <CommandItem
                  value="__clear__"
                  className="text-muted-foreground"
                  onSelect={() => {
                    onChange(null);
                    close();
                  }}
                >
                  Clear
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Popover>
  );
}

const triggerCls =
  'flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted';

function PersonEditor({ def, value, onChange, ctx }: { def: PropertyDef; value: PropValue; onChange: (v: PropValue) => void; ctx: CellCtx }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (email: string) => {
    const next = selected.includes(email) ? selected.filter((x) => x !== email) : [...selected, email];
    onChange(next.length ? next : null);
  };
  return (
    <Popover
      className="w-64 p-0"
      trigger={
        <button className={triggerCls} aria-label={def.name} type="button">
          {selected.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
          {selected.map((e) => (
            <PersonChip key={e} name={nameOf(ctx, e)} />
          ))}
        </button>
      }
    >
      {() => (
        <Command aria-label={`${def.name} people`}>
          <CommandInput placeholder="Find a person…" />
          <CommandList>
            <CommandEmpty>No one else is in this space yet.</CommandEmpty>
            <CommandGroup>
              {ctx.members.map((m) => (
                <CommandItem key={m.email} value={`${m.name} ${m.email}`} onSelect={() => toggle(m.email)}>
                  <PersonChip name={m.name} />
                  <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  {selected.includes(m.email) && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Popover>
  );
}

function RelationEditor({ def, value, onChange, ctx }: { def: PropertyDef; value: PropValue; onChange: (v: PropValue) => void; ctx: CellCtx }) {
  const dbId = def.relation?.database ?? '';
  const info = ctx.related[dbId];
  const single = def.relation?.single === true;
  const selected = Array.isArray(value) ? value : [];
  const toggle = (id: string, close: () => void) => {
    if (single) {
      onChange(selected[0] === id ? null : [id]);
      close();
      return;
    }
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length ? next : null);
  };
  return (
    <Popover
      className="w-72 p-0"
      trigger={
        <button className={triggerCls} aria-label={def.name} type="button">
          {selected.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
          {selected.map((id) => (
            <RowChip key={id} title={titleOf(ctx, dbId, id) ?? '…'} />
          ))}
        </button>
      }
    >
      {(close) => (
        <Command aria-label={`${def.name} rows`}>
          <CommandInput placeholder={`Find in ${info?.title ?? 'database'}…`} />
          <CommandList>
            <CommandEmpty>{info ? 'Nothing to link to yet.' : 'Loading…'}</CommandEmpty>
            <CommandGroup>
              {(info?.rows ?? []).map((r) => (
                <CommandItem key={r.id} value={`${r.title} ${r.id}`} onSelect={() => toggle(r.id, close)}>
                  <span className="truncate">{r.title || 'Untitled'}</span>
                  {selected.includes(r.id) && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
              {single && selected.length > 0 && (
                <CommandItem
                  value="__clear__"
                  className="text-muted-foreground"
                  onSelect={() => {
                    onChange(null);
                    close();
                  }}
                >
                  Clear
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Popover>
  );
}

/** A worked-out value (read only): a number, or a percentage with a small bar, or a date. */
export function RollupCell({ def, value }: { def: PropertyDef; value: PropValue }) {
  const fn = def.rollup?.fn;
  if (value === null || value === undefined) return <span className="px-1.5 text-sm text-muted-foreground">—</span>;
  if ((fn === 'percent_checked' || fn === 'percent_option') && typeof value === 'number') {
    return (
      <span className="flex items-center gap-2 px-1.5 text-sm" aria-label={`${def.name}: ${value}%`}>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </span>
        {value}%
      </span>
    );
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return <span className="px-1.5 text-sm">{new Date(value + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>;
  }
  return <span className="px-1.5 text-sm">{String(value)}</span>;
}

/** A formula's result (read only): a number, text, a date, or a tick for true/false. */
export function FormulaCell({ value }: { value: PropValue }) {
  if (value === null || value === undefined) return <span className="px-1.5 text-sm text-muted-foreground">—</span>;
  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex items-center gap-1 px-1.5 text-sm">
        <CheckIcon className="size-3.5 text-primary" /> Yes
      </span>
    ) : (
      <span className="px-1.5 text-sm text-muted-foreground">No</span>
    );
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return <span className="px-1.5 text-sm">{new Date(value + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>;
  }
  return <span className="px-1.5 text-sm">{String(value)}</span>;
}
