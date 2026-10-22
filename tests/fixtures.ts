export const prompt = 'You summarize notes for Alex Morgan. Keep [TBD] and never send without review.\r\n';
export const generated = `=== SYSTEM PROMPT ===
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
export function judge(score: number, verdict = score >= 9 ? 'STOP' : 'CONTINUE') {
  const lower = Math.max(0, score - 0.5);
  const higher = Math.min(10, score + 0.5);
  return `Section Ratings\n- Clarity: ${lower}/10 — contains "notes".\n- Structure: ${score}/10 — the three required sections are present.\n- Delivery: ${higher}/10 — the gate is stated.\n\nOverall Rating: ${score.toFixed(2)}/10 — the mean of the section ratings.\n\nVerdict: ${verdict}\n\nRecommendations\n1. Replace "notes" → "meeting notes".\n2. Preserve "[TBD]".\n3. Preserve the review gate.\n`;
}
export function rewrite(body: string, deferred = false) {
  return `<!-- BEGIN BODY -->${body}<!-- END BODY -->\nRec-application checklist\n1. APPLIED — role\n2. ${deferred ? 'DEFERRED — needs user choice' : 'APPLIED — placeholder'}\n3. APPLIED — gate\n`;
}
