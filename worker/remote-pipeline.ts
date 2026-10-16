import type { PipelineAPI } from '../src/mcp.js';
import type { Operation, PipelineRun, RpcResult } from './run.js';

export function remotePipeline(namespace: DurableObjectNamespace<PipelineRun>, owner: string): PipelineAPI {
  async function invoke(id: string, operation: Operation, input?: unknown) {
    const stub = namespace.get(namespace.idFromName(`${owner}:${id}`));
    const result: RpcResult = JSON.parse(await stub.invoke(owner, id, operation, input));
    if (!result.ok) throw new Error(result.error);
    return result.run;
  }
  return {
    start: args => invoke(crypto.randomUUID(), 'start', args),
    status: id => invoke(id, 'status'),
    submit: args => invoke(args.run_id, 'submit', args),
    pause: (id, reason) => invoke(id, 'pause', reason),
    resume: (id, decision) => invoke(id, 'resume', decision),
    applyFixes: (id, fixes) => invoke(id, 'fixes', fixes),
  };
}
