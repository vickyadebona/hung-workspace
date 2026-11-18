import { useState } from 'react';
import {
  COLORS,
  FILTER_OPS,
  PROP_TYPES,
  ROLLUP_FNS,
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
  type RollupFn,
  type View,
  type ViewType,
} from '../lib/dbschema';
import type { PageMeta } from './api';
import type { CellCtx } from './cells';
import { CalendarDaysIcon, KanbanIcon, ListIcon, MoreHorizontalIcon, PlusIcon, Settings2Icon, TableIcon, Trash2Icon, XIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  /** This database's id, the databases a relation can point at, and what is known about them. */
  selfId: string;
  databases: PageMeta[];
  ctx: CellCtx;
  onAddRelation: (opts: { name: string; target: string; twoWay: boolean; reverseName?: string; single?: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export default function DbToolbar({ schema, views, view, onSelectView, onViews, onSchema, selfId, databases, ctx, onAddRelation }: ToolbarProps) {
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

  // single-link relations to this same database (a "Parent" property) let rows nest under each other
  const nestable = schema.filter((d) => d.type === 'relation' && !d.relation?.reverseOf && d.relation?.single && d.relation.database === selfId);
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
          {() => <FilterEditor schema={schema} ctx={ctx} filters={view.filters} onChange={(filters) => updateView({ filters })} />}
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
          {() => <PropertiesMenu schema={schema} onChange={onSchema} selfId={selfId} databases={databases} ctx={ctx} onAddRelation={onAddRelation} />}
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
              {(view.type === 'table' || view.type === 'list') && nestable.length > 0 && (
                <>
                  <MenuLabel>Sub-items</MenuLabel>
                  <SimpleSelect
                    aria-label="Show sub-items under their parent"
                    size="default"
                    value={view.nestBy ?? ''}
                    onChange={(v) => updateView({ nestBy: v || undefined })}
                    options={[{ value: '', label: 'Show every row at the top level' }, ...nestable.map((d) => ({ value: d.id, label: `Nest under “${d.name}”` }))]}
                  />
                </>
              )}
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

function FilterEditor({ schema, ctx, filters, onChange }: { schema: PropertyDef[]; ctx: CellCtx; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const cols = [{ id: TITLE_ID, name: 'Name', type: 'title' as const, options: undefined }, ...schema];
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <>
      {filters.length === 0 && <MenuNote>No filters. Everything is shown.</MenuNote>}
      {filters.map((f, i) => {
        const col = cols.find((c) => c.id === f.propId) ?? cols[0];
        const ops = opsFor(col.type as PropType | 'title', col as PropertyDef);
        return (
          <div key={i} className={rowCls}>
            <SimpleSelect
              aria-label="Filter property"
              className={grow}
              value={f.propId}
              onChange={(v) => {
                const c = cols.find((x) => x.id === v)!;
                set(i, { propId: c.id, op: opsFor(c.type as PropType | 'title', c as PropertyDef)[0], value: undefined });
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
              (col.type === 'person' ? (
                <SimpleSelect
                  aria-label="Filter value"
                  className={grow}
                  value={String(f.value ?? '')}
                  onChange={(v) => set(i, { value: v })}
                  placeholder="Choose…"
                  options={ctx.members.map((m) => ({ value: m.email, label: m.name }))}
                />
              ) : col.type === 'select' || col.type === 'multiselect' ? (
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
                  type={col.type === 'date' || (col.type === 'rollup' && (col as PropertyDef).rollup?.fn && ['earliest', 'latest'].includes((col as PropertyDef).rollup!.fn)) ? 'date' : col.type === 'number' || col.type === 'rollup' ? 'number' : 'text'}
                  value={String(f.value ?? '')}
                  onChange={(e) => set(i, { value: (col.type === 'number' || (col.type === 'rollup' && e.target.type === 'number')) && e.target.value !== '' ? Number(e.target.value) : e.target.value })}
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
  const cols = [{ id: TITLE_ID, name: 'Name' }, ...schema.filter((d) => d.type !== 'relation')];
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

/** What an existing property can be changed into. Relations and rollups need setting up, so they are only offered when adding. */
const typeOptions = PROP_TYPES.filter((t) => t !== 'relation' && t !== 'rollup').map((t) => ({ value: t, label: typeLabel(t) }));
const newTypeOptions = PROP_TYPES.map((t) => ({ value: t, label: typeLabel(t) }));

const ROLLUP_LABEL: Record<RollupFn, string> = {
  count: 'Count of linked rows',
  percent_checked: 'Percent checked',
  percent_option: 'Percent with a status',
  sum: 'Sum',
  avg: 'Average',
  min: 'Smallest',
  max: 'Largest',
  earliest: 'Earliest date',
  latest: 'Latest date',
};

/** Which kind of property of the linked rows each calculation works on. */
const ROLLUP_TARGET: Partial<Record<RollupFn, PropType>> = {
  percent_checked: 'checkbox',
  percent_option: 'select',
  sum: 'number',
  avg: 'number',
  min: 'number',
  max: 'number',
  earliest: 'date',
  latest: 'date',
};

function PropertiesMenu({
  schema,
  onChange,
  selfId,
  databases,
  ctx,
  onAddRelation,
}: {
  schema: PropertyDef[];
  onChange: (s: PropertyDef[]) => void;
  selfId: string;
  databases: PageMeta[];
  ctx: CellCtx;
  onAddRelation: ToolbarProps['onAddRelation'];
}) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropType>('text');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // relation settings
  const [target, setTarget] = useState(selfId);
  const [twoWay, setTwoWay] = useState(true);
  const [single, setSingle] = useState(false);
  const [reverseName, setReverseName] = useState('');
  // rollup settings
  const relations = schema.filter((d) => d.type === 'relation');
  const [rollRel, setRollRel] = useState('');
  const [rollFn, setRollFn] = useState<RollupFn>('count');
  const [rollTarget, setRollTarget] = useState('');
  const [rollOptions, setRollOptions] = useState<string[]>([]);
  const patch = (id: string, p: Partial<PropertyDef>) => onChange(schema.map((d) => (d.id === id ? { ...d, ...p } : d)));

  const activeRel = relations.find((d) => d.id === rollRel) ?? relations[0];
  const relatedSchema = activeRel?.relation ? (ctx.related[activeRel.relation.database]?.schema ?? []) : [];
  const wantType = ROLLUP_TARGET[rollFn];
  const targetChoices = wantType ? relatedSchema.filter((d) => d.type === wantType) : [];
  const chosenTarget = targetChoices.find((d) => d.id === rollTarget) ?? targetChoices[0];
  const rollupReady = !!activeRel && (!wantType || !!chosenTarget) && (rollFn !== 'percent_option' || rollOptions.length > 0);
  const dbName = (id: string) => (id === selfId ? 'This database (sub-items, parents)' : (databases.find((d) => d.id === id)?.title || 'Untitled'));

  const add = async () => {
    const name = newName.trim();
    setError('');
    if (schema.length >= 40) return;
    if (newType === 'relation') {
      const subItems = target === selfId && single && twoWay;
      const r = await onAddRelation({
        name: name || (subItems ? 'Parent' : dbName(target)),
        target,
        twoWay,
        single,
        reverseName: reverseName.trim() || (subItems ? 'Sub-items' : undefined),
      });
      if (!r.ok) setError(r.error);
      else {
        setNewName('');
        setReverseName('');
      }
      return;
    }
    if (!name) return;
    if (newType === 'rollup') {
      if (!rollupReady || !activeRel) return;
      onChange([
        ...schema,
        {
          id: uid(),
          name,
          type: 'rollup',
          rollup: { relation: activeRel.id, fn: rollFn, ...(chosenTarget ? { target: chosenTarget.id } : {}), ...(rollFn === 'percent_option' ? { options: rollOptions } : {}) },
        },
      ]);
      setNewName('');
      return;
    }
    const def: PropertyDef = { id: uid(), name, type: newType };
    if (newType === 'select' || newType === 'multiselect') def.options = [];
    onChange([...schema, def]);
    setNewName('');
  };

  const canAdd = newType === 'relation' ? true : newType === 'rollup' ? !!newName.trim() && rollupReady : !!newName.trim();

  return (
    <>
      <MenuLabel>Properties</MenuLabel>
      <div className="flex items-center justify-between px-2 py-1 text-sm">
        <span>Name</span>
        <span className="text-xs text-muted-foreground">Title (always there)</span>
      </div>
      {schema.map((d) => {
        const derivedType = d.type === 'relation' || d.type === 'rollup';
        return (
          <div key={d.id} className="border-b py-1 last:border-b-0">
            <div className={rowCls}>
              <NameInput value={d.name} onCommit={(name) => name && patch(d.id, { name })} />
              {derivedType ? (
                <span className="w-32 flex-none truncate text-xs text-muted-foreground" title={d.type === 'relation' ? dbName(d.relation!.database) : 'Calculated from linked rows'}>
                  {typeLabel(d.type)}
                  {d.type === 'relation' ? ` → ${dbName(d.relation!.database).replace(' (sub-items, parents)', '')}` : ''}
                </span>
              ) : (
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
              )}
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
                description={
                  d.type === 'relation' && !d.relation?.reverseOf
                    ? 'The links are removed, and so is the matching property in the other database.'
                    : 'Its values are removed from every row in this database.'
                }
                onConfirm={() => onChange(schema.filter((x) => x.id !== d.id))}
              />
            </div>
            {openId === d.id && (d.type === 'select' || d.type === 'multiselect') && <OptionsEditor def={d} onChange={(options) => patch(d.id, { options })} />}
          </div>
        );
      })}

      <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg border p-2">
        <div className={rowCls}>
          <Input
            className={cn(grow, 'h-7')}
            placeholder={newType === 'relation' ? 'Name (optional)' : 'New property name'}
            aria-label="New property name"
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canAdd && add()}
          />
          <SimpleSelect aria-label="New property type" className="w-32 flex-none" value={newType} onChange={(v) => setNewType(v as PropType)} options={newTypeOptions} />
        </div>

        {newType === 'relation' && (
          <>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Link to
              <SimpleSelect
                aria-label="Database to link to"
                className={grow}
                value={target}
                onChange={setTarget}
                options={databases.map((d) => ({ value: d.id, label: d.id === selfId ? 'This database (sub-items, parents)' : d.title || 'Untitled' }))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={twoWay} onCheckedChange={(c) => setTwoWay(c === true)} /> Also show on the other side
            </label>
            {twoWay && (
              <Input className="h-7" placeholder={target === selfId ? 'Name on the other side (Sub-items)' : 'Name on the other side'} aria-label="Name on the other side" value={reverseName} maxLength={60} onChange={(e) => setReverseName(e.target.value)} />
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={single} onCheckedChange={(c) => setSingle(c === true)} /> Only one linked row (like a parent)
            </label>
          </>
        )}

        {newType === 'rollup' &&
          (relations.length === 0 ? (
            <MenuNote>Add a relation property first; a rollup summarises the rows it links to.</MenuNote>
          ) : (
            <>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                Of
                <SimpleSelect aria-label="Relation to summarise" className={grow} value={activeRel?.id ?? ''} onChange={setRollRel} options={relations.map((d) => ({ value: d.id, label: d.name }))} />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                Show
                <SimpleSelect
                  aria-label="Calculation"
                  className={grow}
                  value={rollFn}
                  onChange={(v) => {
                    setRollFn(v as RollupFn);
                    setRollTarget('');
                    setRollOptions([]);
                  }}
                  options={ROLLUP_FNS.map((f) => ({ value: f, label: ROLLUP_LABEL[f] }))}
                />
              </label>
              {wantType && (
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  Using
                  {targetChoices.length === 0 ? (
                    <span className="text-xs">no {wantType} property in the linked database yet</span>
                  ) : (
                    <SimpleSelect
                      aria-label="Property to summarise"
                      className={grow}
                      value={chosenTarget?.id ?? ''}
                      onChange={(v) => {
                        setRollTarget(v);
                        setRollOptions([]);
                      }}
                      options={targetChoices.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  )}
                </label>
              )}
              {rollFn === 'percent_option' && chosenTarget && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Counts as done:</span>
                  {(chosenTarget.options ?? []).map((o) => (
                    <label key={o.id} className="flex items-center gap-2">
                      <Checkbox checked={rollOptions.includes(o.id)} onCheckedChange={(c) => setRollOptions((prev) => (c === true ? [...prev, o.id] : prev.filter((x) => x !== o.id)))} />
                      {o.name}
                    </label>
                  ))}
                </div>
              )}
            </>
          ))}

        {error && (
          <div className="text-sm text-destructive" role="alert">
            {error}
          </div>
        )}
        <Button size="sm" onClick={add} disabled={!canAdd}>
          {newType === 'relation' ? 'Add relation' : 'Add property'}
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
