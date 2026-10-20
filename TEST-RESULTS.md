# Test results — Promptzilla v2

> **Historical results.** The suite was run before the October 2026 skill rename. The
> commands and counts remain valid; skill names in the prose are the originals
> (`tasker` → `brief`, `metapod` → `compose`, `judge-dredd` → `judge`,
> `brian-spillner` → `revise`, `prompt-pipeline` → `loop`).

**Measured 2026-10-19** on macOS (Darwin), Node.js 22.23.1, npm 10.9.8.

## Automated suite

Command: `npm run check`

| Area | Result |
|---|---|
| Vitest files | **10 passed** |
| Vitest tests | **59 passed** |
| Statements | **94.10%** (591/628) |
| Branches | **86.61%** (369/426) |
| Functions | **95.49%** (106/111) |
| Lines | **97.74%** (476/487) |
| Python helper tests | **4 passed** (`stage_control.py`, `exact_replace.py`) |
| TypeScript build | PASS |
| Test type-check | PASS |

The suite covers:

- Catalog discovery, YAML validation, source pinning, malformed and symlinked catalogs.
- Judge score/verdict consistency, Metapod headings, Brian BODY/checklist contracts,
  exact all-or-nothing replacements.
- Full and optimize-only runs, STOP, four-round cap, plateau pause, one retry then block,
  stale dispatches, reused execution IDs, concurrent submissions, restart recovery,
  tampered artifacts and symlinks.
- Approved and provisional Markdown export, slugs, collisions, symlink and non-directory
  output paths.
- Install detection, multi-host install, dry-run, bundled skills, symlink rejection.
- Worker command construction, OpenCode JSON parsing, packet rendering, stdin handling,
  non-zero exits, missing binaries, timeouts, output caps and aborts.
- CLI help, version, validation, list, install, start, run, status, submit, pause, resume,
  fix, export and fixture test.

## Packaged install

Command: `npm run test:package`

**PASS** — packs the tarball, installs it into a clean temporary prefix, and verifies:

- 9 bundled assets (five `SKILL.md` files, `DRY-RUN.md`, `VERIFICATION.md`, two `.py`
  helpers), no `worker/` or run data.
- `promptzilla --version` prints `2.0.0`.
- `promptzilla validate` prints `Validated 5 skills and 9 source assets.`
- `promptzilla install --dir <temp>` installs all five skills and the Python helpers.
- A fixture Full run completes, is approved at 9/10, and writes the Markdown prompt.

## Live pipeline

Command:

```sh
promptzilla test --live --worker opencode --model deepseek/deepseek-flash
```

Execution: OpenCode 1.18.35, DeepSeek Flash, Full mode.

| Run | Request | Scores | Terminal state | Export |
|---|---|---|---|---|
| `4cd2abf2-51ec-462d-a4eb-6155be65f94c` | meeting-notes summarizer, five bullets | 8 CONTINUE, 8 CONTINUE, 8 CONTINUE | paused (plateau) | `.../write-a-prompt-for-a-meeting-notes-summarizer.provisional.md` |
| `cb6da055-02d8-4b08-84e4-4f7e5e46c865` | same request, resumed | 8, 8, 8, 8 | capped (four rounds) | `.../write-a-prompt-for-a-meeting-notes-summarizer-that.provisional.md` |

Both runs exercised the real skill files through separate OpenCode processes:

- Metapod produced a System Prompt and Task Prompt that passed the heading contract.
- Judge produced canonical section ratings, a score/verdict pair and numbered
  recommendations on every pass.
- Brian produced a complete BODY between the markers plus a checklist for every
  recommendation; Judge re-scored the body without the checklist.
- The plateau pause produced a provisional export; `run --resume` continued the same run,
  then the four-round cap produced a second provisional export.
- The CLI exited `0` for the live test, `2` for the plateau pause, and `3` for the capped
  run.

The live test passes when the pipeline reaches a terminal or decision state with a final
or provisional prompt. A **blocked** run is a failure: it means the model could not satisfy
a stage contract twice.

## What these tests do not prove

- Prompt quality. Judge legitimately capped both live runs at 8; the pipeline correctly
  refused to approve them.
- That every model will satisfy the stage contracts. The validators are strict by design,
  and a model that cannot follow the output shape will block after one retry.
- Independent isolation in manual mode. The CLI's built-in workers are separate processes;
  manual `submit` callers attest isolation themselves.
