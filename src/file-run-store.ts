import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { regularText } from './io.js';
import { RunSchema, type Run } from './state.js';
import { MAX_STATE, serializeRun, type RunStore } from './run-store.js';

export class FileRunStore implements RunStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private async rootDirectory() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Refusing symlink runs directory.');
  }
  private async materialize(run: Run) {
    for (const artifact of run.artifacts) {
      const path = join(this.root, run.id, artifact.name);
      try {
        const handle = await open(path, 'wx', 0o600);
        try { await handle.writeFile(artifact.text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await regularText(path) !== artifact.text) throw new Error(`Artifact was modified outside the pipeline: ${artifact.name}`);
      }
    }
  }
  private async save(run: Run) {
    const text = serializeRun(run);
    const directory = join(this.root, run.id);
    const temporary = join(directory, `.state-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, join(directory, 'run.json')); } finally { await rm(temporary, { force: true }); }
    await this.materialize(run);
  }
  async create(run: Run) {
    z.uuid().parse(run.id);
    await this.rootDirectory();
    await mkdir(join(this.root, run.id), { mode: 0o700 });
    await this.save(run);
  }
  private async locked<T>(id: string, work: (run: Run) => Promise<T>): Promise<T> {
    z.uuid().parse(id);
    await this.rootDirectory();
    const dir = join(this.root, id);
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Refusing symlink/non-directory run.');
    const lockPath = join(dir, '.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Run is locked by another operation. Retry when it finishes. If a process crashed, remove the stale .lock only after verifying it is no longer running.');
      throw error;
    }
    try {
      const run = RunSchema.parse(JSON.parse(await regularText(join(dir, 'run.json'), MAX_STATE)));
      if (run.id !== id) throw new Error('Run identity mismatch.');
      await this.materialize(run);
      return await work(run);
    } finally { await lock.close(); await rm(lockPath); }
  }
  async read(id: string): Promise<Run> { return this.locked(id, async run => run); }
  async update<T>(id: string, work: (run: Run) => T): Promise<T> {
    return this.locked(id, async run => {
      const result = work(run);
      await this.save(run);
      return result;
    });
  }
}

/**
 * Read a run directory without taking a lock, materialising artifacts, or writing
 * anything. Used only for runs written before the rename, so historical records stay
 * inspectable without ever being modified.
 */
export async function readRunDirectory(directory: string): Promise<Run> {
  const path = join(resolve(directory), 'run.json');
  const run = RunSchema.parse(JSON.parse(await regularText(path, MAX_STATE)));
  return run;
}
