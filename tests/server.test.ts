import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createServer } from '../src/server.js';
import { generated, judge, prompt, rewrite } from './fixtures.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
async function connect(stdio = false) {
  const root = await mkdtemp(join(tmpdir(), 'promptzilla-protocol-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const client = new Client({ name: 'promptzilla-test', version: '1.0.0' });
  if (stdio) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), '--runs-dir', root], cwd: tmpdir(), stderr: 'pipe' });
    await client.connect(transport);
  } else {
    const { server } = await createServer({ skillsDir: resolve('skills'), runsDir: root });
    cleanup.push(() => server.close());
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
  }
  cleanup.push(() => client.close());
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent as any;
}

test('tools, prompts and resources preserve skills and validate caller input', async () => {
  const client = await connect();
  const tools = await client.listTools();
  expect(tools.tools.map(t => t.name)).toContain('prompt_pipeline');
  expect((await client.listPrompts()).prompts).toHaveLength(5);
  expect((await call(client, 'list_skills')).skills).toHaveLength(5);
  expect((await call(client, 'search_skills', { query: 'rough task' })).skills[0].name).toBe('tasker');
  const packet = await call(client, 'get_skill', { name: 'metapod' });
  expect(packet.instructions).toContain('ABSOLUTE RULE');
  for (const [name, args] of [
    ['metapod', { request: 'meeting bot' }], ['tasker', { task: 'fix tests' }],
    ['judge_dredd', { prompt, fidelity_source: prompt }], ['brian_spillner', { prompt, scorecard: judge(8) }],
  ] as const) {
    expect((await call(client, name, args)).execution_required).toBe(true);
  }
  for (const name of ['metapod', 'tasker', 'judge-dredd', 'brian-spillner', 'prompt-pipeline']) {
    const args = name === 'brian-spillner' ? { input: prompt, scorecard: judge(8) } : { input: prompt };
    const result = await client.getPrompt({ name, arguments: args });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]?.content).toMatchObject({ type: 'text', text: expect.stringContaining('"input"') });
  }
  const resources = await client.listResources();
  expect(resources.resources.some(r => r.uri === 'promptzilla://skills/metapod')).toBe(true);
  expect((await client.readResource({ uri: 'promptzilla://catalog' })).contents[0]).toHaveProperty('text');
  expect((await client.readResource({ uri: 'promptzilla://assets/prompt-pipeline/scripts/stage_control.py' })).contents[0]).toHaveProperty('text', expect.stringContaining('def extract_body'));
  expect((await client.readResource({ uri: 'promptzilla://skills/metapod' })).contents[0]).toHaveProperty('text', expect.stringContaining('name: metapod'));
  await expect(client.readResource({ uri: 'promptzilla://assets/../../etc/passwd' })).rejects.toThrow();
  expect((await client.callTool({ name: 'get_skill', arguments: { name: '../secret' } })).isError).toBe(true);
  expect((await client.callTool({ name: 'metapod', arguments: { request: '' } })).isError).toBe(true);
  expect((await client.callTool({ name: 'brian_spillner', arguments: { prompt } })).isError).toBe(true);
  expect((await client.callTool({ name: 'prompt_pipeline', arguments: { mode: 'invalid', input: prompt } })).isError).toBe(true);
});

test.each([false, true])('complete full and optimize-only runs through real MCP client (stdio=%s)', async stdio => {
  const client = await connect(stdio);
  for (const mode of ['full', 'optimize-only']) {
    let view = await call(client, 'prompt_pipeline', { mode, input: mode === 'full' ? 'Create notes bot' : prompt });
    let worker = 0;
    const submit = async (output: string) => {
      view = await call(client, 'pipeline_submit', { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: `${mode}-worker-${++worker}`, fresh_context: true, output });
    };
    if (mode === 'full') await submit(generated);
    await submit(judge(8));
    await submit(rewrite(mode === 'full' ? generated : prompt));
    await submit(judge(9));
    expect(view.status).toBe('completed');
    expect(view.final.approved).toBe(true);
    const result = await client.readResource({ uri: view.final.uri });
    expect(result.contents[0]).toHaveProperty('text', mode === 'full' ? generated : prompt);
    const status = await call(client, 'pipeline_status', { run_id: view.id });
    expect(status.history.map((h: any) => h.score)).toEqual([8, 9]);
    await expect(client.readResource({ uri: `promptzilla://runs/${view.id}/missing.md` })).rejects.toThrow();
  }
});

test('MCP controls support pause/resume, fixes and diff-only confirmation', async () => {
  const client = await connect();
  let view = await call(client, 'prompt_pipeline', { mode: 'optimize-only', input: prompt });
  view = await call(client, 'pipeline_pause', { run_id: view.id, reason: 'User must choose quote handling.' });
  expect(view.status).toBe('paused');
  view = await call(client, 'pipeline_resume', { run_id: view.id, decision: 'Keep original quotes verbatim.' });
  expect(view.dispatch.skill).toBe('judge-dredd');
  view = await call(client, 'pipeline_submit', { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: 'judge-1', fresh_context: true, output: judge(9) });
  view = await call(client, 'pipeline_apply_fixes', { run_id: view.id, fixes: [{ old: 'notes', new: 'meeting notes' }] });
  view = await call(client, 'pipeline_submit', { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: 'judge-2', fresh_context: true, output: '1. PASS — exact wording.' });
  expect(view.final.approved).toBe(true);
});
