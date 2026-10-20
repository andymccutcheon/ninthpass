import { mkdtemp, readFile, rm, symlink, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Catalog } from '../src/catalog.js';
import { exportRun, slugify } from '../src/export.js';
import { Pipeline } from '../src/pipeline.js';
import { judge, prompt } from './fixtures.js';

let root: string;
let pipeline: Pipeline;
let serial = 0;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ninthpass-export-'));
  pipeline = new Pipeline(await Catalog.load(resolve('skills')), join(root, 'runs'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function submit(id: string, output: string) {
  const view = await pipeline.status(id);
  return pipeline.submit({ run_id: id, dispatch_id: view.dispatch!.id, execution_id: `worker-${++serial}`, fresh_context: true, output });
}

test('slugify produces a short safe filename from a request or prompt', () => {
  expect(slugify('Write a prompt for a meeting-notes summarizer')).toBe('write-a-prompt-for-a-meeting-notes-summarizer');
  expect(slugify('Write a prompt for a meeting-notes summarizer that')).toBe('write-a-prompt-for-a-meeting-notes-summarizer');
  expect(slugify('# Meeting notes\n\nSummarize.')).toBe('meeting-notes');
  expect(slugify('')).toBe('prompt');
  expect(slugify('!!!')).toBe('prompt');
  expect(slugify('a '.repeat(40)).length).toBeLessThanOrEqual(60);
});

test('approved STOP writes a clean Markdown prompt with no frontmatter', async () => {
  let run = await pipeline.start({ mode: 'optimize-only', input: prompt });
  run = await submit(run.id, judge(9));
  const exported = await exportRun(run, join(root, 'prompts'));
  expect(exported.approved).toBe(true);
  expect(exported.path).toMatch(/prompts\/you-summarize-notes-for-alex-morgan-keep-tbd\.md$/);
  expect(await readFile(exported.path, 'utf8')).toBe(prompt);
});

test('provisional exports are named as provisional and not marked approved', async () => {
  let run = await pipeline.start({ mode: 'optimize-only', input: prompt });
  run = await submit(run.id, judge(8));
  run = await submit(run.id, 'bad rewrite');
  run = await submit(run.id, 'still bad');
  expect(run.status).toBe('blocked');
  const exported = await exportRun(run, join(root, 'prompts'));
  expect(exported.approved).toBe(false);
  expect(exported.path.endsWith('.provisional.md')).toBe(true);
  expect(await readFile(exported.path, 'utf8')).toBe(prompt);
});

test('a second export of the same slug gets the run ID suffix', async () => {
  let run = await pipeline.start({ mode: 'optimize-only', input: prompt });
  run = await submit(run.id, judge(9));
  const first = await exportRun(run, join(root, 'prompts'));
  const second = await exportRun(run, join(root, 'prompts'));
  expect(second.path).not.toBe(first.path);
  expect(second.path).toContain(run.id.slice(0, 8));
});

test('refuses a missing final, a symlink output directory and a non-directory path', async () => {
  const run = await pipeline.start({ mode: 'full', input: 'notes bot' });
  await expect(exportRun(run, join(root, 'prompts'))).rejects.toThrow(/no final/i);

  let done = await pipeline.start({ mode: 'optimize-only', input: prompt });
  done = await submit(done.id, judge(9));
  const real = join(root, 'real');
  await mkdir(real);
  const link = join(root, 'link');
  await symlink(real, link);
  await expect(exportRun(done, link)).rejects.toThrow(/symlink/i);

  const file = join(root, 'file.txt');
  await writeFile(file, 'x');
  await expect(exportRun(done, file)).rejects.toThrow(/not a directory/i);
});

test('exports a confirmed fixed final after diff confirmation', async () => {
  let run = await pipeline.start({ mode: 'optimize-only', input: prompt });
  run = await submit(run.id, judge(9));
  run = await pipeline.applyFixes(run.id, [{ old: 'notes', new: 'meeting notes' }]);
  run = await submit(run.id, '1. PASS — exact replacement.');
  expect(run.status).toBe('completed');
  const exported = await exportRun(run, join(root, 'prompts'));
  expect(exported.approved).toBe(true);
  expect(await readFile(exported.path, 'utf8')).toContain('meeting notes');
  expect(await readFile(exported.path, 'utf8')).not.toContain('You summarize notes');
});
