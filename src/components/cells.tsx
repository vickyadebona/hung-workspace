import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PropertyDef } from '../lib/dbschema';
import { api } from './api';
import { useMembers, useWorkspaceData } from './workspace-context';

/** What a relation or rollup needs to know about the database it points at. */
export interface Related {
  title: string;
  icon: string;
  schema: PropertyDef[];
  rows: { id: string; title: string }[];
}

/** Everything a cell editor may need beyond its own value. */
export interface CellCtx {
  people: Record<string, string>;
  members: { email: string; name: string }[];
  related: Record<string, Related>; // by database id
}

export const emptyCtx: CellCtx = { people: {}, members: [], related: {} };

/** Load the databases that this database's relations point at (so linked rows can be shown by title). */
export function useCellCtx(dbId: string, schema: PropertyDef[] | undefined, spaceId: string | undefined): CellCtx & { reload: () => void } {
  const { people } = useWorkspaceData();
  const members = useMembers(spaceId);
  const [related, setRelated] = useState<Record<string, Related>>({});
  const targets = useMemo(
    () => [...new Set((schema ?? []).flatMap((d) => (d.type === 'relation' && d.relation ? [d.relation.database] : [])))].sort(),
    [schema],
  );
  const key = targets.join(',');

  const load = useCallback(async () => {
    const out: Record<string, Related> = {};
    await Promise.all(
      targets.map(async (id) => {
        const r = await api.getDatabase(id).catch(() => null);
        if (r) out[id] = { title: r.database.title, icon: r.database.icon, schema: r.database.schema ?? [], rows: r.rows.map((x) => ({ id: x.id, title: x.title })) };
      }),
    );
    setRelated(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dbId]);

  useEffect(() => {
    load();
  }, [load]);

  return { people, members, related, reload: load };
}

export const nameOf = (ctx: CellCtx, email: string) => ctx.people[email] || email.split('@')[0];
export const titleOf = (ctx: CellCtx, dbId: string, rowId: string) => ctx.related[dbId]?.rows.find((r) => r.id === rowId)?.title;
