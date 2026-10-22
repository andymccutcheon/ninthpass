import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { detectTargets, installSkills, targetDirectory } from '../src/install.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temp() { const path = await mkdtemp(join(tmpdir(), 'silverquill-install-')); roots.push(path); return path; }

test('maps targets to the standard user skill directories', () => {
  expect(targetDirectory('claude', '/home/andy')).toBe('/home/andy/.claude/skills');
  expect(targetDirectory('opencode', '/home/andy')).toBe('/home/andy/.config/opencode/skills');
  expect(targetDirectory('agents', '/home/andy')).toBe('/home/andy/.agents/skills');
});

test('detects installed agent hosts and falls back to Claude', async () => {
  const home = await temp();
  await mkdir(join(home, '.claude'));
  expect(await detectTargets(home)).toEqual(['claude']);
  await mkdir(join(home, '.config', 'opencode'), { recursive: true });
  await mkdir(join(home, '.agents'));
  expect(await detectTargets(home)).toEqual(['claude', 'opencode', 'agents']);
  const empty = await temp();
  expect(await detectTargets(empty)).toEqual(['claude']);
});

test('installs every bundled skill, removes legacy skill folders, and copies supporting files', async () => {
  const directory = join(await temp(), 'skills');
  await mkdir(join(directory, 'tasker'), { recursive: true });
  await writeFile(join(directory, 'tasker', 'SKILL.md'), 'legacy');
  const results = await installSkills({ directory });
  expect(results).toHaveLength(1);
  expect(results[0]!.skills).toEqual(['brief', 'compose', 'judge', 'loop', 'revise']);
  expect((await lstat(join(directory, 'compose', 'SKILL.md'))).isFile()).toBe(true);
  expect(await readFile(join(directory, 'loop', 'scripts', 'stage_control.py'), 'utf8')).toContain('def ');
  expect((await lstat(join(directory, 'loop', 'DRY-RUN.md'))).isFile()).toBe(true);
  await expect(lstat(join(directory, 'tasker'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('dry run reports the plan without writing', async () => {
  const directory = join(await temp(), 'skills');
  const results = await installSkills({ directory, dryRun: true });
  expect(results[0]!.dry_run).toBe(true);
  await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('installs to multiple detected hosts', async () => {
  const home = await temp();
  await mkdir(join(home, '.claude'));
  await mkdir(join(home, '.config', 'opencode'), { recursive: true });
  const results = await installSkills({ home });
  expect(results.map(result => result.target)).toEqual(['claude', 'opencode']);
  for (const result of results) {
    expect((await lstat(join(result.directory, 'judge', 'SKILL.md'))).isFile()).toBe(true);
  }
});

test('rejects an empty or symlinked skill source', async () => {
  const empty = await temp();
  await expect(installSkills({ skillsDir: empty, directory: join(empty, 'out') })).rejects.toThrow(/No skills/);

  const source = await temp();
  const target = await temp();
  await writeFile(join(target, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\nBody\n');
  await symlink(target, join(source, 'demo'));
  await expect(installSkills({ skillsDir: source, directory: join(source, 'out') })).rejects.toThrow(/symlink/i);
});
