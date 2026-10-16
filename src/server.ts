import { Catalog } from './catalog.js';
import { Pipeline } from './pipeline.js';
import { createMcpServer } from './mcp.js';
export { VERSION, runView, createMcpServer } from './mcp.js';

export async function createServer(options: { skillsDir: string; runsDir: string }) {
  const catalog = await Catalog.load(options.skillsDir);
  const pipeline = new Pipeline(catalog, options.runsDir);
  return { server: createMcpServer(catalog, pipeline), catalog, pipeline };
}
