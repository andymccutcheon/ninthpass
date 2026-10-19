import { randomUUID } from 'node:crypto';
import { runProcess } from './spawn.js';
import { renderPrompt, WorkerError, type StageRequest, type StageResult, type Worker } from './types.js';

export type ProcessWorkerName = 'opencode' | 'claude' | 'codex';

export interface ProcessWorkerConfig {
  model?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function buildCommand(name: ProcessWorkerName, model?: string): { command: string; args: string[] } {
  if (name === 'opencode') {
    return { command: 'opencode', args: ['run', '--format', 'json', ...(model ? ['-m', model] : [])] };
  }
  if (name === 'claude') {
    return { command: 'claude', args: ['-p', '--output-format', 'text', ...(model ? ['--model', model] : [])] };
  }
  return { command: 'codex', args: ['exec', '--skip-git-repo-check', '-', ...(model ? ['--model', model] : [])] };
}

export function parseOpenCode(stdout: string): { text: string; sessionId?: string } {
  const parts: string[] = [];
  let sessionId: string | undefined;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as { type?: string; sessionID?: string; part?: { type?: string; text?: string } };
      if (typeof event.sessionID === 'string') sessionId = event.sessionID;
      if (event.type === 'text' && event.part?.type === 'text' && typeof event.part.text === 'string') {
        parts.push(event.part.text);
      }
    } catch {
      // OpenCode can print non-JSON progress lines; ignore them.
    }
  }
  return { text: parts.join(''), ...(sessionId ? { sessionId } : {}) };
}

export class ProcessWorker implements Worker {
  readonly name: string;
  private readonly config: ProcessWorkerConfig;
  private readonly workerName: ProcessWorkerName;

  constructor(name: ProcessWorkerName, config: ProcessWorkerConfig = {}) {
    this.name = name;
    this.workerName = name;
    this.config = config;
  }

  async execute(request: StageRequest, options: { signal?: AbortSignal } = {}): Promise<StageResult> {
    const { command, args } = buildCommand(this.workerName, this.config.model);
    const result = await runProcess({
      command,
      args,
      input: renderPrompt(request),
      timeoutMs: this.config.timeoutMs ?? 15 * 60 * 1000,
      ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
      ...(this.config.env ? { env: this.config.env } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const parsed = this.workerName === 'opencode' ? parseOpenCode(result.stdout) : { text: result.stdout, sessionId: undefined };
    if (!parsed.text.trim()) throw new WorkerError(`${this.workerName} returned no text for ${request.skill} (${request.stage}).`);
    return {
      text: parsed.text,
      execution_id: parsed.sessionId ? `${this.workerName}:${parsed.sessionId}` : `${this.workerName}:${randomUUID()}`,
    };
  }
}
