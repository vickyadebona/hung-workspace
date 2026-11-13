import type { PropertyDef, Props, View } from '../lib/dbschema';

export type { PropertyDef, Props, View };

export interface PageMeta {
  id: string;
  title: string;
  parent: string | null;
  icon: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  kind: 'page' | 'database';
  database: string | null;
  props: Props;
  schema?: PropertyDef[];
  views?: View[];
}
export interface Page extends PageMeta {
  body: string;
}

export interface UpdatePatch {
  title?: string;
  body?: string;
  parent?: string | null;
  icon?: string;
  order?: number;
  props?: Record<string, unknown>;
  schema?: PropertyDef[];
  views?: View[];
  baseUpdatedAt?: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    location.href = '/auth/login';
    throw new Error('Not signed in');
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export type UpdateResult = { ok: true; page: Page } | { ok: false; conflict: boolean; error: string; current?: Page };

export const api = {
  async list(): Promise<PageMeta[]> {
    return (await call<{ pages: PageMeta[] }>('/api/pages')).data.pages;
  },
  async get(id: string): Promise<Page | null> {
    const r = await call<{ page: Page }>(`/api/pages/${id}`);
    return r.status === 200 ? r.data.page : null;
  },
  async getDatabase(id: string): Promise<{ database: Page; rows: PageMeta[] } | null> {
    const r = await call<{ database: Page; rows: PageMeta[] }>(`/api/databases/${id}`);
    return r.status === 200 ? r.data : null;
  },
  async create(input: {
    title?: string;
    parent?: string | null;
    icon?: string;
    kind?: 'page' | 'database';
    database?: string;
    props?: Record<string, unknown>;
  }): Promise<Page> {
    const r = await call<{ page: Page; error?: string }>('/api/pages', { method: 'POST', body: JSON.stringify(input) });
    if (r.status !== 201) throw new Error(r.data.error ?? 'Could not create page');
    return r.data.page;
  },
  async update(id: string, patch: UpdatePatch): Promise<UpdateResult> {
    const r = await call<{ page?: Page; error?: string; current?: Page }>(`/api/pages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    if (r.status === 200 && r.data.page) return { ok: true, page: r.data.page };
    return { ok: false, conflict: r.status === 409, error: r.data.error ?? 'Save failed', current: r.data.current };
  },
  async remove(id: string): Promise<string[]> {
    const r = await call<{ removed?: string[] }>(`/api/pages/${id}`, { method: 'DELETE' });
    return r.data.removed ?? [];
  },
  async search(q: string): Promise<{ id: string; title: string; snippet: string; database?: string | null }[]> {
    return (await call<{ results: { id: string; title: string; snippet: string; database?: string | null }[] }>(`/api/search?q=${encodeURIComponent(q)}`)).data
      .results;
  },
};
