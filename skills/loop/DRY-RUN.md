# Dry-run report: `prompt-pipeline` meta-skill

> **Historical record.** This dry run was written before the October 2026 skill rename.
> Original names in the record below: `metapod` → `compose`, `judge-dredd` → `judge`,
> `brian-spillner` → `revise`, `prompt-pipeline` → `loop`; stage files `01-metapod.md` →
> `01-compose.md`, `03-brian-rewrite.md` → `03-revise.md`.

Date: 2026-10-15. Skill under test: `skills/prompt-pipeline/SKILL.md`. Sub-skills: `metapod`, `judge-dredd`, `brian-spillner` (Directive 1 skills, unedited). Runs live under `runs/`.

---

## Test 1 — Structure check

`skills/prompt-pipeline/SKILL.md` was inspected against Directive 2 acceptance test 1.

| Required element | Present | Location |
|---|---|---|
| Frontmatter `name: prompt-pipeline` + description | YES | SKILL.md lines 1-4 |
| Full mode | YES | "## Modes → Full" |
| Optimize-only mode | YES | "## Modes → Optimize-only" |
| Stage file table (00–06) | YES | "Working directory and stage files" |
| Brief templates (Metapod, Judge pass 1, Brian, Judge pass 2+, Judge confirmation) | YES | "Invoking the sub-skills → Brief templates" |
| Must-fix procedure (exact replace, confirmation, 06-judge-confirmation.md) | YES | "Must-fixes after a STOP-level score" |
| Orchestrator rules (show work, loop cap 4, no invented facts, verbatim facts, no stage edits, no sub-skill edits, deployment separate) | YES | "Orchestrator rules" |
| Failure handling (missing part, CONTINUE no recs, DEFERRED recs, lost facts, plateau, subagent error, leave directory intact) | YES | "Failure handling" |
| Final deliverable (final prompt block, score history, fixes + confirmation, open items) | YES | "Final deliverable" |
| Names the three sub-skills by their `name` values | YES | `metapod`, `judge-dredd`, `brian-spillner` named in Modes and Invoking |

Result: **PASS**. `skills/prompt-pipeline/SKILL.md` is 98 lines (~430 words), under the ~1,500-word cap; no `references/` folder needed.

---

## Test 2 — Optimize-only dry run on the tiny prompt

`00-original.md` saved byte for byte at `runs/2026-10-15-alex-meeting-notes/00-original.md`:

```
You are a meeting-notes summarizer for Alex Morgan ([TITLE: Alex to choose]). Summarize notes into five bullets. Never invent names or dates; use [TBD]. Keep Alex's wording for quotes. Do not send anything without Alex's review.
```

Mode chosen: Optimize-only (input is a prompt the user wrote/pasted).

Stage files produced, in order, each stage in a separate subagent/fresh context reading only its input file:

| File | Writer | Result |
|---|---|---|
| `00-original.md` | Orchestrator | User's prompt, byte for byte |
| `02-judge-pass1.md` | Judge | Overall 5/10, Verdict: CONTINUE, 5 numbered recs with exact old→new wording; each section justification cites a quote from the prompt |
| `03-brian-rewrite.md` | Brian | BODY markers once each, BEGIN first; Rec-application checklist: recs 1, 3, 4, 5 APPLIED; rec 2 DEFERRED (quote-rule reading needs a user answer); 0 CUT lines |
| `04-judge-pass2.md` | Judge | Overall 7/10, Verdict: CONTINUE; fidelity table confirms `Alex Morgan`, `[TITLE: Alex to choose]`, `five bullets`, `[TBD]`, quote rule and review gate all preserved verbatim; no invented facts |
| `03b-brian-rewrite.md` | Brian | APPLIED rec 2 ("Return the draft to Alex."); DEFERRED recs 1 and 3 (awaiting user answers); no user facts filled or invented |

**Outcome:** Judge never issued STOP. Scores: 5/10 → 7/10 → 8/10, all CONTINUE. The run stopped at round 3 (below the 4-round cap) because rec 1 (resolve the quote rule) is blocked on a user answer — per Directive 2, the orchestrator does not invent a reading and asks the user only when the answer changes the work. No `05-final.md` exists yet (correct: extraction happens only at STOP). Open item carried to the user: choose quote-rule reading (a) "Quote Alex verbatim." or (b) "Keep quotes verbatim from Alex's notes."

