import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve('.secrets');
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const credentialFile = join(directory, 'client-credential.json');
const owner = process.env.PROMPTZILLA_OWNER ?? 'owner';
let credential;
try { credential = JSON.parse(await readFile(credentialFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credential = { owner, token: randomBytes(32).toString('base64url') };
  await writeFile(credentialFile, JSON.stringify(credential, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(credential.owner) || !/^[A-Za-z0-9_-]{43}$/.test(credential.token)) throw new Error('Invalid saved client credential; refusing to overwrite.');
const clients = [{ owner: credential.owner, sha256: createHash('sha256').update(credential.token).digest('hex') }];
const secretFile = join(directory, 'cloudflare-secrets.json');
await writeFile(secretFile, JSON.stringify({ PROMPTZILLA_CLIENTS: JSON.stringify(clients) }, null, 2) + '\n', { mode: 0o600 });
await chmod(credentialFile, 0o600);
await chmod(secretFile, 0o600);
process.stdout.write('Private credential prepared in .secrets/client-credential.json; only its SHA-256 hash will be uploaded to Cloudflare.\n');
