import { expect, test } from 'vitest';
import { extractBody, parseJudge, validateGenerated, validateRewrite, replaceExactly, isAuthorizedFix } from '../src/validation.js';
import { generated, judge, prompt, rewrite } from './fixtures.js';

test('validates actual stage contracts and preserves interior bytes', () => {
  expect(extractBody(rewrite(prompt))).toBe(prompt);
  expect(parseJudge(judge(8)).score).toBe(8);
  expect(parseJudge(judge(9)).verdict).toBe('STOP');
  expect(parseJudge(judge(8)).recommendations).toHaveLength(3);
  expect(() => validateGenerated(generated)).not.toThrow();
  expect(validateRewrite(rewrite(prompt, true), [1, 2, 3]).deferred).toContain('needs user choice');
});

test('rejects missing, reversed, repeated markers and incomplete output', () => {
  for (const s of ['', '<!-- END BODY -->x<!-- BEGIN BODY -->', rewrite(prompt) + '<!-- END BODY -->']) expect(() => extractBody(s)).toThrow();
  expect(() => validateGenerated(generated.replace('Allowed Tools & APIs', 'Missing'))).toThrow();
  expect(() => validateGenerated(generated + '=== SYSTEM PROMPT ===')).toThrow();
  expect(() => validateRewrite(rewrite(prompt).replace('3. APPLIED — gate', ''), [1, 2, 3])).toThrow();
  expect(() => validateRewrite(rewrite(prompt).replace('Rec-application checklist', ''), [1, 2, 3])).toThrow();
  for (const s of ['', judge(11), judge(8, 'STOP'), judge(9, 'CONTINUE'), judge(8).replace('Verdict: CONTINUE', ''), judge(8).replace('Recommendations', 'No recs'), judge(8) + 'Overall Rating: 9/10']) expect(() => parseJudge(s)).toThrow();
  expect(() => parseJudge(judge(8).replace('Clarity: 8/10', 'Clarity: 11/10'))).toThrow();
  expect(() => parseJudge(judge(8).replace('3. Preserve', '4. Preserve'))).toThrow();
  expect(() => validateGenerated(generated.replace('CONTEXT:', 'Missing:'))).toThrow();
  expect(() => validateGenerated(generated.replace('=== SYSTEM PROMPT ===', 'Prefix\n=== SYSTEM PROMPT ==='))).toThrow();
});

test('authorizes only exact Judge replacement pairs, not substrings or unrelated text', () => {
  const recs = parseJudge(judge(9)).recommendations;
  expect(isAuthorizedFix({ old: 'notes', new: 'meeting notes' }, recs)).toBe(true);
  expect(isAuthorizedFix({ old: 'note', new: 'meeting' }, recs)).toBe(false);
  expect(isAuthorizedFix({ old: 'notes', new: '' }, recs)).toBe(false);
  expect(isAuthorizedFix({ old: 'notes', new: 'meeting notes' }, [{ number: 1, text: 'Keep notes and use meeting notes.' }])).toBe(false);
});

test('exact fixes are all-or-nothing, nonempty, and preserve CRLF', () => {
  expect(replaceExactly(prompt, [{ old: 'notes', new: 'meeting notes' }])).toContain('meeting notes');
  expect(replaceExactly(prompt, [{ old: 'notes', new: '' }])).toMatch(/\r\n$/);
  for (const fixes of [[], [{ old: '', new: 'x' }], [{ old: 'missing', new: 'x' }], [{ old: 'e', new: 'x' }], [{ old: 'notes', new: 'x' }, { old: 'missing', new: 'x' }]]) expect(() => replaceExactly(prompt, fixes)).toThrow();
});
