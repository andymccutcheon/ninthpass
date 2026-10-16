import { z } from 'zod';
import { RunSchema, type Run } from '../src/state.js';
import { MAX_STATE, serializeRun, type RunStore } from '../src/run-store.js';

// Chunk bytes rather than UTF-16 strings: splitting a surrogate pair would alter
// prompt contents on SQLite's UTF-8 round-trip. Rows stay well below SQLite limits.
const CHUNK_BYTES = 200_000;

export class SqliteRunStore implements RunStore {
  constructor(private readonly storage: DurableObjectStorage, private readonly owner: string, private readonly id: string) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner TEXT NOT NULL, run_id TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS state_chunks (part INTEGER PRIMARY KEY, data BLOB NOT NULL)');
  }

  private readSync(id: string): Run {
    z.uuid().parse(id);
    const identity = this.storage.sql.exec<{ owner: string; run_id: string }>('SELECT owner, run_id FROM identity WHERE singleton = 1').toArray()[0];
    if (!identity || identity.owner !== this.owner || identity.run_id !== id || id !== this.id) throw new Error('Run not found for this owner.');
    const rows = this.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM state_chunks ORDER BY part').toArray();
    const size = rows.reduce((total, row) => total + row.data.byteLength, 0);
    if (size > MAX_STATE) throw new Error('Stored run exceeds state size limit.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const row of rows) { bytes.set(new Uint8Array(row.data), offset); offset += row.data.byteLength; }
    const run = RunSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)));
    if (run.id !== id) throw new Error('Run identity mismatch.');
    return run;
  }

  private writeSync(run: Run) {
    const bytes = new TextEncoder().encode(serializeRun(run));
    this.storage.sql.exec('DELETE FROM state_chunks');
    for (let offset = 0, part = 0; offset < bytes.length; offset += CHUNK_BYTES, part++) {
      this.storage.sql.exec('INSERT INTO state_chunks (part, data) VALUES (?, ?)', part, bytes.slice(offset, offset + CHUNK_BYTES).buffer);
    }
  }

  async create(run: Run) {
    this.storage.transactionSync(() => {
      if (run.id !== this.id) throw new Error('Run identity mismatch.');
      const existing = this.storage.sql.exec('SELECT singleton FROM identity').toArray();
      if (existing.length) throw new Error('Run already exists.');
      this.storage.sql.exec('INSERT INTO identity (singleton, owner, run_id) VALUES (1, ?, ?)', this.owner, run.id);
      this.writeSync(run);
    });
  }
  async read(id: string): Promise<Run> { return this.readSync(id); }
  async update<T>(id: string, work: (run: Run) => T): Promise<T> {
    return this.storage.transactionSync(() => {
      const run = this.readSync(id);
      const result = work(run);
      this.writeSync(run);
      return result;
    });
  }
}
