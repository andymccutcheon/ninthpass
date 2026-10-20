import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Catalog } from '../src/catalog.js';
import { executeRun } from '../src/orchestrator.js';
import { Pipeline } from '../src/pipeline.js';
import { FixtureWorker } from '../src/workers/fixture.js';
import type { StageRequest, StageResult, Worker } from '../src/workers/types.js';
import { judge, prompt, rewrite } from './fixtures.js';

let root: string;
let pipeline: Pipeline;
let serial = 0;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ninthpass-orchestrator-'));
  pipeline = new Pipeline(await Catalog.load(resolve('skills')), join(root, 'runs'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

class ScriptedWorker implements Worker {
  readonly name = 'scripted';
  calls = 0;
  constructor(private readonly output: (request: StageRequest, call: number) => string) {}
  async execute(request: StageRequest): Promise<StageResult> {
    const call = this.calls++;
    return { text: this.output(request, call), execution_id: `scripted-${++serial}` };
  }
}

test('full pipeline runs Compose, Judge and Revise to an approved STOP export', async () => {
  const result = await executeRun({
    pipeline,
    worker: new FixtureWorker(),
    mode: 'full',
    input: 'Build a meeting-notes bot',
    outDir: join(root, 'prompts'),
  });
  expect(result.run.status).toBe('completed');
  expect(result.run.history.map(entry => entry.score)).toEqual([8, 9]);
  expect(result.run.final?.approved).toBe(true);
  expect(result.exported?.approved).toBe(true);
  expect(await readFile(result.exported!.path, 'utf8')).toContain('=== SYSTEM PROMPT ===');
});

test('optimize-only pipeline keeps the user prompt byte-for-byte on STOP', async () => {
  const result = await executeRun({
    pipeline,
    worker: new FixtureWorker(),
    mode: 'optimize-only',
    input: prompt,
    outDir: join(root, 'prompts'),
    name: 'kept-original',
  });
  expect(result.run.status).toBe('completed');
  expect(result.exported?.path).toMatch(/kept-original\.md$/);
  expect(await readFile(result.exported!.path, 'utf8')).toBe(prompt);
});

test('emits stage events and reports the final result', async () => {
  const events: string[] = [];
  const result = await executeRun({
    pipeline,
    worker: new FixtureWorker(),
    mode: 'full',
    input: 'notes bot',
    outDir: join(root, 'prompts'),
    onEvent: event => events.push(event.type),
  });
  expect(events[0]).toBe('start');
  expect(events).toContain('dispatch');
  expect(events).toContain('submitted');
  expect(events.at(-1)).toBe('finished');
  expect(result.run.status).toBe('completed');
});

test('a worker failure pauses the run instead of losing it', async () => {
  const worker: Worker = {
    name: 'broken',
    async execute() { throw new Error('model unavailable'); },
  };
  const result = await executeRun({
    pipeline,
    worker,
    mode: 'optimize-only',
    input: prompt,
    outDir: join(root, 'prompts'),
  });
  expect(result.run.status).toBe('paused');
  expect(result.run.reason).toContain('model unavailable');
  expect(result.exported).toBeUndefined();
});

test('a plateau pause still exports the best candidate provisionally', async () => {
  const worker = new ScriptedWorker(request => request.stage === 'judge' ? judge(8) : rewrite(prompt));
  const result = await executeRun({
    pipeline,
    worker,
    mode: 'optimize-only',
    input: prompt,
    outDir: join(root, 'prompts'),
  });
  expect(result.run.status).toBe('paused');
  expect(result.run.final?.approved).toBe(false);
  expect(result.exported?.approved).toBe(false);
  expect(result.exported?.path.endsWith('.provisional.md')).toBe(true);
});

test('two invalid stage outputs block the run and keep the best scored candidate', async () => {
  const worker = new ScriptedWorker(request => {
    if (request.stage === 'judge') return judge(8);
    return 'missing BODY markers';
  });
  const result = await executeRun({
    pipeline,
    worker,
    mode: 'optimize-only',
    input: prompt,
    outDir: join(root, 'prompts'),
  });
  expect(result.run.status).toBe('blocked');
  expect(result.run.final?.approved).toBe(false);
  expect(result.exported?.approved).toBe(false);
  expect(result.exported?.path.endsWith('.provisional.md')).toBe(true);
});

test('a valid rewrite advances without reusing a worker context', async () => {
  const scores = [5, 6, 7, 8];
  let judgeCalls = 0;
  const worker = new ScriptedWorker(request => request.stage === 'judge' ? judge(scores[judgeCalls++]!) : rewrite(prompt));
  const events: string[] = [];
  const result = await executeRun({
    pipeline,
    worker,
    mode: 'optimize-only',
    input: prompt,
    outDir: join(root, 'prompts'),
    onEvent: event => events.push(event.type),
  });
  expect(events.filter(type => type === 'retry')).toHaveLength(0);
  expect(result.run.status).toBe('capped');
  expect(result.run.history).toHaveLength(4);
  expect(new Set(result.run.provenance.map(entry => entry.execution_id)).size).toBe(result.run.provenance.length);
});

test('refuses to exceed the stage budget', async () => {
  await expect(executeRun({
    pipeline,
    worker: new FixtureWorker(),
    mode: 'full',
    input: 'notes bot',
    outDir: join(root, 'prompts'),
    maxStages: 0,
  })).rejects.toThrow(/exceeded 0 stages/i);
});
