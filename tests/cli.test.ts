import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';

const exec = promisify(execFile);
const cli = resolve('dist/cli.js');
test('CLI validates package-relative skills from arbitrary cwd and supports help/version', async () => {
  expect((await exec(process.execPath, [cli, '--validate'], { cwd: tmpdir() })).stdout).toContain('Validated 5 skills and 9 source assets');
  expect((await exec(process.execPath, [cli, '--help'])).stdout).toContain('Usage:');
  expect((await exec(process.execPath, [cli, '--version'])).stdout).toBe('1.0.0\n');
});
test('CLI rejects bad flags and missing skills; explicit flags override env', async () => {
  await expect(exec(process.execPath, [cli, '--unknown'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('promptzilla-mcp:') });
  await expect(exec(process.execPath, [cli, '--validate'], { env: { ...process.env, PROMPTZILLA_SKILLS_DIR: '/does-not-exist' } })).rejects.toMatchObject({ code: 1 });
  expect((await exec(process.execPath, [cli, '--validate', '--skills-dir', resolve('skills')], { env: { ...process.env, PROMPTZILLA_SKILLS_DIR: '/does-not-exist' } })).stdout).toContain('Validated 5 skills');
});
