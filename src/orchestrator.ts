import { exportRun, type ExportResult } from './export.js';
import type { Pipeline } from './pipeline.js';
import type { Dispatch, Run } from './state.js';
import type { Worker } from './workers/types.js';

export type OrchestratorEvent =
  | { type: 'start'; run: Run }
  | { type: 'dispatch'; run: Run; dispatch: Dispatch }
  | { type: 'submitted'; run: Run; dispatch: Dispatch; text: string }
  | { type: 'retry'; run: Run; error: string }
  | { type: 'paused'; run: Run }
  | { type: 'finished'; run: Run; exported?: ExportResult };

interface BaseOptions {
  pipeline: Pipeline;
  worker: Worker;
  outDir: string;
  name?: string;
  onEvent?: (event: OrchestratorEvent) => void;
  signal?: AbortSignal;
  maxStages?: number;
}

export interface ExecuteNewOptions extends BaseOptions {
  mode: 'full' | 'optimize-only';
  input: string;
  priorities?: string;
  resume?: undefined;
}

export interface ExecuteResumeOptions extends BaseOptions {
  resume: { runId: string; decision: string };
  mode?: undefined;
  input?: undefined;
  priorities?: undefined;
}

export type ExecuteOptions = ExecuteNewOptions | ExecuteResumeOptions;

export interface ExecuteResult {
  run: Run;
  exported?: ExportResult;
}

export async function executeRun(options: ExecuteOptions): Promise<ExecuteResult> {
  const emit = (event: OrchestratorEvent) => options.onEvent?.(event);
  const terminal = new Set(['completed', 'capped', 'blocked']);
  let run: Run;
  if (options.resume) {
    run = await options.pipeline.resume(options.resume.runId, options.resume.decision);
  } else {
    run = await options.pipeline.start({
      mode: options.mode,
      input: options.input,
      ...(options.priorities ? { priorities: options.priorities } : {}),
    });
  }
  emit({ type: 'start', run });

  const limit = options.maxStages ?? 16;
  for (let step = 0; step < limit; step += 1) {
    if (run.status === 'paused') {
      const exported = run.final ? await exportRun(run, options.outDir, options.name) : undefined;
      emit({ type: 'paused', run });
      return { run, ...(exported ? { exported } : {}) };
    }
    if (terminal.has(run.status)) {
      const exported = run.final ? await exportRun(run, options.outDir, options.name) : undefined;
      emit({ type: 'finished', run, ...(exported ? { exported } : {}) });
      return { run, ...(exported ? { exported } : {}) };
    }
    if (run.status === 'confirming') {
      emit({ type: 'paused', run });
      return { run };
    }

    const dispatch = run.dispatch;
    if (!dispatch) throw new Error(`Run ${run.id} is ${run.status} without an active dispatch.`);
    if (dispatch.validation_error) emit({ type: 'retry', run, error: dispatch.validation_error });
    emit({ type: 'dispatch', run, dispatch });

    try {
      const result = await options.worker.execute({
        run_id: run.id,
        skill: dispatch.skill,
        stage: dispatch.stage,
        instructions: dispatch.instructions,
        input: dispatch.input,
      }, options.signal ? { signal: options.signal } : {});
      run = await options.pipeline.submit({
        run_id: run.id,
        dispatch_id: dispatch.id,
        execution_id: result.execution_id,
        fresh_context: true,
        output: result.text,
      });
      emit({ type: 'submitted', run, dispatch, text: result.text });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : 'Worker failed.';
      try {
        run = await options.pipeline.pause(run.id, `Worker failed: ${message}`);
      } catch {
        // The run may already have advanced; surface the original failure.
        throw error;
      }
      emit({ type: 'paused', run });
      return { run };
    }
  }
  throw new Error(`Run ${run.id} exceeded ${limit} stages without reaching a terminal state.`);
}
