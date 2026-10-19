import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { Catalog } from '../src/catalog.js';
import { Pipeline } from '../src/pipeline.js';
import { VERSION } from '../src/version.js';
import { runView } from '../src/view.js';

test('VERSION matches package.json', async () => {
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string };
  expect(VERSION).toBe(pkg.version);
});

test('runView reports files and dispatch data without transport URIs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promptzilla-view-'));
  try {
    const pipeline = new Pipeline(await Catalog.load(resolve('skills')), root);
    const run = await pipeline.start({ mode: 'optimize-only', input: 'Keep [TBD].' });
    const view = runView(run, join(root, run.id));
    expect(view.id).toBe(run.id);
    expect(view.run_dir).toBe(join(root, run.id));
    expect(view.dispatch?.stage).toBe('judge');
    expect(view.next_step).toContain('fresh worker');
    expect(JSON.stringify(view)).not.toContain('promptzilla://');

    const paused = await pipeline.pause(run.id, 'need a decision');
    expect(runView(paused).next_step).toContain('promptzilla resume');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
