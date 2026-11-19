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

import type { CalendarEvent } from '../lib/gcal';

export type { CalendarEvent };

export type CalendarResponse =
  | { configured: boolean; connected: false; reason?: 'not-connected' | 'expired' }
  | { configured: boolean; connected: true; events: CalendarEvent[]; calendars: { id: string; name: string; color: string }[] };

export interface MyTask {
  id: string;
  title: string;
  database: string;
  databaseTitle: string;
  databaseIcon: string;
  space: string;
  spaceName: string;
  due: string | null;
  status: { name: string; color: string } | null;
  priority: { name: string; color: string } | null;
  done: boolean;
  toggle: { propId: string; done: string | true; open: string | null } | null;
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
  async calendar(from: Date, to: Date): Promise<CalendarResponse> {
    const r = await call<CalendarResponse & { error?: string }>(`/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    if (r.status !== 200) throw new Error(r.data.error ?? 'Could not load your calendar');
    return r.data;
  },
  async calendarStatus(): Promise<{ configured: boolean; connected: boolean }> {
    return (await call<{ configured: boolean; connected: boolean }>('/api/calendar')).data;
  },
  async disconnectCalendar(): Promise<void> {
    await call('/api/calendar', { method: 'DELETE' });
  },
  async tokens(): Promise<{ id: string; label: string; createdAt: string }[]> {
    return (await call<{ tokens: { id: string; label: string; createdAt: string }[] }>('/api/tokens')).data.tokens ?? [];
  },
  async createToken(label: string): Promise<string> {
    const r = await call<{ secret?: string; error?: string }>('/api/tokens', { method: 'POST', body: JSON.stringify({ label }) });
    if (!r.data.secret) throw new Error(r.data.error ?? 'Could not make the token');
    return r.data.secret;
  },
  async revokeToken(id: string): Promise<void> {
    await call(`/api/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async myTasks(): Promise<MyTask[]> {
    return (await call<{ tasks: MyTask[] }>('/api/my-tasks')).data.tasks ?? [];
  },
  async addMyTask(title: string, due?: string): Promise<MyTask> {
    const r = await call<{ task?: MyTask; error?: string }>('/api/my-tasks', { method: 'POST', body: JSON.stringify({ title, due }) });
    if (r.status !== 201 || !r.data.task) throw new Error(r.data.error ?? 'Could not add the task');
    return r.data.task;
  },
  async spaces(): Promise<{ spaces: Space[]; personal: string; me: string; people: Record<string, string> }> {
    return (await call<{ spaces: Space[]; personal: string; me: string; people: Record<string, string> }>('/api/spaces')).data;
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
  async addRelation(
    dbId: string,
    opts: { name: string; target: string; twoWay: boolean; reverseName?: string; single?: boolean },
  ): Promise<{ ok: true; property: PropertyDef } | { ok: false; error: string }> {
    const r = await call<{ property?: PropertyDef; error?: string }>(`/api/databases/${dbId}/relations`, { method: 'POST', body: JSON.stringify(opts) });
    return r.status === 201 && r.data.property ? { ok: true, property: r.data.property } : { ok: false, error: r.data.error ?? 'Could not add the relation' };
  },
  async movePage(id: string, space: string): Promise<string[]> {
    const r = await call<{ moved?: string[]; error?: string }>(`/api/pages/${id}/move`, { method: 'POST', body: JSON.stringify({ space }) });
    if (r.status !== 200) throw new Error(r.data.error ?? 'Could not move the page');
    return r.data.moved ?? [];
  },
};
