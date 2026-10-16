import { RunSchema, type Run } from './state.js';

export interface RunStore {
  create(run: Run): Promise<void>;
  read(id: string): Promise<Run>;
  update<T>(id: string, work: (run: Run) => T): Promise<T>;
}

export const MAX_STATE = 16_000_000;
export function serializeRun(run: Run): string {
  const text = JSON.stringify(RunSchema.parse(run), null, 2) + '\n';
  if (new TextEncoder().encode(text).length > MAX_STATE) throw new Error('Run exceeds state size limit.');
  return text;
}
