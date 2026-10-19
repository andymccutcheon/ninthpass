import { spawn } from 'node:child_process';
import { WorkerError } from './types.js';

export interface ProcessOptions {
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const { command, args, input, timeoutMs, cwd, env, signal } = options;
  const maxOutputBytes = options.maxOutputBytes ?? 4_000_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;

    const finish = (error?: Error, result?: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result!);
    };

    const child = spawn(command, args, {
      ...(cwd ? { cwd } : {}),
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const kill = (reason: string) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2000).unref();
      finish(new WorkerError(reason));
    };

    timer = setTimeout(() => kill(`Worker timed out after ${Math.round(timeoutMs / 1000)}s.`), timeoutMs);
    abort = () => kill('Worker was aborted.');
    signal?.addEventListener('abort', abort, { once: true });

    child.on('error', error => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(new WorkerError(code === 'ENOENT' ? `Worker command not found: ${command}. Is it installed and on PATH?` : `Worker failed to start: ${error.message}`));
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxOutputBytes) kill('Worker output exceeded the size limit.');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > maxOutputBytes) kill('Worker error output exceeded the size limit.');
    });

    child.stdin.on('error', () => undefined);
    child.stdin.end(input, 'utf8');

    child.on('close', (code, closedSignal) => {
      if (code === 0) finish(undefined, { stdout, stderr, code });
      else {
        const detail = stderr.trim().split('\n').slice(-8).join('\n');
        finish(new WorkerError(`Worker exited ${code ?? closedSignal ?? 'without a status'}${detail ? `:\n${detail}` : '.'}`));
      }
    });
  });
}
