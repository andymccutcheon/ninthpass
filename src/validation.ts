import { boundedText } from './text.js';

export interface Fix { old: string; new: string }
export interface Judge { score: number; verdict: 'STOP' | 'CONTINUE'; recommendations: { number: number; text: string }[] }

function exactlyOne(text: string, marker: string): number {
  if (text.split(marker).length !== 2) throw new Error(`Each marker must occur exactly once: ${marker}`);
  return text.indexOf(marker);
}

export function extractBody(text: string): string {
  const begin = exactlyOne(text, '<!-- BEGIN BODY -->') + '<!-- BEGIN BODY -->'.length;
  const end = exactlyOne(text, '<!-- END BODY -->');
  if (begin > end) throw new Error('BEGIN BODY must precede END BODY.');
  const body = text.slice(begin, end);
  boundedText(body, 'BODY');
  return body;
}

export function validateGenerated(text: string): void {
  boundedText(text, 'Compose output');
  const system = exactlyOne(text, '=== SYSTEM PROMPT ===');
  const task = exactlyOne(text, '=== TASK PROMPT ===');
  if (text.slice(0, system).trim() || system > task) throw new Error('Output must start with System then Task Prompt.');
  for (const heading of ['Primary Role', 'High-Level Objectives', 'Domain Expertise & Resources', 'Allowed Tools & APIs', 'Operating Constraints', 'Interaction Style & Voice', 'Memory & Context Handling', 'Self-Monitoring & Reflection', 'Example Exchanges (Few-Shot)', 'Safety & Ethics', 'Deliverable Structure']) {
    if (!text.slice(system, task).includes(heading)) throw new Error(`Missing System Prompt heading: ${heading}`);
  }
  for (const heading of ['GOAL:', 'RETURN FORMAT:', 'WARNINGS & REQUIREMENTS:', 'CONTEXT:']) {
    if (!text.slice(task).includes(heading)) throw new Error(`Missing Task Prompt heading: ${heading}`);
  }
}

export function parseJudge(text: string): Judge {
  boundedText(text, 'Judge output');
  const ratings = [...text.matchAll(/^Overall Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/gm)];
  const verdicts = [...text.matchAll(/^Verdict:\s*(STOP|CONTINUE)\s*$/gm)];
  if (ratings.length !== 1 || verdicts.length !== 1) throw new Error('Judge needs exactly one Overall Rating: n/10 and Verdict: STOP|CONTINUE.');
  const score = Number(ratings[0]![1]);
  const verdict = verdicts[0]![1] as Judge['verdict'];
  if (score < 0 || score > 10 || (score >= 9) !== (verdict === 'STOP')) throw new Error('Judge score/verdict must agree with the locked 9–10 STOP band.');
  const recIndex = text.search(/^Recommendations\s*$/m);
  if (!/^Section Ratings\s*$/m.test(text) || !/^- .+:\s*\d+(?:\.\d+)?\/10\s*[—-]\s*.+/m.test(text)) throw new Error('Missing section ratings with evidence.');
  const sectionScores = [...text.slice(0, recIndex < 0 ? undefined : recIndex).matchAll(/^- .+:\s*(\d+(?:\.\d+)?)\/10\s*[—-]/gm)];
  if (sectionScores.some(match => Number(match[1]) > 10)) throw new Error('Section scores must be within 0–10.');
  if (recIndex < 0) throw new Error('Missing Recommendations heading.');
  const recommendations = [...text.slice(recIndex).matchAll(/^(\d+)\.\s+(.+(?:\n(?!\d+\.\s)[^\n]+)*)/gm)].map(m => ({ number: Number(m[1]), text: m[2]! }));
  if (recommendations.some((r, i) => r.number !== i + 1) || recommendations.length > 5 || (verdict === 'CONTINUE' && recommendations.length < 3)) throw new Error('Judge needs sequential numbered recommendations (3–5 for CONTINUE).');
  return { score, verdict, recommendations };
}

export function isAuthorizedFix(fix: Fix, recommendations: Judge['recommendations']): boolean {
  return recommendations.some(rec => [...rec.text.matchAll(/["“`]([^"”`]+)["”`]\s*(?:→|->)\s*["“`]([^"”`]*)["”`]/g)]
    .some(pair => pair[1] === fix.old && pair[2] === fix.new));
}

export function validateRewrite(text: string, recNumbers: number[]): { body: string; deferred: string } {
  boundedText(text, 'Revise output');
  const body = extractBody(text);
  const after = text.slice(text.indexOf('<!-- END BODY -->') + '<!-- END BODY -->'.length);
  if (!/^Rec-application checklist\s*$/m.test(after)) throw new Error('Missing Rec-application checklist after END BODY.');
  const entries = [...after.matchAll(/^(\d+)\.\s+(APPLIED|DEFERRED)\s*[—-]\s*(.+)$/gm)];
  if (entries.length !== recNumbers.length || entries.some((m, i) => Number(m[1]) !== recNumbers[i])) throw new Error('Checklist must account for every numbered recommendation exactly once.');
  return { body, deferred: entries.filter(m => m[2] === 'DEFERRED').map(m => m[0]).join('\n') };
}

export function replaceExactly(text: string, fixes: Fix[]): string {
  if (!fixes.length) throw new Error('Supply at least one exact replacement.');
  let result = text;
  for (const fix of fixes) {
    if (!fix.old || result.split(fix.old).length !== 2) throw new Error('Each old string must occur exactly once; nothing written.');
    result = result.replace(fix.old, () => fix.new);
  }
  boundedText(result, 'Fixed prompt');
  return result;
}
