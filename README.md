# Promptzilla

[![npm](https://img.shields.io/npm/v/promptzilla)](https://www.npmjs.com/package/promptzilla)
[![verify](https://github.com/andymccutcheon/promptzilla/actions/workflows/ci.yml/badge.svg)](https://github.com/andymccutcheon/promptzilla/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/promptzilla)](https://github.com/andymccutcheon/promptzilla/blob/main/LICENSE)

Five prompt-engineering skills and a durable optimization loop. Install the skills into
your agent with one command, or run the whole pipeline from the terminal with a fresh
process per stage.

Promptzilla does not call a model API itself and stores no credentials. The worker you
choose — OpenCode, Claude Code or Codex — already has its own authentication.

## Install the skills

Requires Node.js 22.12 or newer.

```sh
npx promptzilla install
```

The command detects the agent hosts on this machine and copies all five skills into each
one it finds:

| Host | Destination |
|---|---|
| Claude Code | `~/.claude/skills/<skill>/` |
| OpenCode | `~/.config/opencode/skills/<skill>/` |
| Shared agents | `~/.agents/skills/<skill>/` |

If none are found it installs to Claude Code. Re-run the same command to update; the five
skill folders are replaced. Use `--target`, `--dir` or `--dry-run` for control:

```sh
npx promptzilla install --target all
npx promptzilla install --target claude,opencode
npx promptzilla install --dir ./.claude/skills
npx promptzilla install --dry-run
```

The installed skills are `tasker`, `metapod`, `judge-dredd`, `brian-spillner` and
`prompt-pipeline`. Supporting files for the manual pipeline (`DRY-RUN.md`, the Python
helpers) are installed with `prompt-pipeline`.

## Run the pipeline

Full mode turns a rough request into a prompt, then scores and rewrites it until Judge
Dredd returns STOP at 9 or higher:

```sh
npx promptzilla run --request "Write a prompt for a meeting-notes summarizer that returns five bullets"
```

Optimize-only mode starts from a prompt you already have:

```sh
npx promptzilla run --prompt ./prompt.md
```

A trailing argument is shorthand for a Full request:

```sh
npx promptzilla run "Write a prompt for a release-notes generator"
```

The default worker is `opencode`. Choose another and pass a model when you want one:

```sh
npx promptzilla run --prompt ./prompt.md --worker claude --model claude-sonnet-4-5
npx promptzilla run --request "..." --worker codex --model gpt-5
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--priorities TEXT` | Constraints carried through every stage |
| `--out DIR` | Output directory (default `./prompts`) |
| `--name SLUG` | Override the exported filename |
| `--show-output` | Print each stage's full output |
| `--quiet` | Suppress stage progress |
| `--timeout MS` | Per-stage timeout (default 900000) |
| `--json` | Machine-readable result |

Exit codes: `0` approved, `2` paused for a decision, `3` capped or blocked with a
provisional candidate.

## Where the prompt goes

On STOP, the scored prompt is written to `./prompts/<slug>.md` (or `--out`). The file is
the prompt itself — no frontmatter, no commentary, ready to paste.

If the run caps at four scoring rounds, blocks on invalid output, or pauses because the
score stopped improving, the best scored candidate is written to
`./prompts/<slug>.provisional.md` and clearly reported as not approved. A plateau pause is
resumable:

```sh
npx promptzilla run --resume <run-id> --decision "Continue; resolve the count conflict first."
```

Every run also keeps a full record under `~/.promptzilla/runs/<run-id>/`: the original
input, each stage file, retries, scorecards, provenance and `run.json`. Use `--runs-dir`
to relocate it.

## Workers

Each stage runs in a separate process with only that stage's packet. That is real
isolation, not an attestation.

| Worker | Command | Notes |
|---|---|---|
| `opencode` | `opencode run --format json` | Reads the packet from stdin; captures the session ID |
| `claude` | `claude -p --output-format text` | Reads the packet from stdin |
| `codex` | `codex exec --skip-git-repo-check -` | Reads the packet from stdin |
| `fixture` | in-process | Deterministic; used by the test suite |

The worker must be installed and authenticated already. Promptzilla never reads or stores
provider keys.

## Manual mode

An agent that cannot spawn a worker can still use the durable engine. `start` creates a
run and prints the first dispatch; the agent executes `dispatch.instructions` with
`dispatch.input` and submits the exact output.

```sh
npx promptzilla start --request "Write a prompt for a meeting-notes summarizer" --json
npx promptzilla status <run-id>
npx promptzilla submit <run-id> --dispatch <dispatch-id> --output ./stage-output.md
npx promptzilla pause <run-id> --reason "Need a user decision"
npx promptzilla resume <run-id> --decision "Keep the current structure"
npx promptzilla fix <run-id> --old "notes" --new "meeting notes"
npx promptzilla export <run-id> --out ./prompts
```

`status --json` includes the active dispatch, so the packet can be handed to a fresh
worker without reading `run.json`. `fix` accepts repeated `--old`/`--new` pairs or
`--fixes FILE` containing `[{ "old": "...", "new": "..." }]`. Fixes must be quoted
exactly in a Judge recommendation, and a fresh Judge confirms the diff before approval.

## The five skills

| Skill | Job |
|---|---|
| `tasker` | Turn a rough task assignment into an execution-ready instruction |
| `metapod` | Turn a request into a System Prompt and a Task Prompt |
| `judge-dredd` | Score a prompt on a locked 0–10 rubric; STOP at 9+ |
| `brian-spillner` | Rewrite a prompt by applying every numbered recommendation |
| `prompt-pipeline` | Orchestrate the three pipeline skills manually |

The installed files are the source of truth. The CLI pins each run to the exact skill
text it started with, so editing a skill mid-run cannot change the current run.

## Pipeline rules

- **Metapod** must return one System Prompt and one Task Prompt with all required
  headings. It never performs the requested task.
- **Judge Dredd** returns section ratings with quoted evidence, one overall rating, a
  STOP or CONTINUE verdict, and numbered recommendations. STOP is valid only at 9 or
  higher; CONTINUE needs 3–5 recommendations.
- **Brian Spillner** returns the complete rewrite between one BEGIN and one END BODY
  marker plus a checklist accounting for every recommendation. Judge re-scores the body
  without seeing the checklist.
- A scoring round starts with Judge. Pass 1 counts toward the four-round cap.
- An invalid stage gets one retry. A second invalid output blocks the run and preserves
  the best scored candidate as provisional.
- A score that does not improve after two rewrites pauses for an explicit decision. It
  never invents one.
- Exact fixes after STOP are explicit, all-or-nothing, and confirmed by a fresh Judge.

## Testing

```sh
npm test              # 59 unit, integration and CLI tests
npm run check         # build, type-check, coverage, Python helper tests
npm run test:package  # pack, install into a clean directory, run the pipeline
npm run test:live     # real model through the real three-skill pipeline
```

`npm test` uses authored fixtures and does not spend model tokens. `npm run test:live`
runs Full mode against OpenCode and reports the score trajectory; it passes when the
pipeline reaches a terminal or decision state with a final or provisional prompt. A
blocked run — output that fails the stage contract twice — is a failure.

The live run proves the protocol, validation and state machine against real skill
output. It does not prove that a particular prompt is good; Judge can legitimately cap at
8.

## Library use

```ts
import { Catalog, Pipeline, executeRun, createWorker } from 'promptzilla';

const pipeline = new Pipeline(await Catalog.load('./skills'), './runs');
const result = await executeRun({
  pipeline,
  worker: createWorker('claude', { model: 'claude-sonnet-4-5' }),
  mode: 'optimize-only',
  input: 'You summarize notes.',
  outDir: './prompts',
});
```

`Pipeline` exposes `start`, `status`, `submit`, `pause`, `resume` and `applyFixes` for
manual orchestration. `Catalog` discovers and validates skill folders.

## Package and release

The package publishes to npm as [`promptzilla`](https://www.npmjs.com/package/promptzilla).
Bump `version`, run `npm run check`, then `npm publish --access public`, or trigger the
**publish** GitHub Actions workflow.

## Security and limits

- No API keys, no provider accounts, no remote service. Workers use their own auth.
- Run directories are created with owner-only permissions; run files are mode `0600`.
- Stage input is capped at 200,000 characters; worker output at 4 MB; each stage defaults
  to a 15-minute timeout.
- Symlinks, path traversal and artifact tampering are rejected.
- Prompt text stays on disk until you remove it. Run directories can contain private
  material.

## Migrating from 1.x

Version 1.x was an MCP server. Version 2 is a CLI and a library.

1. Remove the `promptzilla` entry from your MCP client configuration.
2. Run `npx promptzilla install`.
3. Use `npx promptzilla run ...` or the installed skills directly.
4. Old runs live under `~/.promptzilla-mcp/runs`; read one with
   `--runs-dir ~/.promptzilla-mcp/runs`. New runs default to `~/.promptzilla/runs`.
5. The Cloudflare Worker, HTTP transport and MCP-specific tools, prompts and resources are
   gone. The durable pipeline engine and all five skills remain.

The implementation plan and acceptance criteria are in [`PLAN.md`](PLAN.md). Measured
verification results are in [`TEST-RESULTS.md`](TEST-RESULTS.md).
