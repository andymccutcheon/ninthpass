import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpServer, VERSION } from '../src/mcp.js';
import { authenticate } from './auth.js';
import { catalog } from './catalog.js';
import { remotePipeline } from './remote-pipeline.js';
import type { PipelineRun } from './run.js';
export { PipelineRun } from './run.js';

export interface Env {
  PIPELINE_RUNS: DurableObjectNamespace<PipelineRun>;
  PROMPTZILLA_CLIENTS?: string;
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return privateResponse(Response.json({ status: 'ok', service: 'promptzilla', version: VERSION }));
    if (url.pathname !== '/mcp') return privateResponse(new Response('Not found', { status: 404 }));
    const owner = await authenticate(request, env.PROMPTZILLA_CLIENTS);
    if (owner instanceof Response) return privateResponse(owner);
    // Reject cross-origin browser use; CLI/MCP clients normally omit Origin.
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return privateResponse(new Response('Origin not allowed', { status: 403 }));
    const pipeline = remotePipeline(env.PIPELINE_RUNS, owner);
    const handler = createMcpHandler(() => createMcpServer(catalog, pipeline), { responseMode: 'json', maxRequestBodySize: 4_194_304 });
    try { return privateResponse(await handler.fetch(request)); }
    catch { return privateResponse(Response.json({ error: 'MCP request failed.' }, { status: 500 })); }
    finally { await handler.close(); }
  },
};
