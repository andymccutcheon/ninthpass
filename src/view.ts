import type { Run } from './state.js';

export function runView(run: Run, runDir?: string) {
  return {
    id: run.id,
    mode: run.mode,
    status: run.status,
    created_at: run.created_at,
    ...(runDir ? { run_dir: runDir } : {}),
    ...(run.reason ? { reason: run.reason } : {}),
    history: run.history.map(({ score, verdict, file }) => ({ score, verdict, file })),
    artifacts: run.artifacts.map(({ name, kind }) => ({ name, kind })),
    ...(run.dispatch ? { dispatch: run.dispatch } : {}),
    ...(run.final ? { final: run.final } : {}),
    deferred: run.deferred,
    next_step: run.dispatch
      ? 'Execute dispatch.instructions with dispatch.input in a fresh worker, then submit its output with this dispatch ID, a unique execution ID and fresh_context=true.'
      : run.status === 'paused'
        ? 'Ask the user for a decision, then run `ninthpass resume <run-id> --decision "..."`.'
        : 'Show the final or provisional result, history, deferred recommendations and unresolved placeholders.',
  };
}
