import { useState } from 'react';
import {
  COLORS,
  FILTER_OPS,
  PROP_TYPES,
  TITLE_ID,
  VIEW_TYPES,
  opLabel,
  opNeedsValue,
  opsFor,
  typeLabel,
  uid,
  type Filter,
  type PropertyDef,
  type PropType,
  type View,
  type ViewType,
} from '../lib/dbschema';
import { CalendarDaysIcon, KanbanIcon, ListIcon, MoreHorizontalIcon, PlusIcon, Settings2Icon, TableIcon, Trash2Icon, XIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DeleteButton from './ConfirmDelete';
import Popover, { MenuLabel, MenuNote } from './Popover';
import SimpleSelect from './SimpleSelect';

const VIEW_ICON: Record<ViewType, LucideIcon> = { table: TableIcon, board: KanbanIcon, list: ListIcon, calendar: CalendarDaysIcon };
const VIEW_LABEL: Record<ViewType, string> = { table: 'Table', board: 'Board', list: 'List', calendar: 'Calendar' };

interface ToolbarProps {
  schema: PropertyDef[];
  views: View[];
  view: View;
  onSelectView: (id: string) => void;
  onViews: (views: View[]) => void;
  onSchema: (schema: PropertyDef[]) => void;
}

export default function DbToolbar({ schema, views, view, onSelectView, onViews, onSchema }: ToolbarProps) {
  const updateView = (patch: Partial<View>) => onViews(views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)));
  const selects = schema.filter((p) => p.type === 'select');
  const dates = schema.filter((p) => p.type === 'date');

  const addView = (type: ViewType) => {
    const v: View = {
      id: uid(),
      name: VIEW_LABEL[type],
      type,
      filters: [],
      sorts: [],
      groupBy: type === 'board' ? selects[0]?.id : undefined,
      dateProp: type === 'calendar' ? dates[0]?.id : undefined,
    };
    onViews([...views, v]);
    onSelectView(v.id);
  };

  const removeView = () => {
    if (views.length <= 1) return;
    const rest = views.filter((v) => v.id !== view.id);
    onViews(rest);
    onSelectView(rest[0].id);
  };

  const toolBtn = (active: boolean) => cn('text-muted-foreground', active && 'text-primary');

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <Tabs value={view.id} onValueChange={onSelectView}>
          <TabsList aria-label="Views" className="h-auto flex-wrap justify-start">
            {views.map((v) => {
              const Icon = VIEW_ICON[v.type];
              return (
                <TabsTrigger key={v.id} value={v.id} className="flex-none px-2.5">
                  <Icon aria-hidden /> {v.name}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Add a view" title="Add a view">
              <PlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>New view</DropdownMenuLabel>
            {VIEW_TYPES.map((t) => {
              const Icon = VIEW_ICON[t];
              return (
                <DropdownMenuItem key={t} onSelect={() => addView(t)}>
                  <Icon /> {VIEW_LABEL[t]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {view.type === 'board' && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Group by
            <SimpleSelect
              aria-label="Group by"
              value={view.groupBy ?? ''}
              onChange={(v) => updateView({ groupBy: v || undefined })}
              placeholder="(no select property)"
              disabled={selects.length === 0}
              options={selects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
        )}
        {view.type === 'calendar' && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Date by
            <SimpleSelect
              aria-label="Date by"
              value={view.dateProp ?? ''}
              onChange={(v) => updateView({ dateProp: v || undefined })}
              placeholder="(no date property)"
              disabled={dates.length === 0}
              options={dates.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
        )}

        <Popover
          align="end"
          className="w-[min(26rem,88vw)]"
          trigger={
            <Button variant="ghost" size="sm" className={toolBtn(view.filters.length > 0)}>
              Filter{view.filters.length ? ` · ${view.filters.length}` : ''}
            </Button>
          }
        >
          {() => <FilterEditor schema={schema} filters={view.filters} onChange={(filters) => updateView({ filters })} />}
        </Popover>

        <Popover
          align="end"
          className="w-[min(22rem,88vw)]"
          trigger={
            <Button variant="ghost" size="sm" className={toolBtn(view.sorts.length > 0)}>
              Sort{view.sorts.length ? ` · ${view.sorts.length}` : ''}
            </Button>
          }
        >
          {() => <SortEditor schema={schema} view={view} onChange={(sorts) => updateView({ sorts })} />}
        </Popover>

        <Popover
          align="end"
          className="w-[min(26rem,88vw)]"
          trigger={
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Properties
            </Button>
          }
        >
          {() => <PropertiesMenu schema={schema} onChange={onSchema} />}
        </Popover>

        <Popover
          align="end"
          className="w-72"
          trigger={
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="View settings" title="View settings">
              <MoreHorizontalIcon />
            </Button>
          }
        >
          {(close) => (
            <>
              <MenuLabel>View name</MenuLabel>
              <Input aria-label="View name" value={view.name} maxLength={40} onChange={(e) => updateView({ name: e.target.value })} />
              <Button
                variant="ghost"
                size="sm"
                className="justify-start text-destructive hover:text-destructive"
                disabled={views.length <= 1}
                onClick={() => {
                  removeView();
                  close();
                }}
              >
                <Trash2Icon /> Delete this view
              </Button>
              {views.length <= 1 && <MenuNote>A database needs at least one view.</MenuNote>}
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}

const rowCls = 'flex items-center gap-1.5';
const grow = 'min-w-0 flex-1';
const addBtn = 'justify-start text-muted-foreground';

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-xs" className="flex-none text-muted-foreground" aria-label={label} onClick={onClick}>
      <XIcon />
    </Button>
  );
}

/* ------------------------------- filters ------------------------------- */

function FilterEditor({ schema, filters, onChange }: { schema: PropertyDef[]; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const cols = [{ id: TITLE_ID, name: 'Name', type: 'title' as const, options: undefined }, ...schema];
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <>
      {filters.length === 0 && <MenuNote>No filters. Everything is shown.</MenuNote>}
      {filters.map((f, i) => {
        const col = cols.find((c) => c.id === f.propId) ?? cols[0];
        const ops = opsFor(col.type as PropType | 'title');
        return (
          <div key={i} className={rowCls}>
            <SimpleSelect
              aria-label="Filter property"
              className={grow}
              value={f.propId}
              onChange={(v) => {
                const c = cols.find((x) => x.id === v)!;
                set(i, { propId: c.id, op: opsFor(c.type as PropType | 'title')[0], value: undefined });
              }}
              options={cols.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SimpleSelect
              aria-label="Filter condition"
              className={grow}
              value={f.op}
              onChange={(v) => set(i, { op: v as Filter['op'] })}
              options={ops.map((o) => ({ value: o, label: opLabel(o, col.type as PropType | 'title') }))}
            />
            {opNeedsValue(f.op) &&
              (col.type === 'select' || col.type === 'multiselect' ? (
                <SimpleSelect
                  aria-label="Filter value"
                  className={grow}
                  value={String(f.value ?? '')}
                  onChange={(v) => set(i, { value: v })}
                  placeholder="Choose…"
                  options={(col.options ?? []).map((o) => ({ value: o.id, label: o.name }))}
                />
              ) : (
                <Input
                  aria-label="Filter value"
                  className={cn(grow, 'h-7')}
                  type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
                  value={String(f.value ?? '')}
                  onChange={(e) => set(i, { value: col.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value })}
                />
              ))}
            <RemoveButton label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      {filters.length < 12 && (
        <Button variant="ghost" size="sm" className={addBtn} onClick={() => onChange([...filters, { propId: TITLE_ID, op: FILTER_OPS[0] }])}>
          <PlusIcon /> Add filter
        </Button>
      )}
    </>
  );
}

/* -------------------------------- sorts -------------------------------- */

function SortEditor({ schema, view, onChange }: { schema: PropertyDef[]; view: View; onChange: (s: View['sorts']) => void }) {
  const cols = [{ id: TITLE_ID, name: 'Name' }, ...schema];
  const sorts = view.sorts;
  return (
    <>
      {sorts.length === 0 && <MenuNote>No sorting. Newest first isn't automatic, rows stay in the order they were made.</MenuNote>}
      {sorts.map((s, i) => (
        <div key={i} className={rowCls}>
          <SimpleSelect
            aria-label="Sort property"
            className={grow}
            value={s.propId}
            onChange={(v) => onChange(sorts.map((x, j) => (j === i ? { ...x, propId: v } : x)))}
            options={cols.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SimpleSelect
            aria-label="Sort direction"
            className={grow}
            value={s.dir}
            onChange={(v) => onChange(sorts.map((x, j) => (j === i ? { ...x, dir: v as 'asc' | 'desc' } : x)))}
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
          <RemoveButton label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))} />
        </div>
      ))}
      {sorts.length < 4 && (
        <Button variant="ghost" size="sm" className={addBtn} onClick={() => onChange([...sorts, { propId: cols[0].id, dir: 'asc' }])}>
          <PlusIcon /> Add sort
        </Button>
      )}
    </>
  );
}

/* ----------------------------- properties ----------------------------- */

const typeOptions = PROP_TYPES.map((t) => ({ value: t, label: typeLabel(t) }));

function PropertiesMenu({ schema, onChange }: { schema: PropertyDef[]; onChange: (s: PropertyDef[]) => void }) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropType>('text');
  const [openId, setOpenId] = useState<string | null>(null);
  const patch = (id: string, p: Partial<PropertyDef>) => onChange(schema.map((d) => (d.id === id ? { ...d, ...p } : d)));

  const add = () => {
    const name = newName.trim();
    if (!name || schema.length >= 40) return;
    const def: PropertyDef = { id: uid(), name, type: newType };
    if (newType === 'select' || newType === 'multiselect') def.options = [];
    onChange([...schema, def]);
    setNewName('');
  };

  return (
    <>
      <MenuLabel>Properties</MenuLabel>
      <div className="flex items-center justify-between px-2 py-1 text-sm">
        <span>Name</span>
        <span className="text-xs text-muted-foreground">Title (always there)</span>
      </div>
      {schema.map((d) => (
        <div key={d.id} className="border-b py-1 last:border-b-0">
          <div className={rowCls}>
            <NameInput value={d.name} onCommit={(name) => name && patch(d.id, { name })} />
            <SimpleSelect
              aria-label={`Type of ${d.name}`}
              className="w-32 flex-none"
              value={d.type}
              onChange={(v) => {
                const type = v as PropType;
                patch(d.id, { type, options: type === 'select' || type === 'multiselect' ? (d.options ?? []) : undefined });
              }}
              options={typeOptions}
            />
            {(d.type === 'select' || d.type === 'multiselect') && (
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn('flex-none text-muted-foreground', openId === d.id && 'bg-muted text-foreground')}
                aria-label={`Edit options for ${d.name}`}
                title="Edit options"
                onClick={() => setOpenId(openId === d.id ? null : d.id)}
              >
                <Settings2Icon />
              </Button>
            )}
            <DeleteButton
              className="flex-none"
              label={`property ${d.name}`}
              title={`Delete the “${d.name}” property?`}
              description="Its values are removed from every row in this database."
              onConfirm={() => onChange(schema.filter((x) => x.id !== d.id))}
            />
          </div>
          {openId === d.id && (d.type === 'select' || d.type === 'multiselect') && <OptionsEditor def={d} onChange={(options) => patch(d.id, { options })} />}
        </div>
      ))}
      <div className={cn(rowCls, 'pt-1.5')}>
        <Input
          className={cn(grow, 'h-7')}
          placeholder="New property name"
          aria-label="New property name"
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <SimpleSelect aria-label="New property type" className="w-32 flex-none" value={newType} onChange={(v) => setNewType(v as PropType)} options={typeOptions} />
        <Button size="sm" onClick={add} disabled={!newName.trim()}>
          Add
        </Button>
      </div>
    </>
  );
}

function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  return (
    <Input
      className={cn(grow, 'h-7')}
      aria-label="Property name"
      value={local}
      maxLength={60}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const v = local.trim();
        if (!v) setLocal(value);
        else if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function OptionsEditor({ def, onChange }: { def: PropertyDef; onChange: (o: NonNullable<PropertyDef['options']>) => void }) {
  const opts = def.options ?? [];
  const [name, setName] = useState('');
  return (
    <div className="flex flex-col gap-1 py-1.5 pl-3">
      {opts.map((o) => (
        <div key={o.id} className={rowCls}>
          <NameInput value={o.name} onCommit={(n) => onChange(opts.map((x) => (x.id === o.id ? { ...x, name: n } : x)))} />
          <SimpleSelect
            aria-label={`Color of ${o.name}`}
            className="w-28 flex-none"
            value={o.color}
            onChange={(v) => onChange(opts.map((x) => (x.id === o.id ? { ...x, color: v as (typeof COLORS)[number] } : x)))}
            options={COLORS.map((c) => ({
              value: c,
              label: (
                <>
                  <span className={`c-${c} size-3 rounded-sm`} aria-hidden /> <span className="capitalize">{c}</span>
                </>
              ),
            }))}
          />
          <RemoveButton label={`Remove option ${o.name}`} onClick={() => onChange(opts.filter((x) => x.id !== o.id))} />
        </div>
      ))}
      <Input
        className="h-7"
        placeholder="Add option (press Enter)"
        aria-label={`Add option to ${def.name}`}
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() && opts.length < 60) {
            onChange([...opts, { id: uid(), name: name.trim(), color: COLORS[opts.length % COLORS.length] }]);
            setName('');
          }
        }}
      />
    </div>
  );
}
