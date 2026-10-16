import { mkdir, writeFile } from 'node:fs/promises';
import { Catalog } from '../dist/catalog.js';

const catalog = await Catalog.load(new URL('../skills', import.meta.url).pathname);
await mkdir(new URL('../worker', import.meta.url), { recursive: true });
await writeFile(new URL('../worker/skills.generated.json', import.meta.url), JSON.stringify(Object.fromEntries([...catalog.assets].sort(([a], [b]) => a.localeCompare(b)))) + '\n');
process.stderr.write(`Bundled ${catalog.list().length} skills and ${catalog.assets.size} source assets.\n`);
