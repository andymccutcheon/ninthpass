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

const SYSTEM_MARKER = '=== SYSTEM PROMPT ===';
const TASK_MARKER = '=== TASK PROMPT ===';
const SYSTEM_HEADINGS = ['Primary Role', 'High-Level Objectives', 'Domain Expertise & Resources', 'Allowed Tools & APIs', 'Operating Constraints', 'Interaction Style & Voice', 'Memory & Context Handling', 'Self-Monitoring & Reflection', 'Example Exchanges (Few-Shot)', 'Safety & Ethics', 'Deliverable Structure'];
const TASK_HEADINGS = ['GOAL:', 'RETURN FORMAT:', 'WARNINGS & REQUIREMENTS:', 'CONTEXT:'];

/** Which structural blocks a prompt carries. Used to preserve a prompt's shape across a rewrite. */
export interface StructureRequirement { system: boolean; task: boolean }

export function structureOf(text: string): StructureRequirement {
  return { system: text.includes(SYSTEM_MARKER), task: text.includes(TASK_MARKER) };
}

function assertBlock(content: string, headings: string[], label: string): void {
  if (!content.trim()) throw new Error(`${label} block is empty.`);
  for (const heading of headings) if (!content.includes(heading)) throw new Error(`Missing ${label} heading: ${heading}`);
}

/** The structural contract of a complete prompt: both blocks, in order, with their sections. */
export function validateStructure(text: string, required: StructureRequirement): void {
  if (!required.system && !required.task) return;
  if (required.system && !text.includes(SYSTEM_MARKER)) throw new Error('Missing System Prompt block.');
  if (required.task && !text.includes(TASK_MARKER)) throw new Error('Missing Task Prompt block.');
  if (required.system) {
    const system = exactlyOne(text, SYSTEM_MARKER);
    if (text.slice(0, system).trim()) throw new Error('A structured prompt must start with the System Prompt block.');
    if (!required.task) { assertBlock(text.slice(system + SYSTEM_MARKER.length), SYSTEM_HEADINGS, 'System Prompt'); return; }
    const task = exactlyOne(text, TASK_MARKER);
    if (system > task) throw new Error('System Prompt must precede Task Prompt.');
    assertBlock(text.slice(system + SYSTEM_MARKER.length, task), SYSTEM_HEADINGS, 'System Prompt');
    assertBlock(text.slice(task + TASK_MARKER.length), TASK_HEADINGS, 'Task Prompt');
    return;
  }
  const task = exactlyOne(text, TASK_MARKER);
  assertBlock(text.slice(task + TASK_MARKER.length), TASK_HEADINGS, 'Task Prompt');
}

export function validateGenerated(text: string): void {
  boundedText(text, 'Compose output');
  const system = exactlyOne(text, SYSTEM_MARKER);
  const task = exactlyOne(text, TASK_MARKER);
  if (text.slice(0, system).trim() || system > task) throw new Error('Output must start with System then Task Prompt.');
  assertBlock(text.slice(system + SYSTEM_MARKER.length, task), SYSTEM_HEADINGS, 'System Prompt');
  assertBlock(text.slice(task + TASK_MARKER.length), TASK_HEADINGS, 'Task Prompt');
}

export function parseJudge(text: string): Judge {
  boundedText(text, 'Judge output');
  const ratings = [...text.matchAll(/^Overall Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/gm)];
  const verdicts = [...text.matchAll(/^Verdict:\s*(STOP|CONTINUE)\s*$/gm)];
  if (ratings.length !== 1 || verdicts.length !== 1) throw new Error('Judge needs exactly one Overall Rating: n/10 and Verdict: STOP|CONTINUE.');
  const stated = Number(ratings[0]![1]);
  const verdict = verdicts[0]![1] as Judge['verdict'];
  const recIndex = text.search(/^Recommendations\s*$/m);
  if (!/^Section Ratings\s*$/m.test(text) || !/^- .+:\s*\d+(?:\.\d+)?\/10\s*[—-]\s*.+/m.test(text)) throw new Error('Missing section ratings with evidence.');
  const sectionScores = [...text.slice(0, recIndex < 0 ? undefined : recIndex).matchAll(/^- .+:\s*(\d+(?:\.\d+)?)\/10\s*[—-]/gm)];
  const values = sectionScores.map(match => Number(match[1]));
  if (values.some(value => value < 0 || value > 10)) throw new Error('Section scores must be within 0–10.');
  if (values.length < 3) throw new Error('Judge needs at least three section ratings; the overall is their mean.');

  // The overall is arithmetic, not a second judgement.
  const mean = Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
  if (Math.abs(stated - mean) > 0.005) throw new Error(`Overall Rating must be the mean of the section ratings (${mean.toFixed(2)}), not ${stated}. Compute the mean and write it to two decimals.`);
  const score = mean;
  if (score < 0 || score > 10 || (score >= 9) !== (verdict === 'STOP')) throw new Error('Judge score/verdict must agree with the locked 9–10 STOP band.');
  if (recIndex < 0) throw new Error('Missing Recommendations heading.');
  const recommendations = [...text.slice(recIndex).matchAll(/^(\d+)\.\s+(.+(?:\n(?!\d+\.\s)[^\n]+)*)/gm)].map(m => ({ number: Number(m[1]), text: m[2]! }));
  if (recommendations.some((r, i) => r.number !== i + 1) || recommendations.length > 5 || (verdict === 'CONTINUE' && recommendations.length < 3)) throw new Error('Judge needs sequential numbered recommendations (3–5 for CONTINUE).');
  return { score, verdict, recommendations };
}

export function isAuthorizedFix(fix: Fix, recommendations: Judge['recommendations']): boolean {
  return recommendations.some(rec => [...rec.text.matchAll(/["“`]([^"”`]+)["”`]\s*(?:→|->)\s*["“`]([^"”`]*)["”`]/g)]
    .some(pair => pair[1] === fix.old && pair[2] === fix.new));
}

export function validateRewrite(text: string, recNumbers: number[], required?: StructureRequirement): { body: string; deferred: string } {
  boundedText(text, 'Revise output');
  const body = extractBody(text);
  if (required) {
    try { validateStructure(body, required); }
    catch (error) {
      const removal = /missing|empty|must start|precede/i.test((error as Error).message);
      throw new Error(removal
        ? `${(error as Error).message} The rewrite must preserve the required output structure. Keep the block, remove the redundancy inside it, and mark the conflicting recommendation DEFERRED.`
        : (error as Error).message);
    }
  }
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
