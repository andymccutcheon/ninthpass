import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Catalog } from '../src/catalog.js';
import { Pipeline } from '../src/pipeline.js';
import { generated, judge, prompt, rewrite } from './fixtures.js';

let root: string;
let pipeline: Pipeline;
let serial = 0;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'promptzilla-runs-')); pipeline = new Pipeline(await Catalog.load(resolve('skills')), root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function submit(id: string, output: string, executionId = `worker-${++serial}`) {
  const view = await pipeline.status(id);
  return pipeline.submit({ run_id: id, dispatch_id: view.dispatch!.id, execution_id: executionId, fresh_context: true, output });
}

test('optimize-only STOP exports scored input byte-for-byte and survives restart', async () => {
  const start = await pipeline.start({ mode: 'optimize-only', input: prompt });
  expect(start.dispatch?.skill).toBe('judge');
  const end = await submit(start.id, judge(9));
  expect(end.status).toBe('completed');
  expect(end.final?.approved).toBe(true);
  expect(await readFile(join(root, end.id, '00-original.md'), 'utf8')).toBe(prompt);
  expect(await readFile(join(root, end.id, '05-final.md'), 'utf8')).toBe(prompt);
  const restarted = new Pipeline(await Catalog.load(resolve('skills')), root);
  expect((await restarted.status(end.id)).final).toEqual(end.final);
  await expect(submit(end.id, judge(9))).rejects.toThrow();
});

test('full workflow isolates Judge from checklist, carries deferred items and latest BODY', async () => {
  let v = await pipeline.start({ mode: 'full', input: 'Build a meeting notes bot', priorities: 'Keep placeholders' });
  expect(v.dispatch?.skill).toBe('compose');
  v = await submit(v.id, generated);
  v = await submit(v.id, judge(7));
  expect(v.dispatch?.instructions).toContain('15%');
  const body = generated.replace('Summarize notes.', 'Summarize meeting notes.');
  v = await submit(v.id, rewrite(body, true));
  expect(v.dispatch?.input.prompt).toBe(body);
  expect(v.dispatch?.input.prompt).not.toContain('Rec-application checklist');
  expect(v.dispatch?.input.deferred).toContain('needs user choice');
  v = await submit(v.id, judge(8));
  expect(v.dispatch?.input.prompt).toBe(body);
  v = await submit(v.id, rewrite(body + '\nKeep [TBD].'));
  v = await submit(v.id, judge(9));
  expect(v.history.map(h => h.score)).toEqual([7, 8, 9]);
  expect(v.final?.text).toBe(body + '\nKeep [TBD].');
});

test('caps after four rounds, exports best scored candidate as provisional', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  for (const score of [5, 6, 7, 8]) {
    v = await submit(v.id, judge(score));
    if (score !== 8) v = await submit(v.id, rewrite(`${prompt}Round ${score}`));
  }
  expect(v.status).toBe('capped');
  expect(v.final?.approved).toBe(false);
  expect(v.history).toHaveLength(4);
  await expect(pipeline.resume(v.id, 'continue')).rejects.toThrow();
});

test('pauses after two non-improving rewrites and requires explicit decision', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  v = await submit(v.id, judge(8));
  v = await submit(v.id, rewrite(prompt));
  v = await submit(v.id, judge(8));
  expect(v.status).toBe('running');
  v = await submit(v.id, rewrite(prompt));
  v = await submit(v.id, judge(7));
  expect(v.status).toBe('paused');
  expect(v.dispatch).toBeUndefined();
  expect(v.final?.approved).toBe(false);
  expect(v.final?.file).toBe('05-provisional.md');
  expect(v.reason).toContain('did not improve');
  await expect(pipeline.resume(v.id, '')).rejects.toThrow();
  v = await pipeline.resume(v.id, 'Continue despite plateau; preserve [TBD].');
  expect(v.dispatch?.input.user_decisions).toContain('Continue despite plateau');
  v = await submit(v.id, rewrite(prompt));
  v = await submit(v.id, judge(9));
  expect(v.status).toBe('completed');
});

test('a resumed plateau that caps writes a second, uniquely named provisional', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  v = await submit(v.id, judge(8));
  v = await submit(v.id, rewrite(prompt));
  v = await submit(v.id, judge(8));
  v = await submit(v.id, rewrite(prompt));
  v = await submit(v.id, judge(8));
  expect(v.status).toBe('paused');
  expect(v.final?.file).toBe('05-provisional.md');
  v = await pipeline.resume(v.id, 'Continue one more round.');
  v = await submit(v.id, rewrite(prompt));
  v = await submit(v.id, judge(7));
  expect(v.status).toBe('capped');
  expect(v.final?.file).toBe('05-provisional-2.md');
  expect(v.final?.approved).toBe(false);
});

test('malformed stages retry once then block and retain previous candidate', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  v = await submit(v.id, judge(8));
  const firstDispatch = v.dispatch!.id;
  v = await submit(v.id, 'missing BODY');
  expect(v.dispatch?.id).not.toBe(firstDispatch);
  expect(v.dispatch?.validation_error).toMatch(/marker/i);
  v = await submit(v.id, 'still missing BODY');
  expect(v.status).toBe('blocked');
  expect(v.final?.text).toBe(prompt);
  expect(v.final?.approved).toBe(false);
  expect(v.artifacts.filter(a => a.kind === 'rejected')).toHaveLength(2);
});

