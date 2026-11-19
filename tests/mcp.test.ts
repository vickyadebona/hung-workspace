import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilePageStore } from '../src/lib/storage.ts';
import { Workspace } from '../src/lib/access.ts';
import { createToken, listTokens, revokeToken, verifyToken } from '../src/lib/apitokens.ts';
import { handleRpc } from '../src/lib/mcp.ts';

const VICKY = 'vicky@example.com';
const ANDREW = 'andrew@example.com';
const KEY = 'test-secret';
const ALLOWED = [VICKY, ANDREW];

const fresh = async () => new FilePageStore(await fs.mkdtemp(path.join(os.tmpdir(), 'wn-mcp-')));
const as = (store: FilePageStore, email: string) => new Workspace(store, { email, name: email.split('@')[0] }, ALLOWED);
const call = async (ws: Workspace, name: string, args: Record<string, unknown> = {}) => {
  const r: any = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ws);
  const t = r.result.content[0].text as string;
  return { isError: !!r.result.isError, text: t, data: r.result.isError ? null : t.startsWith('{') ? JSON.parse(t) : null };
};

test('a token works for its owner only, is stored hashed, and can be revoked', async () => {
  const store = await fresh();
  const { info, token } = await createToken(store, KEY, VICKY, 'Claude');
  assert.equal(await verifyToken(store, KEY, token), VICKY);
  assert.equal(await verifyToken(store, KEY, token + 'x'), null);
  assert.equal(await verifyToken(store, 'other-secret', token), null);
  // Andrew cannot reuse Vicky's secret under his own name
  const secret = token.split('.')[1];
  assert.equal(await verifyToken(store, KEY, `hw_${Buffer.from(ANDREW).toString('base64url')}.${secret}`), null);
  const sealed = (await store.getIntegration(VICKY, 'api-tokens')) ?? '';
  assert.ok(!sealed.includes(secret));
  assert.deepEqual((await listTokens(store, KEY, VICKY)).map((t) => t.label), ['Claude']);
  assert.equal(await revokeToken(store, KEY, VICKY, info.id), true);
  assert.equal(await verifyToken(store, KEY, token), null);
  assert.equal(await revokeToken(store, KEY, VICKY, info.id), false);
});

test('tokens are capped per person', async () => {
  const store = await fresh();
  for (let i = 0; i < 10; i++) await createToken(store, KEY, VICKY, `t${i}`);
  await assert.rejects(() => createToken(store, KEY, VICKY, 'one too many'), /up to 10/);
});

test('protocol basics: initialize, notifications, tools/list, unknown things', async () => {
  const ws = as(await fresh(), VICKY);
  const init: any = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ws);
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, ws), null);
  const list: any = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ws);
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ['list_tasks', 'add_task', 'complete_task', 'search', 'read_page']);
  const nope: any = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'nope' }, ws);
  assert.equal(nope.error.code, -32601);
  const badTool: any = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'rm_rf' } }, ws);
  assert.equal(badTool.error.code, -32602);
});

test('add, list and complete a task', async () => {
  const ws = as(await fresh(), VICKY);
  const added = await call(ws, 'add_task', { title: 'Send invoices', due: '2026-12-01' });
  assert.equal(added.data.added.title, 'Send invoices');
  assert.equal((await call(ws, 'add_task', { title: 'x', due: 'tomorrow' })).isError, true);
  assert.equal((await call(ws, 'add_task', { title: '  ' })).isError, true);

  const open = await call(ws, 'list_tasks');
  assert.equal(open.data.count, 1);
  const id = open.data.tasks[0].id;

  const done = await call(ws, 'complete_task', { id });
  assert.equal(done.data.task.done, true);
  assert.equal((await call(ws, 'list_tasks')).data.count, 0);
  assert.equal((await call(ws, 'list_tasks', { include_done: true })).data.count, 1);

  const reopened = await call(ws, 'complete_task', { id, done: false });
  assert.equal(reopened.data.task.done, false);
  assert.equal((await call(ws, 'complete_task', { id: 'nope' })).isError, true);
});

test("one person's connector never sees or changes another person's pages and tasks", async () => {
  const store = await fresh();
  const vicky = as(store, VICKY);
  const andrew = as(store, ANDREW);
  const secret = await vicky.create({ kind: 'page', title: 'Vicky private plan', body: 'zebra-secret' } as any);
  const task = (await call(vicky, 'add_task', { title: 'Vicky only' })).data.added;

  assert.equal((await call(andrew, 'search', { query: 'zebra-secret' })).data.results.length, 0);
  assert.equal((await call(andrew, 'read_page', { id: secret.id })).isError, true);
  assert.equal((await call(andrew, 'complete_task', { id: task.id })).isError, true);
  assert.equal((await call(andrew, 'list_tasks')).data.count, 0);

  assert.equal((await call(vicky, 'search', { query: 'zebra-secret' })).data.results[0].id, secret.id);
  assert.match((await call(vicky, 'read_page', { id: secret.id })).text, /zebra-secret/);
});
