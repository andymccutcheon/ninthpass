import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { authenticate } from '../worker/auth.js';

const token = 'fixture-only-credential-0000000000000000000000';
const hash = createHash('sha256').update(token).digest('hex');
const request = (authorization?: string) => new Request('https://example.com/mcp', authorization ? { headers: { Authorization: authorization } } : {});

test('missing, invalid or ambiguous auth configuration fails closed', async () => {
  for (const secret of [undefined, '', 'not-json', '[]', JSON.stringify([{ owner: '../secret', sha256: hash }]), JSON.stringify([{ owner: 'one', sha256: hash }, { owner: 'two', sha256: hash }])]) {
    expect(await authenticate(request(`Bearer ${token}`), secret)).toHaveProperty('status', 503);
  }
});
test('only exact bearer credentials produce a configured principal', async () => {
  const secret = JSON.stringify([{ owner: 'owner-1', sha256: hash }]);
  expect(await authenticate(request(`Bearer ${token}`), secret)).toBe('owner-1');
  expect(await authenticate(request(`bearer ${token}`), secret)).toBe('owner-1');
  for (const value of [undefined, 'Basic invalid', 'Bearer short', `Bearer ${token}x`]) {
    const result = await authenticate(request(value), secret);
    expect(result).toHaveProperty('status', 401);
    expect((result as Response).headers.get('WWW-Authenticate')).toContain('Bearer');
  }
});
