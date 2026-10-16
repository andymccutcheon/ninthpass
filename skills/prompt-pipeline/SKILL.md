---
name: prompt-pipeline
description: Runs a prompt through Metapod (generate), Judge Dredd (score) and Brian Spillner (rewrite) until Judge says STOP at an overall score of 9 or higher. Use when the user wants a new prompt built and polished, or wants an existing prompt scored and improved.
---

# prompt-pipeline

Orchestrates three skills: `metapod`, `judge-dredd` and `brian-spillner` (sibling folders: `../metapod/SKILL.md`, `../judge-dredd/SKILL.md`, `../brian-spillner/SKILL.md`). It orchestrates only. It does not score, rewrite or generate prompts itself.

## Modes

**Full:** the user has an idea or request, not a prompt.
1. `metapod` generates the prompt (System Prompt and Task Prompt).
2. `judge-dredd` scores it (pass 1).
3. If Judge says CONTINUE: `brian-spillner` rewrites it using Judge's numbered recs.
4. `judge-dredd` re-scores the rewrite body.
5. Repeat 3 and 4 until Judge says STOP or the loop cap is reached.

**Optimize-only:** the user already has a prompt. Skip Metapod. Save the user's prompt as `00-original.md`, then run Judge (pass 1), Brian, Judge, repeating until STOP.

Choose the mode from the input: a prompt the user wrote or pasted means Optimize-only; a request to create one means Full. If unclear, say which you chose in one sentence and go on. If the user gives a prompt but wants it rebuilt from scratch, use Full.

**STOP criterion:** Judge's verdict is STOP, which Judge issues when the overall score is 9.0 or higher on its locked rubric. Do not decide STOP yourself and do not override Judge's verdict.

## Working directory and stage files

Create one directory per run: `runs/<YYYY-MM-DD>-<short-slug>/`.

| File | Written by | Contents |
|---|---|---|
| `00-original.md` | Orchestrator (Optimize-only) | The user's prompt, byte for byte |
| `01-metapod.md` | Metapod (Full) | System Prompt and Task Prompt |
| `02-judge-pass1.md` | Judge | First scorecard |
| `03-brian-rewrite.md` | Brian | Rewrite between `<!-- BEGIN BODY -->` and `<!-- END BODY -->` plus Rec-application checklist |
| `04-judge-pass2.md` | Judge | Re-score of the rewrite body |
| `05-final.md` | Orchestrator | The final prompt, extracted from between the BODY markers |
| `06-judge-confirmation.md` | Judge | Diff-only confirmation after must-fixes (only if any were applied) |

A scoring round starts with Judge: pass 1 counts toward the four-round cap; at most three Brian rewrites follow. Later rewrites get letter suffixes: `03b-brian-rewrite.md`, `04b-judge-pass3.md`, `03c-brian-rewrite.md`, `04c-judge-pass4.md`. Never overwrite a stage; retries use a new `-retry` suffix. From rewrite 2, Brian rewrites the latest BODY.

**Extracting `05-final.md`:** take bytes strictly between the latest Brian file's BODY markers. Assert each marker occurs once and BEGIN comes first; otherwise treat it as a Brian failure. Exclude the checklist. Use `python3 scripts/stage_control.py extract <Brian-file> <05-final.md>`; it refuses overwrite. For pass-1 STOP, copy the scored input unchanged. At a cap or blocker, export the best scored BODY as provisional, explicitly not STOP-approved.

## Invoking the sub-skills

- Run each stage in a **separate subagent or fresh context**. Judge never shares a context with the stage whose output it grades, and never sees Brian's or Metapod's reasoning, only the files.
- Give Judge only the bounded BODY of a Brian file, never its checklist or working notes; pass DEFERRED items separately. Log dispatch IDs, briefs, input paths/ranges and output paths. If fresh contexts are unavailable, report the blocker.
- Pass files by path. Each stage reads its inputs from the working directory and writes its own output file.
- Each subagent gets: "Read `<path to sub-skill SKILL.md>` and follow it exactly. Do not read other skill files." plus a short brief from the templates below. Briefs carry the user's priorities and constraints. They do not change the sub-skill's rules and must not add scoring bands.
- Do not do a stage's work yourself, even when it looks trivial.

### Brief templates (fill in, keep short)

