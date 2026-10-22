import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { judge, prompt } from './fixtures.js';

const exec = promisify(execFile);
const cli = resolve('dist/cli.js');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temp() { const path = await mkdtemp(join(tmpdir(), 'silverquill-cli-')); roots.push(path); return path; }
function run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return exec(process.execPath, [cli, ...args], { cwd: options.cwd ?? tmpdir(), ...(options.env ? { env: options.env } : {}) });
}

test('help, version, validate and list work from an arbitrary directory', async () => {
  expect((await run(['--help'])).stdout).toContain('Usage: silverquill <command>');
  expect((await run(['--version'])).stdout).toBe('2.0.0\n');
  expect((await run(['validate'])).stdout).toContain('Validated 5 skills and 9 source assets');
  expect((await run(['--validate'])).stdout).toContain('Validated 5 skills');
  const list = JSON.parse((await run(['list', '--json'])).stdout);
  expect(list.skills.map((skill: { name: string }) => skill.name)).toEqual(['brief', 'compose', 'judge', 'loop', 'revise']);
});

test('install copies the skills and dry-run writes nothing', async () => {
  const directory = join(await temp(), 'skills');
  expect((await run(['install', '--dir', directory])).stdout).toContain('Installed 5 skills');
  expect(await readFile(join(directory, 'compose', 'SKILL.md'), 'utf8')).toContain('# Compose');
  const dry = join(await temp(), 'dry');
  expect((await run(['install', '--dir', dry, '--dry-run'])).stdout).toContain('Would install 5 skills');
});

test('run with the fixture worker completes, exports Markdown and is inspectable', async () => {
  const root = await temp();
  const runs = join(root, 'runs');
  const out = join(root, 'prompts');
  const completed = await run(['run', '--request', 'Build a meeting-notes bot', '--worker', 'fixture', '--out', out, '--runs-dir', runs, '--json']);
  const result = JSON.parse(completed.stdout);
  expect(result.status).toBe('completed');
  expect(result.exported.approved).toBe(true);
  expect(await readFile(result.exported.path, 'utf8')).toContain('=== SYSTEM PROMPT ===');

  const status = JSON.parse((await run(['status', result.id, '--runs-dir', runs, '--json'])).stdout);
  expect(status.status).toBe('completed');
  expect(status.history.map((entry: { score: number }) => entry.score)).toEqual([8, 9]);

  const redirected = join(root, 'again');
  const exported = JSON.parse((await run(['export', result.id, '--out', redirected, '--runs-dir', runs, '--json'])).stdout);
  expect(exported.path.startsWith(redirected)).toBe(true);
});

test('run --resume continues a paused run with the chosen worker', async () => {
  const root = await temp();
  const runs = join(root, 'runs');
  const promptFile = join(root, 'prompt.md');
  await writeFile(promptFile, prompt);
  const started = JSON.parse((await run(['start', '--prompt', promptFile, '--runs-dir', runs, '--json'])).stdout);
  await run(['pause', started.id, '--reason', 'test pause', '--runs-dir', runs, '--json']);
  const resumed = JSON.parse((await run([
    'run', '--resume', started.id, '--decision', 'Continue.', '--worker', 'fixture',
    '--out', join(root, 'out'), '--runs-dir', runs, '--json',
  ])).stdout);
  expect(resumed.status).toBe('completed');
  expect(resumed.exported.approved).toBe(true);
});

test('test runs the whole pipeline with the fixture and reports pass', async () => {
  const root = await temp();
  const result = JSON.parse((await run(['test', '--out', join(root, 'prompts'), '--runs-dir', join(root, 'runs'), '--json'])).stdout);
  expect(result.passed).toBe(true);
  expect(result.scores.map((entry: { score: number }) => entry.score)).toEqual([8, 9]);
});

test('manual start, pause, resume and submit are reachable from the CLI', async () => {
  const root = await temp();
  const runs = join(root, 'runs');
  const promptFile = join(root, 'prompt.md');
  await writeFile(promptFile, prompt);
  const started = JSON.parse((await run(['start', '--prompt', promptFile, '--runs-dir', runs, '--json'])).stdout);
  expect(started.dispatch.stage).toBe('judge');

  const paused = JSON.parse((await run(['pause', started.id, '--reason', 'need a decision', '--runs-dir', runs, '--json'])).stdout);
  expect(paused.status).toBe('paused');
  const resumed = JSON.parse((await run(['resume', started.id, '--decision', 'continue', '--runs-dir', runs, '--json'])).stdout);
  expect(resumed.status).toBe('running');
  expect(resumed.dispatch.stage).toBe('judge');

  const output = join(root, 'judge.md');
  await writeFile(output, judge(9));
  const submitted = JSON.parse((await run(['submit', started.id, '--dispatch', resumed.dispatch.id, '--output', output, '--runs-dir', runs, '--json'])).stdout);
  expect(submitted.status).toBe('completed');
  expect(submitted.final.approved).toBe(true);
});

test('fix applies an authorized Judge replacement and asks for diff confirmation', async () => {
  const root = await temp();
  const runs = join(root, 'runs');
  const promptFile = join(root, 'prompt.md');
  await writeFile(promptFile, prompt);
  const started = JSON.parse((await run(['start', '--prompt', promptFile, '--runs-dir', runs, '--json'])).stdout);

  const stop = 'Section Ratings\n- Clarity: 8.5/10 — contains "notes".\n- Structure: 9/10 — the sections are present.\n- Delivery: 9.5/10 — the gate is stated.\n\nOverall Rating: 9.00/10 — the mean of the section ratings.\n\nVerdict: STOP\n\nRecommendations\n1. Replace "notes" → "meeting notes".\n';
  const scoreFile = join(root, 'score.md');
  await writeFile(scoreFile, stop);
  const completed = JSON.parse((await run(['submit', started.id, '--dispatch', started.dispatch.id, '--output', scoreFile, '--runs-dir', runs, '--json'])).stdout);
  expect(completed.status).toBe('completed');

  const fixed = JSON.parse((await run(['fix', started.id, '--old', 'notes', '--new', 'meeting notes', '--runs-dir', runs, '--json'])).stdout);
  expect(fixed.status).toBe('confirming');
  expect(fixed.dispatch.stage).toBe('confirm');

  const confirmation = join(root, 'confirmation.md');
  await writeFile(confirmation, '1. PASS — exact replacement.\n');
  const confirmed = JSON.parse((await run(['submit', started.id, '--dispatch', fixed.dispatch.id, '--output', confirmation, '--runs-dir', runs, '--json'])).stdout);
  expect(confirmed.status).toBe('completed');
  expect(confirmed.final.approved).toBe(true);
});

test('bad flags, missing input and a missing catalog fail with a clear message', async () => {
  await expect(run(['--unknown'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('silverquill:') });
  await expect(run(['run'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Supply --request') });
  await expect(run(['validate'], { env: { ...process.env, SILVERQUILL_SKILLS_DIR: '/does-not-exist' } })).rejects.toMatchObject({ code: 1 });
  await expect(run(['install', '--target', 'nope'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Unknown install target') });
});
