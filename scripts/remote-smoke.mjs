import assert from 'node:assert/strict';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = new URL(process.argv[2] ?? '');
if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/mcp') throw new Error('Provide the HTTPS /mcp endpoint.');
const credential = JSON.parse(await readFile(resolve('.secrets/client-credential.json'), 'utf8'));
const headers = { Authorization: `Bearer ${credential.token}` };
assert.equal((await fetch(new URL('/health', endpoint))).status, 200);
assert.equal((await fetch(endpoint)).status, 401);
assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
const client = new Client({ name: 'promptzilla-live-deployment-verification', version: '1.0.0' });
const results = [];
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, `${name} failed`);
  return result.structuredContent;
}
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }));
  assert.equal((await client.listTools()).tools.length, 13);
  assert.equal((await client.listPrompts()).prompts.length, 5);
  assert.equal((await call('list_skills')).skills.length, 5);
  const catalog = await client.readResource({ uri: 'promptzilla://catalog' });
  assert.equal(JSON.parse(catalog.contents[0].text).assets.length, 9);
  const source = await client.readResource({ uri: 'promptzilla://skills/metapod' });
  assert.match(source.contents[0].text, /name: metapod/);
  const { generated, prompt, judge, rewrite } = await import('../tests/fixtures.ts');
  for (const mode of ['full', 'optimize-only']) {
    let view = await call('prompt_pipeline', { mode, input: mode === 'full' ? 'Verification fixture: meeting notes bot' : prompt, priorities: 'Deployment verification using authored fixtures, not a live model evaluation.' });
    let sequence = 0;
    const submit = async output => {
      view = await call('pipeline_submit', { run_id: view.id, dispatch_id: view.dispatch.id, execution_id: `deployment-fixture-${mode}-${++sequence}`, fresh_context: true, output });
    };
    if (mode === 'full') await submit(generated);
    await submit(judge(8));
    await submit(rewrite(prompt));
    await submit(judge(9));
    assert.equal(view.status, 'completed');
    assert.equal(view.final.approved, true);
    assert.equal((await client.readResource({ uri: view.final.uri })).contents[0].text, prompt);
    results.push({ mode, run_id: view.id, status: view.status, scores: view.history.map(h => h.score) });
  }
} finally { await client.close(); }

// Reconnect with a new HTTP client to prove state is independent of MCP sessions.
const second = new Client({ name: 'promptzilla-live-reconnect', version: '1.0.0' });
try {
  await second.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }));
  for (const result of results) {
    const response = await second.callTool({ name: 'pipeline_status', arguments: { run_id: result.run_id } });
    assert.equal(response.structuredContent.status, 'completed');
  }
} finally { await second.close(); }
const configFile = resolve('.secrets/remote-mcp.json');
await writeFile(configFile, JSON.stringify({ mcpServers: { promptzilla: { type: 'http', url: endpoint.href, headers } } }, null, 2) + '\n', { mode: 0o600 });
await chmod(configFile, 0o600);
await writeFile(resolve('.secrets/deployment-verification.json'), JSON.stringify({ endpoint: endpoint.href, verified_at: new Date().toISOString(), fixture_runs: results }, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(`Live verification PASS: private endpoint, 13 tools, 5 prompts, 9 assets, both pipeline modes, exact artifact bytes, and session-independent state.\nEndpoint: ${endpoint.href}\nPrivate ready-to-use client configuration: .secrets/remote-mcp.json\n`);
