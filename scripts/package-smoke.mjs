import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const sandbox = await mkdtemp(join(tmpdir(), 'ninthpass-package-'));
try {
  const packed = await exec('npm', ['pack', '--json', '--pack-destination', sandbox], { cwd: resolve('.') });
  const pkg = JSON.parse(packed.stdout)[0];
  const skills = pkg.files.filter(file => file.path.startsWith('skills/'));
  assert.equal(skills.length, 9, 'the package should carry five skills plus four supporting assets');
  assert(!pkg.files.some(file => file.path.endsWith('.pyc') || file.path.startsWith('runs/') || file.path.startsWith('worker/')));

  await exec('npm', ['install', '--prefix', sandbox, join(sandbox, pkg.filename), '--ignore-scripts', '--no-audit', '--no-fund']);
  const bin = join(sandbox, 'node_modules', '.bin', 'ninthpass');

  assert.match((await exec(bin, ['--version'])).stdout, /^2\.0\.0/);
  assert.match((await exec(bin, ['validate'], { cwd: sandbox })).stdout, /Validated 5 skills and 9 source assets/);

  const installed = join(sandbox, 'installed-skills');
  assert.match((await exec(bin, ['install', '--dir', installed], { cwd: sandbox })).stdout, /Installed 5 skills/);
  assert((await lstat(join(installed, 'compose', 'SKILL.md'))).isFile());
  assert((await lstat(join(installed, 'loop', 'scripts', 'stage_control.py'))).isFile());

  const out = join(sandbox, 'prompts');
  const runs = join(sandbox, 'runs');
  const completed = await exec(bin, [
    'run', '--request', 'Build a meeting-notes bot', '--worker', 'fixture',
    '--out', out, '--runs-dir', runs, '--json',
  ], { cwd: sandbox });
  const result = JSON.parse(completed.stdout);
  assert.equal(result.status, 'completed');
  assert.equal(result.exported.approved, true);
  assert.match(await readFile(result.exported.path, 'utf8'), /=== SYSTEM PROMPT ===/);

  process.stdout.write('Installed-package smoke PASS: 9 bundled assets, 5 installed skills, fixture pipeline completed and exported.\n');
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
