import { randomUUID } from 'node:crypto';
import { parseJudge } from '../validation.js';
import type { StageRequest, StageResult, Worker } from './types.js';

const GENERATED = `=== SYSTEM PROMPT ===
Primary Role
Summarize meeting notes.
High-Level Objectives
Preserve facts.
Domain Expertise & Resources
Meeting notes.
Allowed Tools & APIs
Supplied text only.
Operating Constraints
Never invent facts.
Interaction Style & Voice
Concise.
Memory & Context Handling
Use supplied notes.
Self-Monitoring & Reflection
Check facts.
Example Exchanges (Few-Shot)
Example data: User: "No notes". Assistant: "Please supply notes."
Safety & Ethics
Do not send.
Deliverable Structure
Five bullets.
=== TASK PROMPT ===
GOAL:
Summarize notes.
RETURN FORMAT:
Five bullets.
WARNINGS & REQUIREMENTS:
Keep facts.
CONTEXT:
[TBD]
`;

function scorecard(score: number): string {
  const verdict = score >= 9 ? 'STOP' : 'CONTINUE';
  const recommendations = score >= 9
    ? '1. Preserve the review gate.'
    : '1. Replace "notes" → "meeting notes".\n2. Preserve "[TBD]".\n3. Preserve the review gate.';
  return `Section Ratings
- Clarity: ${score}/10 — contains "notes".

Overall Rating: ${score}/10 — evidence reviewed.

Verdict: ${verdict}

Recommendations
${recommendations}
`;
}

export class FixtureWorker implements Worker {
  readonly name = 'fixture';
  private judgeCalls = 0;

  async execute(request: StageRequest): Promise<StageResult> {
    const execution_id = `fixture:${randomUUID()}`;
    if (request.stage === 'generate') return { text: GENERATED, execution_id };
    if (request.stage === 'judge') {
      const score = this.judgeCalls++ === 0 ? 8 : 9;
      return { text: scorecard(score), execution_id };
    }
    if (request.stage === 'rewrite') {
      const prompt = String(request.input.prompt ?? '');
      const numbers = parseJudge(String(request.input.scorecard ?? '')).recommendations.map(r => r.number);
      const checklist = numbers.map(number => `${number}. APPLIED — addressed in the rewrite`).join('\n');
      return {
        text: `<!-- BEGIN BODY -->${prompt}<!-- END BODY -->\nRec-application checklist\n${checklist}\n`,
        execution_id,
      };
    }
    const replacements = Array.isArray(request.input.replacements) ? request.input.replacements : [];
    return {
      text: replacements.map((_, index) => `${index + 1}. PASS — exact replacement, no drift.`).join('\n'),
      execution_id,
    };
  }
}
