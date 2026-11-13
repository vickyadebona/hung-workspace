import { COLORS, uid, type PropertyDef } from '../lib/dbschema';
import { api, type Page } from './api';

/**
 * Add a new option to a select/multiselect property and save the schema.
 * Returns the updated database page and the id of the new (or already existing) option.
 */
export async function addOption(db: Page, propId: string, name: string): Promise<{ db: Page; optionId: string } | null> {
  const clean = name.trim().slice(0, 40);
  const schema = db.schema ?? [];
  const def = schema.find((p) => p.id === propId);
  if (!def || !clean) return null;
  const existing = def.options?.find((o) => o.name.toLowerCase() === clean.toLowerCase());
  if (existing) return { db, optionId: existing.id };
  const optionId = uid();
  const color = COLORS[(def.options?.length ?? 0) % COLORS.length];
  const next: PropertyDef[] = schema.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), { id: optionId, name: clean, color }] } : p));
  const res = await api.update(db.id, { schema: next });
  if (!res.ok) return null;
  return { db: res.page, optionId };
}
