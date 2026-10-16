import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare, type MiniflareOptions } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { generated, judge, prompt, rewrite } from './fixtures.js';

const alice = 'test-only-alice-credential-000000000000000000';
const bob = 'test-only-bob-credential-00000000000000000000';
const credentials = JSON.stringify([{ owner: 'alice', sha256: createHash('sha256').update(alice).digest('hex') }, { owner: 'bob', sha256: createHash('sha256').update(bob).digest('hex') }]);
let runtime: Miniflare;
let options: MiniflareOptions;
let root: string;
const clients: Client[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'promptzilla-cloudflare-'));
  const bundled = await build({ entryPoints: [resolve('worker/index.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023', conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:workers'] });
  options = convertV4MiniflareOptions({
    name: 'promptzilla-test', modules: true, script: bundled.outputFiles[0]!.text,
    compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { PROMPTZILLA_CLIENTS: credentials },
    durableObjects: { PIPELINE_RUNS: { className: 'PipelineRun', useSQLite: true } },
    resourcePersistencePath: root, telemetry: { enabled: false },
  });
  runtime = new Miniflare(options);
  await runtime.ready;
}, 30000);
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); });
afterAll(async () => { await runtime?.dispose(); if (root) await rm(root, { recursive: true, force: true }); });

async function connect(token = alice) {
  const client = new Client({ name: 'cloudflare-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', await runtime.ready), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  return response.structuredContent as any;
}
let sequence = 0;
async function submit(client: Client, view: any, output: string) {
  return call(client, 'pipeline_submit', { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: `worker-${++sequence}`, fresh_context: true, output });
}

test('HTTP endpoint is private, fail-closed, origin-checked and size-bounded', async () => {
  expect((await runtime.dispatchFetch('https://example.com/health')).status).toBe(200);
  expect((await runtime.dispatchFetch('https://example.com/mcp')).status).toBe(401);
  expect((await runtime.dispatchFetch(`https://example.com/mcp?token=${alice}`)).status).toBe(401);
  expect((await runtime.dispatchFetch('https://example.com/mcp', { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401);
  expect((await runtime.dispatchFetch('https://example.com/mcp', { headers: { Authorization: `Bearer ${alice}`, Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await runtime.dispatchFetch('https://example.com/mcp', { method: 'POST', headers: { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: 'x'.repeat(4_194_305) })).status).toBe(413);
});

test('remote discovery and original source resources match local capabilities', async () => {
  const client = await connect();
  expect((await client.listTools()).tools).toHaveLength(13);
  expect((await client.listPrompts()).prompts).toHaveLength(5);
  expect((await call(client, 'list_skills')).skills).toHaveLength(5);
  expect((await client.readResource({ uri: 'promptzilla://skills/metapod' })).contents[0]).toHaveProperty('text', expect.stringContaining('name: metapod'));
});

test.each(['full', 'optimize-only'])('remote %s workflow persists immutable artifacts and confirms exact fixes', async mode => {
  const client = await connect();
  let view = await call(client, 'prompt_pipeline', { mode, input: mode === 'full' ? 'meeting notes bot' : prompt });
  if (mode === 'full') view = await submit(client, view, generated);
  view = await submit(client, view, judge(8));
  view = await submit(client, view, rewrite(prompt));
  expect(view.dispatch.input.prompt).toBe(prompt);
  expect(view.dispatch.input.prompt).not.toContain('Rec-application checklist');
  view = await submit(client, view, judge(9));
  expect(view.final.approved).toBe(true);
  const originalFinal = view.final.uri;
  view = await call(client, 'pipeline_apply_fixes', { run_id: view.id, fixes: [{ old: 'notes', new: 'meeting notes' }] });
  expect(view.final.approved).toBe(false);
  view = await submit(client, view, '1. PASS — exact diff.');
  expect(view.final.approved).toBe(true);
  expect((await client.readResource({ uri: originalFinal })).contents[0]).toHaveProperty('text', prompt);
  expect((await client.readResource({ uri: view.final.uri })).contents[0]).toHaveProperty('text', prompt.replace('notes', 'meeting notes'));
});

test('another authenticated owner cannot read or mutate a known run UUID', async () => {
  const owner = await connect();
  const other = await connect(bob);
  const view = await call(owner, 'prompt_pipeline', { mode: 'optimize-only', input: prompt });
  expect((await other.callTool({ name: 'pipeline_status', arguments: { run_id: view.id } })).isError).toBe(true);
  expect((await other.callTool({ name: 'pipeline_submit', arguments: { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: 'attacker', fresh_context: true, output: judge(9) } })).isError).toBe(true);
  await expect(other.readResource({ uri: view.artifacts[0].uri })).rejects.toThrow();
  expect((await call(owner, 'pipeline_status', { run_id: view.id })).status).toBe('running');
});

test('concurrent submissions cannot advance the same dispatch twice', async () => {
  const client = await connect();
  const view = await call(client, 'prompt_pipeline', { mode: 'optimize-only', input: prompt });
  const args = { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: 'one-worker', fresh_context: true, output: judge(8) };
  const results = await Promise.all([client.callTool({ name: 'pipeline_submit', arguments: args }), client.callTool({ name: 'pipeline_submit', arguments: args })]);
  expect(results.filter(r => !r.isError)).toHaveLength(1);
  expect((await call(client, 'pipeline_status', { run_id: view.id })).history).toHaveLength(1);
});

test('remote retries, user pauses and four-round cap preserve workflow rules', async () => {
  const client = await connect();
  let view = await call(client, 'prompt_pipeline', { mode: 'full', input: 'notes bot' });
  view = await submit(client, view, 'invalid generation');
  expect(view.dispatch.attempt).toBe(1);
  view = await call(client, 'pipeline_pause', { run_id: view.id, reason: 'Need a fresh worker' });
  view = await call(client, 'pipeline_resume', { run_id: view.id, decision: 'Worker available' });
  expect(view.dispatch.attempt).toBe(1);
  view = await submit(client, view, generated);
  for (const score of [5, 6, 7, 8]) {
    view = await submit(client, view, judge(score));
    if (score !== 8) view = await submit(client, view, rewrite(prompt));
  }
  expect(view.status).toBe('capped');
  expect(view.final.approved).toBe(false);
});

test('SQLite state survives full runtime restart, including multi-megabyte Unicode state', async () => {
  let client = await connect();
  const largePrompt = 'Preserve café [TBD]\r\n' + '🙂'.repeat(75000);
  let view = await call(client, 'prompt_pipeline', { mode: 'optimize-only', input: largePrompt });
  view = await submit(client, view, judge(8));
  view = await submit(client, view, rewrite(largePrompt));
  const id = view.id;
  await client.close();
  clients.splice(clients.indexOf(client), 1);
  await runtime.dispose();
  runtime = new Miniflare(options);
  await runtime.ready;
  client = await connect();
  view = await call(client, 'pipeline_status', { run_id: id });
  expect(view.history.map((h: any) => h.score)).toEqual([8]);
  expect(view.dispatch.input.prompt).toBe(largePrompt);
  view = await submit(client, view, judge(9));
  expect((await client.readResource({ uri: view.final.uri })).contents[0]).toHaveProperty('text', largePrompt);
}, 30000);