test('rejects stale dispatches, reused workers, false isolation and concurrent submissions', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  const args = { run_id: v.id, dispatch_id: v.dispatch!.id, execution_id: 'same-worker', fresh_context: true, output: judge(8) };
  await expect(pipeline.submit({ ...args, fresh_context: false })).rejects.toThrow(/fresh/i);
  const results = await Promise.allSettled([pipeline.submit(args), pipeline.submit(args)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  v = await pipeline.status(v.id);
  await expect(pipeline.submit(args)).rejects.toThrow();
  await expect(submit(v.id, rewrite(prompt), 'same-worker')).rejects.toThrow(/execution/i);
});

test('STOP fixes require Judge-authorized pairs and fresh diff-only confirmation', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  v = await submit(v.id, judge(9));
  await expect(pipeline.applyFixes(v.id, [{ old: 'Alex', new: 'Bob' }])).rejects.toThrow(/Judge/i);
  await expect(pipeline.applyFixes(v.id, [{ old: 'note', new: 'meeting' }])).rejects.toThrow(/Judge/i);
  v = await pipeline.applyFixes(v.id, [{ old: 'notes', new: 'meeting notes' }]);
  expect(v.final?.approved).toBe(false);
  expect(v.dispatch?.input).not.toHaveProperty('prompt');
  expect(v.dispatch?.input.replacements).toEqual([{ old: 'notes', new: 'meeting notes' }]);
  expect(await readFile(join(root, v.id, '05-final.md'), 'utf8')).toBe(prompt);
  v = await submit(v.id, '1. PASS — exact replacement, no drift.');
  expect(v.status).toBe('completed');
  expect(v.final?.approved).toBe(true);
  expect(v.final?.text).toContain('meeting notes');
});

test('confirmation retries twice without re-approving or replacing historical final', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  v = await submit(v.id, judge(9));
  v = await pipeline.applyFixes(v.id, [{ old: 'notes', new: 'meeting notes' }]);
  v = await submit(v.id, 'bad confirmation');
  expect(v.status).toBe('confirming');
  v = await submit(v.id, 'still bad');
  expect(v.status).toBe('blocked');
  expect(v.final?.approved).toBe(false);
  expect(await readFile(join(root, v.id, '05-final.md'), 'utf8')).toBe(prompt);
});

test('user pause preserves a stage and its retry budget, pins skill sources', async () => {
  let v = await pipeline.start({ mode: 'full', input: 'notes bot' });
  const instructions = v.dispatch!.instructions;
  v = await submit(v.id, 'bad generation');
  const dispatch = v.dispatch!.id;
  v = await pipeline.pause(v.id, 'Need a new isolated worker');
  expect(v.status).toBe('paused');
  await expect(pipeline.pause(v.id, 'again')).rejects.toThrow();
  v = await pipeline.resume(v.id, 'Fresh worker available');
  expect(v.dispatch?.attempt).toBe(1);
  expect(v.dispatch?.stage).toBe('generate');
  expect(v.dispatch?.id).not.toBe(dispatch);
  expect(v.dispatch?.instructions).toBe(instructions);
  v = await submit(v.id, generated);
  expect(v.history).toHaveLength(0);
  expect(v.dispatch?.stage).toBe('judge');
});

test('failed confirmation blocks approval', async () => {
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  v = await submit(v.id, judge(9));
  v = await pipeline.applyFixes(v.id, [{ old: 'notes', new: 'meeting notes' }]);
  v = await submit(v.id, '1. FAIL — wording differs.');
  expect(v.status).toBe('blocked');
  expect(v.final?.approved).toBe(false);
});

test('bounds input, rejects traversal/symlinks and detects tampered artifacts', async () => {
  await expect(pipeline.status('../secrets')).rejects.toThrow();
  await expect(pipeline.start({ mode: 'full', input: '' })).rejects.toThrow();
  await expect(pipeline.start({ mode: 'full', input: 'x'.repeat(300000) })).rejects.toThrow();
  let v = await pipeline.start({ mode: 'optimize-only', input: prompt });
  await rm(join(root, v.id, '00-original.md'));
  await pipeline.status(v.id);
  expect(await readFile(join(root, v.id, '00-original.md'), 'utf8')).toBe(prompt);
  await writeFile(join(root, v.id, '00-original.md'), 'tampered');
  await expect(pipeline.status(v.id)).rejects.toThrow(/modified/i);
  await rm(join(root, v.id, '00-original.md'));
  await symlink('/etc/passwd', join(root, v.id, '00-original.md'));
  await expect(pipeline.status(v.id)).rejects.toThrow(/symlink/i);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await symlink(root, join(root, id));
  await expect(pipeline.status(id)).rejects.toThrow(/symlink/i);
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await mkdir(join(root, other));
  await symlink('/etc/passwd', join(root, other, 'run.json'));
  await expect(pipeline.status(other)).rejects.toThrow(/symlink/i);
});
