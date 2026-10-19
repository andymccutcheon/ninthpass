import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Run } from './state.js';

export function slugify(text: string, maxWords = 8): string {
  const firstLine = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? 'prompt';
  const stopwords = new Set(['a', 'an', 'and', 'are', 'at', 'be', 'but', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'that', 'the', 'these', 'this', 'those', 'to', 'with']);
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  while (words.length > 1 && stopwords.has(words.at(-1)!)) words.pop();
  return (words.join('-') || 'prompt').slice(0, 60).replace(/-+$/, '');
}

export interface ExportResult {
  path: string;
  approved: boolean;
  label: string;
}

export async function exportRun(run: Run, outDir: string, name?: string): Promise<ExportResult> {
  if (!run.final) throw new Error('This run has no final or provisional prompt to export.');
  const directory = resolve(outDir);
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error('Refusing symlink output directory.');
    if (!info.isDirectory()) throw new Error('Output path is not a directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const approved = run.status === 'completed' && run.final.approved;
  const base = slugify(name ?? run.original);
  const preferred = join(directory, `${base}${approved ? '' : '.provisional'}.md`);
  let path = preferred;
  try {
    await lstat(path);
    path = join(directory, `${base}-${run.id.slice(0, 8)}${approved ? '' : '.provisional'}.md`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(run.final.text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }

  return { path, approved, label: run.final.label };
}
