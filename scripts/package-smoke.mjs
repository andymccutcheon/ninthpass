import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const exec = promisify(execFile);
const sandbox = await mkdtemp(join(tmpdir(), 'promptzilla-package-'));
let client;
try {
  const packed = await exec('npm', ['pack', '--json', '--pack-destination', sandbox], { cwd: resolve('.') });
  const pkg = JSON.parse(packed.stdout)[0];
  assert.equal(pkg.files.filter(f => f.path.startsWith('skills/')).length, 9);
  assert(!pkg.files.some(f => f.path.endsWith('.pyc') || f.path.startsWith('runs/')));
  await exec('npm', ['install', '--prefix', sandbox, join(sandbox, pkg.filename), '--ignore-scripts', '--no-audit', '--no-fund']);
  const cli = join(sandbox, 'node_modules/promptzilla/dist/cli.js');
  assert.match((await exec(join(sandbox, 'node_modules/.bin/promptzilla'), ['--validate'], { cwd: sandbox })).stdout, /Validated 5 skills/);
  assert.match((await exec(process.execPath, [cli, '--validate'], { cwd: sandbox })).stdout, /Validated 5 skills and 9 source assets/);
  client = new Client({ name: 'installed-package-smoke', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, '--runs-dir', join(sandbox, 'runs')], cwd: sandbox, stderr: 'pipe' }));
  assert.equal((await client.listPrompts()).prompts.length, 5);
  assert.equal((await client.listTools()).tools.length, 13);
  let response = await client.callTool({ name: 'prompt_pipeline', arguments: { mode: 'optimize-only', input: 'Keep [TBD].\r\n' } });
  assert(!response.isError);
  const run = response.structuredContent;
  response = await client.callTool({ name: 'pipeline_submit', arguments: {
    run_id: run.id, dispatch_id: run.dispatch.id, execution_id: 'package-fixture-judge', fresh_context: true,
    output: 'Section Ratings\n- Clarity: 9/10 — contains "[TBD]".\nOverall Rating: 9/10 — fixture.\nVerdict: STOP\nRecommendations\nNo required fixes.\n',
  } });
  assert(!response.isError);
  assert.equal(response.structuredContent.final.approved, true);
  const artifact = await client.readResource({ uri: response.structuredContent.final.uri });
  assert.equal(artifact.contents[0].text, 'Keep [TBD].\r\n');
  process.stdout.write('Installed-package smoke PASS: 9 bundled assets, 5 prompts, 13 tools, real stdio run, byte-exact final artifact.\n');
} finally {
  await client?.close();
  await rm(sandbox, { recursive: true, force: true });
}
