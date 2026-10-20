import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { ProcessWorker } from '../src/workers/adapters.js';
import { renderPrompt, type StageRequest } from '../src/workers/types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function shim(name: string, body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ninthpass-shim-'));
  roots.push(directory);
  const path = join(directory, name);
  await writeFile(path, body);
  await chmod(path, 0o755);
  return directory;
}

const request: StageRequest = {
  run_id: 'run',
  skill: 'judge',
  stage: 'judge',
  instructions: '# Judge',
  input: { prompt: 'Keep [TBD].' },
};

test('the Claude adapter sends the rendered packet and returns stdout', async () => {
  const directory = await shim('claude', '#!/bin/sh\n/bin/cat\n');
  const worker = new ProcessWorker('claude', { env: { PATH: directory } });
  const result = await worker.execute(request);
  expect(result.text).toBe(renderPrompt(request));
  expect(result.execution_id).toMatch(/^claude:/);
});

test('the Codex adapter sends the rendered packet over stdin', async () => {
  const directory = await shim('codex', '#!/bin/sh\n/bin/cat\n');
  const worker = new ProcessWorker('codex', { env: { PATH: directory } });
  const result = await worker.execute(request);
  expect(result.text).toBe(renderPrompt(request));
  expect(result.execution_id).toMatch(/^codex:/);
});

test('the OpenCode adapter reads text events and keeps the session ID', async () => {
  const directory = await shim('opencode', '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"text","sessionID":"ses_test","part":{"type":"text","text":"OK"}}\'\n');
  const worker = new ProcessWorker('opencode', { env: { PATH: directory } });
  const result = await worker.execute(request);
  expect(result).toEqual({ text: 'OK', execution_id: 'opencode:ses_test' });
});

test('a worker with no output or a missing binary fails clearly', async () => {
  const empty = await shim('claude', '#!/bin/sh\nexit 0\n');
  await expect(new ProcessWorker('claude', { env: { PATH: empty } }).execute(request)).rejects.toThrow(/returned no text/i);

  const missing = await shim('claude', '#!/bin/sh\nexit 0\n');
  const worker = new ProcessWorker('claude', { env: { PATH: missing } });
  await rm(join(missing, 'claude'));
  await expect(worker.execute(request)).rejects.toThrow(/not found/i);
});
