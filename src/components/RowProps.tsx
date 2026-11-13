import { useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PropValue } from '../lib/dbschema';
import { api, type Page } from './api';
import { addOption } from './dbops';
import PropEditor from './PropEditor';

interface Props {
  row: Page;
  db: Page;
  onOpenDb: () => void;
  onDb: (db: Page) => void;
}

/** The property panel shown at the top of a database row's page. */
export default function RowProps({ row, db, onOpenDb, onDb }: Props) {
  const [values, setValues] = useState(row.props);
  const [dbState, setDbState] = useState(db);
  const [failed, setFailed] = useState(false);
  const schema = dbState.schema ?? [];

  const change = async (propId: string, v: PropValue) => {
    setValues((p) => ({ ...p, [propId]: v }));
    const res = await api.update(row.id, { props: { [propId]: v } }).catch(() => null);
    setFailed(!res || !res.ok);
  };

  const create = async (propId: string, name: string) => {
    const r = await addOption(dbState, propId, name);
    if (!r) return null;
    setDbState(r.db);
    onDb(r.db);
    return r.optionId;
  };

  return (
    <div className="mb-3 md:ml-[54px]">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onOpenDb}>
        <ArrowLeftIcon /> {db.icon || '🗂️'} {db.title || 'Untitled database'}
      </Button>
      {schema.length > 0 && (
        <dl className="mt-2 mb-1 grid gap-0.5">
          {schema.map((d) => (
            <div key={d.id} className="grid grid-cols-[100px_1fr] items-center md:grid-cols-[140px_1fr]">
              <dt className="truncate text-sm text-muted-foreground">{d.name}</dt>
              <dd className="max-w-sm">
                <PropEditor def={d} value={values[d.id] ?? null} onChange={(v) => change(d.id, v)} onCreateOption={create} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {failed && (
        <div className="text-xs text-destructive" role="alert">
          Could not save a property. Check your connection and try again.
        </div>
      )}
    </div>
  );
}