- **Metapod:** "Request: <user's request, verbatim>. Write only your output to <01-metapod.md>."
- **Judge pass 1:** "Input: <file>. Mode: <Full or Optimize-only>. Write your scorecard to <02-judge-pass1.md>. User priorities: <list or none>. Constraints for your recs: keep every user-supplied fact, placeholder and decision exactly as written; invent no facts; growth cap about 15% over the original unless you require more. Give STOP when overall is 9 or higher."
- **Brian:** "Rewrite <input file>. Apply all numbered recs in <Judge file>. Write to <03-brian-rewrite.md> with the prompt between the BODY markers and the Rec-application checklist, including CUT justifications, below. User priorities: <list>. Keep every user-supplied fact verbatim in meaning; invent none. Length: the growth cap (about 15% over the original unless the recs require more) governs instead of the 750-token limit."
- **Judge pass 2+:** "Score the BODY section of <Brian file> against <original or Metapod file> and your <earlier scorecards>, using the same rubric and criteria. Check fidelity (settled decisions, rules, placeholders preserved, no invented facts) and growth versus the original. Write to <04-judge-pass2.md> with STOP or CONTINUE and exact must-fixes (verbatim old -> new). <DEFERRED recs from Brian's checklist, if any.>"
- **Judge confirmation:** "For each replacement below, confirm the after-text is exactly the wording you specified and nothing else drifted. Before/after pairs: <pairs>. Write PASS or FAIL per pair to <06-judge-confirmation.md>."

## Must-fixes after a STOP-level score

When Judge scores 9.0 or higher but lists one or two small must-fixes, or optional fixes, with exact wording:

1. Apply each fix to `05-final.md` yourself, **verbatim**, as an exact replace: assert the old string appears **exactly once**, replace it with the new string, write the file back. If the old string appears zero times or more than once, stop and report it. Do not guess or fuzzy-match. `scripts/exact_replace.py` does this and writes nothing unless every fix matches exactly once.
2. Apply only fixes Judge listed. Apply optional fixes only if Judge marked them for application or the user asked.
3. Start a fresh Judge subagent for a **diff-only confirmation**: give it the before and after text of each replacement (not the whole prompt). Write its answer to `06-judge-confirmation.md`.
4. If the confirmation fails, report the mismatch to the user. Do not loop again for a one-line difference.

If the must-fixes are large, or the verdict is CONTINUE, send them to Brian as a normal round instead.

## Orchestrator rules

1. **Show your work.** After each stage, paste that stage's output to the user (scorecard, rewrite and checklist, and so on) with the file name and score.
2. **Loop cap:** at most 4 scoring rounds, including pass 1; a failure-handling retry replaces that round's decision, not its history. On four CONTINUE verdicts, report score history, unresolved must-fixes and best candidate. Let the user decide. Use `scripts/stage_control.py decide <history.json>` for cap/plateau bookkeeping; it never scores.
3. **Never invent facts.** If an input is missing, use a labeled placeholder such as `[TBD]` and carry on. Ask the user only when the answer changes the work.
4. **Keep user-supplied facts verbatim.** Names, numbers, dates, placeholders and decisions the user gave pass through every stage unchanged. If a stage output changes one, send it back or restore the user's text with an exact replace.
5. **Do not edit stage outputs** except for the exact-replace step and extracting `05-final.md`.
6. **Do not edit the sub-skills** during a run.
7. **Deployment is a separate step.** Do not create an agent, publish, send or save the prompt to any live system unless the user explicitly asks. When asked, do exactly what they named.
8. Keep your own messages short and plain.

## Failure handling

- **Stage output missing a required part** (no BODY markers, no checklist, no verdict line, no numbered recs): rerun that stage once with a brief that names the missing part. If it fails again, stop and report.
- **Judge says CONTINUE with no actionable recs:** rerun Judge once asking for exact wording for each must-fix. If still none, stop and report.
- **Brian's checklist shows DEFERRED recs:** show them to the user and pass them to Judge in the next brief. Do not re-send them to Brian unless Judge asks.
- **Brian's rewrite lost user facts or placeholders** (Judge's fidelity check says so): send Judge's list back to Brian as a normal round.
- **Score does not improve between two consecutive rounds:** report it after round 2 and ask whether to continue, rather than waiting for the cap.
- **A subagent errors or times out:** retry once, then report the failure and the files written so far.
- Count plateau comparisons after two Brian rewrites, excluding validation retries. A required user decision remains unresolved: report it; never fabricate an answer to finish a dry run.
- Always leave the working directory intact.

## Final deliverable

Show the user:
1. The final prompt (contents of `05-final.md`) in one fenced block, with the file path.
2. The score history, one line per scoring pass: file, overall score, key sub-scores if Judge gave them, verdict.
3. Any fixes applied by exact replace, and Judge's confirmation result.
4. Open items: DEFERRED recs, unresolved must-fixes, placeholders still in the prompt.

Ask nothing further unless a decision is needed. Offer deployment in one sentence; do not do it.
