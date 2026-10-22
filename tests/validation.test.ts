import { expect, test } from 'vitest';
import { extractBody, parseJudge, structureOf, validateGenerated, validateRewrite, replaceExactly, isAuthorizedFix } from '../src/validation.js';
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
  expect(() => parseJudge(judge(8).replace('Clarity: 7.5/10', 'Clarity: 11/10'))).toThrow();
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

// ---- Structural contract: a deterministic requirement outranks a model's recommendation ----

const both = { system: true, task: true };

test('full-mode rewrites must preserve both blocks and their sections', () => {
  expect(() => validateRewrite(rewrite(generated), [1, 2, 3], both)).not.toThrow();
  // a valid consolidation inside the existing structure still passes
  const consolidated = generated.replace('Output must be exactly five bullet points', 'Return exactly five bullets');
  expect(() => validateRewrite(rewrite(consolidated), [1, 2, 3], both)).not.toThrow();
  // ...and repeated revision passes keep the same requirement
  expect(() => validateRewrite(rewrite(consolidated), [1, 2, 3], both)).not.toThrow();
});

test('rejects a rewrite that deletes either required block', () => {
  const taskOnly = generated.slice(generated.indexOf('=== TASK PROMPT ==='));
  const systemOnly = generated.slice(0, generated.indexOf('=== TASK PROMPT ==='));
  expect(() => validateRewrite(rewrite(taskOnly), [1, 2, 3], both)).toThrow(/Missing System Prompt block/);
  expect(() => validateRewrite(rewrite(systemOnly), [1, 2, 3], both)).toThrow(/Missing Task Prompt block/);
});

test('rejects empty, duplicated, malformed or reordered blocks', () => {
  const emptyTask = generated.replace(/=== TASK PROMPT ===[\s\S]*$/, '=== TASK PROMPT ===\n');
  expect(() => validateRewrite(rewrite(emptyTask), [1, 2, 3], both)).toThrow(/Task Prompt block is empty/);
  expect(() => validateRewrite(rewrite(generated + '\n=== TASK PROMPT ==='), [1, 2, 3], both)).toThrow(/exactly once/);
  expect(() => validateRewrite(rewrite(generated.replace('CONTEXT:', 'Missing:')), [1, 2, 3], both)).toThrow(/Missing Task Prompt heading/);
  expect(() => validateRewrite(rewrite(generated.replace('Primary Role', 'Role')), [1, 2, 3], both)).toThrow(/Missing System Prompt heading/);
  const reversed = generated.slice(generated.indexOf('=== TASK PROMPT ===')) + generated.slice(0, generated.indexOf('=== TASK PROMPT ==='));
  expect(() => validateRewrite(rewrite(reversed), [1, 2, 3], both)).toThrow(/must start with the System Prompt block/);
});

test('the rejection tells the reviser what to do instead of applying a destructive recommendation', () => {
  const systemOnly = generated.slice(0, generated.indexOf('=== TASK PROMPT ==='));
  expect(() => validateRewrite(rewrite(systemOnly), [1, 2, 3], both)).toThrow(/preserve the required output structure[\s\S]*DEFERRED/);
});

test('optimize-only preserves the shape of its input rather than requiring blocks it never had', () => {
  const plain = { system: false, task: false };
  expect(() => validateRewrite(rewrite(prompt), [1, 2, 3], plain)).not.toThrow();
  const systemHalf = generated.slice(0, generated.indexOf('=== TASK PROMPT ==='));
  expect(() => validateRewrite(rewrite(systemHalf), [1, 2, 3], structureOf(systemHalf))).not.toThrow();
  expect(() => validateRewrite(rewrite(prompt), [1, 2, 3], structureOf(systemHalf))).toThrow(/Missing System Prompt block/);
});

test('the overall score is the arithmetic mean of the sections, to two decimals', () => {
  const card = (sections: number[], overall: string, verdict: 'STOP' | 'CONTINUE') =>
    `Section Ratings\n${sections.map((s, i) => `- Part ${i + 1}: ${s}/10 — evidence.`).join('\n')}\n\nOverall Rating: ${overall}/10 — mean.\n\nVerdict: ${verdict}\n\nRecommendations\n1. Replace "a" → "b".\n2. Preserve "c".\n3. Preserve "d".\n`;
  // 8.1 + 8.2 + 8.1 = 24.4 / 3 = 8.13
  expect(parseJudge(card([8.1, 8.2, 8.1], '8.13', 'CONTINUE')).score).toBe(8.13);
  // the stated overall may not be chosen independently
  expect(() => parseJudge(card([8.1, 8.2, 8.1], '8.00', 'CONTINUE'))).toThrow(/must be the mean/);
  // the gate reads the mean, so 9.25 stops and 8.99 does not
  expect(parseJudge(card([9.2, 9.3, 9.25], '9.25', 'STOP')).verdict).toBe('STOP');
  expect(() => parseJudge(card([8.9, 9.0, 9.0], '8.97', 'STOP'))).toThrow(/9–10 STOP band/);
  expect(() => parseJudge(card([8, 8], '8.00', 'CONTINUE'))).toThrow(/at least three section ratings/);
});
