import { FixtureWorker } from './fixture.js';
import { ProcessWorker, type ProcessWorkerConfig, type ProcessWorkerName } from './adapters.js';
import type { Worker } from './types.js';

export type WorkerName = ProcessWorkerName | 'fixture';

export const WORKER_NAMES: WorkerName[] = ['opencode', 'claude', 'codex', 'fixture'];

export function createWorker(name: WorkerName, config: ProcessWorkerConfig = {}): Worker {
  if (name === 'fixture') return new FixtureWorker();
  return new ProcessWorker(name, config);
}

export type { Worker, WorkerName as WorkerKind };
export { WorkerError } from './types.js';
export { buildCommand, parseOpenCode, ProcessWorker } from './adapters.js';
export { FixtureWorker } from './fixture.js';
