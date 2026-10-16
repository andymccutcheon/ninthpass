#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer, VERSION } from './server.js';

async function main() {
  const { values } = parseArgs({ options: {
    'skills-dir': { type: 'string' }, 'runs-dir': { type: 'string' },
    help: { type: 'boolean' }, version: { type: 'boolean' }, validate: { type: 'boolean' },
  } });
  if (values.help) {
    process.stdout.write('Promptzilla MCP\nUsage: promptzilla [--skills-dir PATH] [--runs-dir PATH] [--validate]\n\nDefault transport: stdio. No API key required.\nDefaults: bundled skills; runs stored in ~/.promptzilla-mcp/runs.\nEnvironment: PROMPTZILLA_SKILLS_DIR, PROMPTZILLA_RUNS_DIR.\n--validate checks the skill catalog and exits. --version prints the version.\nRequires Node.js >=22.12.0.\n');
    return;
  }
  if (values.version) { process.stdout.write(`${VERSION}\n`); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major! < 22 || (major === 22 && minor! < 12)) throw new Error('Promptzilla requires Node.js >=22.12.0.');
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const { server, catalog } = await createServer({
    skillsDir: resolve(values['skills-dir'] ?? process.env.PROMPTZILLA_SKILLS_DIR ?? resolve(packageRoot, 'skills')),
    runsDir: resolve(values['runs-dir'] ?? process.env.PROMPTZILLA_RUNS_DIR ?? join(homedir(), '.promptzilla-mcp', 'runs')),
  });
  if (values.validate) { process.stdout.write(`Validated ${catalog.list().length} skills and ${catalog.assets.size} source assets.\n`); return; }
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.server.onclose = () => { process.exitCode = 0; };
  await server.connect(new StdioServerTransport());
}

main().catch(error => { process.stderr.write(`promptzilla: ${error instanceof Error ? error.message : 'Startup failed.'}\n`); process.exitCode = 1; });
