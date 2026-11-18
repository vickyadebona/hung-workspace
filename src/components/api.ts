import type { PropertyDef, Props, View } from '../lib/dbschema';

export type { PropertyDef, Props, View };

export interface Space {
  id: string;
  name: string;
  icon: string;
  kind: 'personal' | 'shared';
  owner: string;
  members: string[];
  createdAt: string;
}

export interface PageMeta {
  id: string;
  space: string;
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

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  space: string;
  database?: string | null;
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
    space?: string | null;
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
  async search(q: string): Promise<SearchHit[]> {
    return (await call<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`)).data.results;
  },
  async spaces(): Promise<{ spaces: Space[]; personal: string; me: string }> {
    return (await call<{ spaces: Space[]; personal: string; me: string }>('/api/spaces')).data;
  },
  async createSpace(name: string, icon?: string): Promise<Space> {
    const r = await call<{ space?: Space; error?: string }>('/api/spaces', { method: 'POST', body: JSON.stringify({ name, icon }) });
    if (r.status !== 201 || !r.data.space) throw new Error(r.data.error ?? 'Could not create the space');
    return r.data.space;
  },
  async updateSpace(id: string, patch: { name?: string; icon?: string; addMember?: string; removeMember?: string }): Promise<{ ok: true; space: Space } | { ok: false; error: string }> {
    const r = await call<{ space?: Space; error?: string }>(`/api/spaces/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
    return r.status === 200 && r.data.space ? { ok: true, space: r.data.space } : { ok: false, error: r.data.error ?? 'Could not save' };
  },
  async movePage(id: string, space: string): Promise<string[]> {
    const r = await call<{ moved?: string[]; error?: string }>(`/api/pages/${id}/move`, { method: 'POST', body: JSON.stringify({ space }) });
    if (r.status !== 200) throw new Error(r.data.error ?? 'Could not move the page');
    return r.data.moved ?? [];
  },
};
