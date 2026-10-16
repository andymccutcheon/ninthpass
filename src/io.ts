import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

export { MAX_TEXT, boundedText } from './text.js';

export async function regularText(path: string, maxBytes = 1_000_000): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Refusing symlink file.');
  if (!info.isFile() || info.size > maxBytes) throw new Error('Expected a bounded regular text file.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size > maxBytes) throw new Error('Expected a bounded regular text file.');
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error('File exceeds size limit.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await handle.close(); }
}
