import { z } from 'zod';

export const OwnerSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const CredentialsSchema = z.array(z.object({ owner: OwnerSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(32)
  .refine(entries => new Set(entries.map(entry => entry.sha256)).size === entries.length, 'Credential hashes must be unique.');

export async function authenticate(request: Request, secret: string | undefined): Promise<string | Response> {
  let credentials: z.infer<typeof CredentialsSchema>;
  try { credentials = CredentialsSchema.parse(JSON.parse(secret ?? '')); }
  catch { return Response.json({ error: 'Authentication is not configured.' }, { status: 503 }); }
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(request.headers.get('Authorization') ?? '');
  if (match) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]!));
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    for (const credential of credentials) {
      let difference = 0;
      for (let i = 0; i < 64; i++) difference |= hash.charCodeAt(i) ^ credential.sha256.charCodeAt(i);
      if (difference === 0) return credential.owner;
    }
  }
  return Response.json({ error: 'A valid bearer credential is required.' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="promptzilla"' } });
}
