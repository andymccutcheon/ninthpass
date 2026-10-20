import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Catalog } from '../src/catalog.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function temp() { const p = await mkdtemp(join(tmpdir(), 'ninthpass-catalog-')); roots.push(p); return p; }

test('discovers all five original skills and preserves exact source', async () => {
  const catalog = await Catalog.load(resolve('skills'));
  expect(catalog.list().map(s => s.name)).toEqual(['brief', 'compose', 'judge', 'loop', 'revise']);
  expect(catalog.get('compose').source).toBe(await readFile('skills/compose/SKILL.md', 'utf8'));
  expect(catalog.search('rough task')[0]?.name).toBe('brief');
  expect(catalog.search('zzzznotfound')).toEqual([]);
  expect(catalog.search('')).toHaveLength(5);
  expect(catalog.assets.has('loop/scripts/stage_control.py')).toBe(true);
  expect(catalog.assets.has('VERIFICATION.md')).toBe(true);
  expect(() => catalog.get('../secret')).toThrow();
  expect(() => catalog.asset('../secret')).toThrow();
});

test('rejects missing, empty, malformed, mismatched and symlink catalogs', async () => {
  const root = await temp();
  await expect(Catalog.load(join(root, 'missing'))).rejects.toThrow();
  await expect(Catalog.load(root)).rejects.toThrow(/No skills/);
  await mkdir(join(root, 'demo'));
  for (const source of ['no metadata', '---\nname: other\ndescription: valid\n---\nBody', '---\nname: demo\ndescription: 42\n---\nBody', '---\nname: [\n---\nBody']) {
    await writeFile(join(root, 'demo/SKILL.md'), source);
    await expect(Catalog.load(root)).rejects.toThrow();
  }
  await rm(join(root, 'demo/SKILL.md'));
  await symlink(resolve('skills/compose/SKILL.md'), join(root, 'demo/SKILL.md'));
  await expect(Catalog.load(root)).rejects.toThrow(/symlink/i);
});
