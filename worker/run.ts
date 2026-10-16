import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { PipelineEngine } from '../src/pipeline-engine.js';
import { FixSchema, StartSchema, SubmitSchema, type Run } from '../src/state.js';
import { OwnerSchema } from './auth.js';
import { catalog } from './catalog.js';
import { SqliteRunStore } from './sqlite-store.js';

export type Operation = 'start' | 'status' | 'submit' | 'pause' | 'resume' | 'fixes';
export type RpcResult = { ok: true; run: Run } | { ok: false; error: string };

export class PipelineRun extends DurableObject {
  async invoke(ownerInput: string, runId: string, operation: Operation, input: unknown): Promise<string> {
    try {
      const owner = OwnerSchema.parse(ownerInput);
      const id = z.uuid().parse(runId);
      const engine = new PipelineEngine(catalog, new SqliteRunStore(this.ctx.storage, owner, id), () => id);
      let run: Run;
      switch (operation) {
        case 'start': run = await engine.start(StartSchema.parse(input)); break;
        case 'status': run = await engine.status(id); break;
        case 'submit': {
          const args = SubmitSchema.parse(input);
          if (args.run_id !== id) throw new Error('Run identity mismatch.');
          run = await engine.submit(args);
          break;
        }
        case 'pause': run = await engine.pause(id, z.string().parse(input)); break;
        case 'resume': run = await engine.resume(id, z.string().parse(input)); break;
        case 'fixes': run = await engine.applyFixes(id, z.array(FixSchema).min(1).max(10).parse(input)); break;
        default: throw new Error('Unknown run operation.');
      }
      return JSON.stringify({ ok: true, run } satisfies RpcResult);
    } catch (error) { return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Run operation failed.' } satisfies RpcResult); }
  }
}
