# The structural contract defect, found by review

**Date:** 21 October 2026. **Status:** repaired in code; the historical run is preserved unchanged.

## What happened

The published example run — `landing-pages/ninthpass/examples/runs/meeting-notes/` — was produced before
rewrites were checked against the prompt's structural contract. In that run:

1. Compose returned a System Prompt block and a Task Prompt block. `validateGenerated` requires both, so
   this stage was valid.
2. The second Judge scored the result 8/10 and recommended, as recommendation 1: *"Remove Task Prompt
   section entirely or convert to cross-reference."*
3. The revision removed the Task Prompt block and promoted the two rules it had carried into the System
   Prompt's Operating Constraints. `validateRewrite` accepted it, because it checked only BODY markers and
   the recommendation checklist.
4. The third Judge scored that System-only artifact 9/10, STOP.

So the artifact the pipeline approved **did not satisfy the structural contract that Compose is held to**,
and the code did not notice. The removal was not a stray failure: it was the reviewer's own instruction,
carried out faithfully. That is the defect — a recommendation could silently override a deterministic
output contract.

## What is preserved, and what changed

**Preserved.** The run's files, its scores, its verdict and its provenance are untouched. It passed under
the validator that existed at the time; relabelling it retrospectively would falsify a record, which is
the one thing this product promises not to do.

**Changed.** Future runs cannot repeat it.

- `validateStructure(text, required)` is the single structural contract, used by both
  `validateGenerated` and `validateRewrite`. It requires the blocks in order, with their sections, and
  rejects a missing, empty, duplicated, malformed or reordered block.
- The requirement is **mode-aware**: full mode requires both blocks. Optimize-only requires whatever
  shape its input had, so a System-only prompt can be optimized as a System-only prompt.
- The revise stage is told that the structural contract outranks a recommendation: keep the block, remove
  the redundancy inside it, and mark the conflicting recommendation `DEFERRED` with the reason.
- The Judge is told not to recommend deleting a required block or section; where content is redundant, it
  recommends consolidating inside the existing structure.
- The rejection message is written for the retry, not for a log: it names the missing block and tells the
  reviser to preserve it and defer the recommendation.

## Regression tests

`tests/validation.test.ts` now covers: deletion of either block; an empty, duplicated, malformed or
reordered block; a valid consolidation that keeps both blocks; the retry message; optimize-only inputs
that carry one block or none; and a requirement preserved across repeated revisions.

## Two words this product should keep apart

- **Structural validity** — deterministic. The artifact satisfies the required contract. Checked by code.
- **Instruction quality** — model-evaluated. The artifact has been reviewed against the rubric. Judged by
  a model.

Neither implies the other. **A score of 9 never compensates for a failed structural check**, and a
structurally valid artifact is not thereby a high-quality one. The pipeline now enforces the first half of
that sentence in code; the second half belongs in how results are described.
