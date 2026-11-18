import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyView, type PropertyDef, type PropValue, type Row, type View } from '../lib/dbschema';
import { Button } from '@/components/ui/button';
import { api, type Page, type PageMeta } from './api';
import IconPicker from './IconPicker';
import { Banner, iconInput, titleInput } from './PageEditor';
import { addOption } from './dbops';
import DbToolbar from './DbToolbar';
import { useCellCtx } from './cells';
import { DatabaseSkeleton } from './Skeletons';
import { useDatabases } from './workspace-context';
import { BoardView, CalendarView, ListView, TableView } from './DbViews';

interface Props {
  dbId: string;
  onMeta: (id: string, patch: { title?: string; icon?: string }) => void;
  onOpenRow: (id: string) => void;
}

export default function DatabaseView({ dbId, onMeta, onOpenRow }: Props) {
  const [db, setDb] = useState<Page | null>(null);
  const [rows, setRows] = useState<PageMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(`wn_view_${dbId}`));
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('');
  const pending = useRef(0);
  const metaLoaded = useRef(false);
  const metaLatest = useRef({ title: '', icon: '' });
  const reqId = useRef(0);
  const viewsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewsLatest = useRef<View[] | null>(null);
  const dbRef = useRef<Page | null>(null);
  dbRef.current = db;

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const r = await api.getDatabase(dbId).catch(() => null);
    if (id !== reqId.current) return;
    if (!r) {
      setError('Could not load this database.');
      return;
    }
    setError(null);
    setDb(r.database);
    setRows(r.rows);
    if (!metaLoaded.current) {
      metaLoaded.current = true;
      setTitle(r.database.title);
      setIcon(r.database.icon);
      metaLatest.current = { title: r.database.title, icon: r.database.icon };
    }
  }, [dbId]);

  useEffect(() => {
    load();
  }, [load]);

  // Pick up changes made elsewhere (e.g. by Andrew) when the tab regains focus.
  useEffect(() => {
    const on = () => {
      if (pending.current === 0 && !viewsTimer.current) load();
    };
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [load]);

  const track = async <T,>(p: Promise<T>): Promise<T> => {
    pending.current++;
    try {
      return await p;
    } finally {
      pending.current--;
    }
  };

  /* ---- views ---- */
  const flushViews = useCallback(() => {
    if (viewsTimer.current) {
      clearTimeout(viewsTimer.current);
      viewsTimer.current = null;
    }
    const v = viewsLatest.current;
    viewsLatest.current = null;
    if (v) track(api.update(dbId, { views: v })).then((res) => {
      if (!res.ok) load();
    });
  }, [dbId, load]);

  useEffect(() => () => flushViews(), [flushViews]);

  const saveViews = (views: View[]) => {
    setDb((d) => (d ? { ...d, views } : d));
    viewsLatest.current = views;
    if (viewsTimer.current) clearTimeout(viewsTimer.current);
    viewsTimer.current = setTimeout(flushViews, 400);
  };

  const selectView = (id: string) => {
    setActiveId(id);
    localStorage.setItem(`wn_view_${dbId}`, id);
  };

  /* ---- schema ---- */
  const saveSchema = async (schema: PropertyDef[]) => {
    setDb((d) => (d ? { ...d, schema } : d));
    const res = await track(api.update(dbId, { schema }));
    if (res.ok) {
      setDb(res.page);
      const r = await api.getDatabase(dbId);
      if (r) setRows(r.rows);
    } else load();
  };

  const createOption = async (propId: string, name: string): Promise<string | null> => {
    const cur = dbRef.current;
    if (!cur) return null;
    const r = await track(addOption(cur, propId, name));
    if (!r) return null;
    setDb(r.db);
    return r.optionId;
  };

  /* ---- rows ---- */
  const setProp = (rowId: string, propId: string, value: PropValue) => {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, props: { ...r.props, [propId]: value } } : r)));
    const isRelation = dbRef.current?.schema?.find((d) => d.id === propId)?.type === 'relation';
    track(api.update(rowId, { props: { [propId]: value } })).then((res) => {
      // a change to a link also changes the other side (and rollups), so take a fresh copy of the rows
      if (!res.ok || isRelation) load();
    });
  };

  const setRowTitle = (rowId: string, t: string) => {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, title: t || 'Untitled' } : r)));
    track(api.update(rowId, { title: t })).then((res) => {
      if (!res.ok) load();
    });
  };

  const addRow = async (initial: { props?: Record<string, unknown> }) => {
    try {
      const row = await track(api.create({ database: dbId, title: '', props: initial.props }));
      setRows((rs) => [...rs, row]);
      setFocusRowId(row.id);
    } catch {
      setError('Could not add a row.');
    }
  };

  const deleteRow = async (rowId: string) => {
    setRows((rs) => rs.filter((r) => r.id !== rowId));
    await track(api.remove(rowId));
  };

  /* ---- title / icon ---- */
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMeta = (patch: { title?: string; icon?: string }) => {
    metaLatest.current = { ...metaLatest.current, ...patch };
    onMeta(dbId, { ...patch, title: patch.title !== undefined ? patch.title || 'Untitled' : undefined });
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => {
      metaTimer.current = null;
      track(api.update(dbId, metaLatest.current));
    }, 600);
  };
  useEffect(
    () => () => {
      if (metaTimer.current) {
        clearTimeout(metaTimer.current);
        api.update(dbId, metaLatest.current);
      }
    },
    [dbId],
  );

  const schema = db?.schema ?? [];
  const ctx = useCellCtx(dbId, db?.schema, db?.space);
  const databases = useDatabases(db?.space);
  const views = db?.views ?? [];
  const view = views.find((v) => v.id === activeId) ?? views[0];
  const shown = useMemo(() => (view ? applyView(rows as Row[], view, schema) : []), [rows, view, schema]);

  if (error && !db)
    return (
      <div className="grid h-[60vh] place-items-center text-center text-muted-foreground">
        <div>
          <p>{error}</p>
          <Button variant="outline" className="mt-2" onClick={load}>
            Try again
          </Button>
        </div>
      </div>
    );
  if (!db || !view) return <DatabaseSkeleton />;

  const addRelation = async (opts: { name: string; target: string; twoWay: boolean; reverseName?: string; single?: boolean }) => {
    const r = await api.addRelation(dbId, opts);
    if (r.ok) {
      await load();
      ctx.reload();
    }
    return r;
  };

  const common = {
    ctx,
    schema,
    view,
    rows: shown,
    focusRowId,
    onOpen: onOpenRow,
    onAdd: addRow,
    onProp: setProp,
    onTitle: setRowTitle,
    onDelete: deleteRow,
    onCreateOption: createOption,
  };

  return (
    <div className="mx-auto max-w-[1200px] px-3.5 pt-6 pb-28 md:px-10 md:pt-8">
      {error && (
        <Banner action={<Button size="sm" variant="outline" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Banner>
      )}
      <div className="mb-3 flex items-center gap-2">
        <IconPicker
          className={iconInput}
          label="Database icon"
          placeholder="🗂️"
          value={icon}
          onChange={(v) => {
            setIcon(v);
            saveMeta({ icon: v });
          }}
        />
        <input
          className={titleInput}
          value={title}
          placeholder="Untitled database"
          aria-label="Database title"
          onChange={(e) => {
            setTitle(e.target.value);
            saveMeta({ title: e.target.value });
          }}
        />
      </div>
      <DbToolbar
        schema={schema}
        views={views}
        view={view}
        onSelectView={selectView}
        onViews={saveViews}
        onSchema={saveSchema}
        selfId={dbId}
        databases={databases}
        ctx={ctx}
        onAddRelation={addRelation}
      />
      {view.type === 'table' && <TableView {...common} />}
      {view.type === 'board' && <BoardView {...common} />}
      {view.type === 'list' && <ListView {...common} />}
      {view.type === 'calendar' && <CalendarView {...common} />}
    </div>
  );
}