Result: **PASS** (run executed correctly and stopped per rules; the only missing artifact, `05-final.md`, is conditional on STOP which requires the user's quote-rule decision).

---

## Test 3 — Full-mode dry run

Request: "a bot that turns meeting notes into five bullets" → Full mode.

| File | Writer | Result |
|---|---|---|
| `01-metapod.md` | Metapod | `runs/2026-10-15-meeting-bullets-bot/01-metapod.md`; line 1 is `=== SYSTEM PROMPT ===`, `=== TASK PROMPT ===` present; all System headings and 4 Task fields present; no text outside the two prompts; worked few-shot with an edge case |
| `02-judge-pass1.md` | Judge | Overall 8/10, Verdict: CONTINUE; 5 numbered recs with exact old→new wording; each section justification cites a quote |
| `03-brian-rewrite.md` | Brian | All 5 recs APPLIED; BODY markers present; 0 CUT lines; growth ~40 words, under ~15% cap |
| `03b-brian-rewrite.md` | Brian | Round 2 rewrite; optional recs DEFERRED (not selected by user); required recs 1-2 from pass 2 pending |
| `04-judge-pass2.md` | Judge | Overall 8/10, Verdict: CONTINUE; REQUIRED recs 1-2 (example fidelity fixes + non-notes single-sentence fix); optional recs 3-4 |
| `04b-judge-pass3.md` | Judge | Overall 9/10, **Verdict: STOP**; "No required fixes; decision-ready." |

`05-final.md` extracted from the BODY of the latest Brian file (`03b-brian-rewrite.md`, lines between `<!-- BEGIN BODY -->` and `<!-- END BODY -->`), with each marker asserted to appear exactly once and BEGIN first. The checklist below END is excluded. File written at `runs/2026-10-15-meeting-bullets-bot/05-final.md` (7,251 bytes).

Score history (Full mode):
- `02-judge-pass1.md`: 8/10, CONTINUE
- `04-judge-pass2.md`: 8/10, CONTINUE
- `04b-judge-pass3.md`: 9/10, STOP

Result: **PASS**. `01-metapod.md` contains `=== SYSTEM PROMPT ===` and `=== TASK PROMPT ===`; the run ended in STOP at pass 3.

---

## Test 4 — Exact-replace test

`scripts/exact_replace.py` invoked against a copy of `05-final.md`.

| Case | old-string count | Expected | Result |
|---|---|---|---|
| Single match: `[PASTE MEETING NOTES OR TRANSCRIPT HERE]` → `[PASTE YOUR NOTES HERE]` | 1 | APPLY | **PASS** — applied, exit 0 |
| Zero match: `does not appear anywhere in this file` → `replacement` | 0 | STOP, nothing written | **PASS** — `STOP: fix 1 old string found 0 times`, exit 1, file unchanged |
| Multi match: `the` → `THE` | 67 | STOP, nothing written | **PASS** — `STOP: fix 1 old string found 67 times`, exit 1, file unchanged |

The script writes nothing unless every fix matches exactly once. Original `05-final.md` left unmodified.

Result: **PASS**.

---

## Test 5 — Loop cap test

Cap rule (from SKILL.md "Orchestrator rules", rule 2): at most 4 Judge–Brian rounds; if Judge has not said STOP by then, stop and report the score history, unresolved must-fixes and best candidate, and let the user decide.

Simulation: a stub Judge returning CONTINUE for four consecutive rounds. The orchestrator would run rounds 1–4 (Metapod/Brian/Judge each in a separate context), then stop at the cap without a 5th Judge call, reporting:
- score history (four CONTINUE lines),
- unresolved must-fixes,
- best candidate so far,
- "let the user decide."

Neither dry run reached the cap: the Full run reached STOP at round 3, and the Optimize-only run stopped at round 3 awaiting a user decision on the quote rule. The cap is therefore verified as a bound that was not triggered.

Result: **PASS** (cap rule present in SKILL.md; demonstrated as not-triggered by both dry runs, both of which stopped at round 3).

---

## Test 6 — Independence check

Confirmed from the Judge scorecards' own access/isolation notes:

- `runs/2026-10-15-meeting-bullets-bot/04-judge-pass2.md` ("Execution Provenance" / "Independence statement"): Judge read only `judge-dredd/SKILL.md`, `01-metapod.md`, `02-judge-pass1.md`, `04-judge-pass2.md`, and `03b-brian-rewrite.md:1–106` (END BODY included; checklist excluded). "No other agents' private reasoning was provided to this judge." "Prior files unchanged." No subagents used by Judge.
- `runs/2026-10-15-meeting-bullets-bot/04b-judge-pass3.md` ("Access and isolation"): read only `judge-dredd/SKILL.md`, `01-metapod.md`, `02-judge-pass1.md`, `04-judge-pass2.md`, `03b-brian-rewrite.md:1–106`; "no other stages' private reasoning supplied; no other skills or sessions read; no subagents."

Judge never shared a context with the stage it grades and never saw Brian's or Metapod's reasoning — only the files.

Result: **PASS**.

---

## Summary

| Test | Result |
|---|---|
| 1 Structure check | PASS |
| 2 Optimize-only dry run | PASS (stopped at round 3, CONTINUE, awaiting user quote-rule decision) |
| 3 Full-mode dry run | PASS (STOP at pass 3, score 9/10; `05-final.md` extracted) |
| 4 Exact-replace test | PASS (single applies; 0/multi stops, nothing written) |
| 5 Loop cap test | PASS (cap is 4 rounds; neither run reached it) |
| 6 Independence check | PASS (Judge isolated, file-only inputs) |

Open item carried forward: Test 2's quote-rule rec 1 is DEFERRED pending the user's choice between reading (a) and (b). Offer deployment in one sentence only if the user explicitly asks; nothing was deployed.
