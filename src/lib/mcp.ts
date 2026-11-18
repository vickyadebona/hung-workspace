import type { Workspace } from './access.ts';
import { HttpError } from './access.ts';

/**
 * A small Model Context Protocol server (JSON-RPC over HTTP, no streaming) so Claude, Duet and other MCP clients can work
 * with one person's workspace. Everything goes through the same access layer as the app, so a tool only ever sees what
 * that person can see. Tools: read your tasks, add a task, tick one off, search, read a page.
 */
const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}
type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const TOOLS = [
  {
    name: 'list_tasks',
    description: 'List the tasks assigned to the user, across all their spaces, with due date, status and priority. Open tasks only unless include_done is true.',
    inputSchema: { type: 'object', properties: { include_done: { type: 'boolean', description: 'Also list finished tasks' } } },
    annotations: { readOnlyHint: true, title: 'List my tasks' },
  },
  {
    name: 'add_task',
    description: 'Add a task for the user to their "My tasks" list.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'What needs doing' }, due: { type: 'string', description: 'Optional due date, YYYY-MM-DD' } },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, title: 'Add a task' },
  },
  {
    name: 'complete_task',
    description: 'Mark a task done (or reopen it with done=false). Use the id from list_tasks.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, done: { type: 'boolean', description: 'true (default) to finish, false to reopen' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, title: 'Complete a task' },
  },
  {
    name: 'search',
    description: 'Search the titles and text of the pages the user can see. Returns ids to use with read_page.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    annotations: { readOnlyHint: true, title: 'Search pages' },
  },
  {
    name: 'read_page',
    description: 'Read one page as Markdown. For a database it lists the first 50 rows.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true, title: 'Read a page' },
  },
] as const;

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const asJson = (v: unknown) => text(JSON.stringify(v, null, 2));

function taskOut(t: any) {
  return { id: t.id, title: t.title, due: t.due, status: t.status?.name ?? null, priority: t.priority?.name ?? null, done: t.done, list: t.databaseTitle, space: t.spaceName };
}

async function callTool(ws: Workspace, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_tasks': {
      const all = await ws.myTasks();
      const tasks = (args.include_done === true ? all : all.filter((t) => !t.done)).map(taskOut);
      return asJson({ count: tasks.length, tasks });
    }
    case 'add_task': {
      const due = typeof args.due === 'string' ? args.due : undefined;
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return text('due must look like 2026-12-31', true);
      return asJson({ added: taskOut(await ws.addMyTask(typeof args.title === 'string' ? args.title : '', due)) });
    }
    case 'complete_task': {
      const id = typeof args.id === 'string' ? args.id : '';
      const task = (await ws.myTasks()).find((t) => t.id === id);
      if (!task) return text('No task with that id is assigned to you.', true);
      if (!task.toggle) return text('That task has no status or Done property to change.', true);
      const wantDone = args.done !== false;
      if (task.done === wantDone) return asJson({ task: taskOut(task), unchanged: true });
      await ws.update(id, { props: { [task.toggle.propId]: wantDone ? task.toggle.done : task.toggle.open } });
      const after = (await ws.myTasks()).find((t) => t.id === id);
      return asJson({ task: after ? taskOut(after) : { id, done: wantDone } });
    }
    case 'search': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      if (!q) return text('Give something to search for.', true);
      return asJson({ results: (await ws.search(q)).slice(0, 20).map((h) => ({ id: h.id, title: h.title, snippet: h.snippet })) });
    }
    case 'read_page': {
      const id = typeof args.id === 'string' ? args.id : '';
      const page = await ws.get(id);
      if (!page) return text('Page not found.', true);
      if (page.kind === 'database') {
        const found = await ws.database(id);
        if (!found) return text('Page not found.', true);
        const { database, rows } = found;
        const cols = (database.schema ?? []).map((d) => d.name).join(', ');
        const lines = rows.slice(0, 50).map((r) => `- ${r.title} (id ${r.id})`);
        return text(`# ${database.title}\nDatabase. Properties: ${cols}\n\n${lines.join('\n')}${rows.length > 50 ? `\n…and ${rows.length - 50} more` : ''}`);
      }
      return text(`# ${page.title}\n\n${page.body ?? ''}`.slice(0, 60_000));
    }
    default:
      return null;
  }
}

/** Handle one JSON-RPC message. Returns null for notifications (nothing to send back). */
export async function handleRpc(msg: Rpc, ws: Workspace): Promise<Reply | null> {
  const id = msg?.id ?? null;
  const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(-32600, 'Invalid request');
  if (msg.id === undefined) return null; // a notification, e.g. notifications/initialized
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'hung-workspace', version: '1.0.0' },
        instructions: 'Your Hung Workspace: read and add your own tasks, and search or read your pages.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      const args = msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {};
      if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name)) return err(-32602, 'Unknown tool');
      try {
        return ok(await callTool(ws, name, args));
      } catch (e) {
        // Problems with what was asked are reported to the model so it can correct itself; anything else is hidden.
        return ok(text(e instanceof HttpError || (e instanceof Error && e.constructor === Error) ? (e as Error).message : 'Something went wrong.', true));
      }
    }
    default:
      return err(-32601, 'Method not found');
  }
}
