import { readdir, lstat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Catalog as CoreCatalog } from './catalog-core.js';
import { regularText } from './io.js';
export { assetUri, skillUri, type Skill } from './catalog-core.js';

export class Catalog extends CoreCatalog {
  static async load(directory: string): Promise<CoreCatalog> {
    const root = resolve(directory);
    if ((await lstat(root)).isSymbolicLink()) throw new Error('Refusing symlink skills directory.');
    const assets = new Map<string, string>();
    async function walk(dir: string, prefix = '', depth = 0): Promise<void> {
      if (depth > 8) throw new Error('Skills directory nesting exceeds limit.');
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) throw new Error('Refusing symlink in skills catalog.');
        const key = prefix + entry.name;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, `${key}/`, depth + 1);
        else if (['.md', '.py', '.txt', '.json', '.yaml', '.yml'].includes(extname(key))) {
          if (assets.size >= 1000) throw new Error('Too many skill assets.');
          assets.set(key, await regularText(path));
        }
      }
    }
    await walk(root);
    return CoreCatalog.fromAssets(assets);
  }
}
