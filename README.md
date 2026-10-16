# Promptzilla

[![npm](https://img.shields.io/npm/v/promptzilla)](https://www.npmjs.com/package/promptzilla)
[![verify](https://github.com/andymccutcheon/promptzilla-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/andymccutcheon/promptzilla-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/promptzilla)](https://github.com/andymccutcheon/promptzilla-mcp/blob/main/LICENSE)

An MCP server built from the five prompt-engineering skills in `skills/`. It
exposes skill instructions as tools, prompts and resources, and provides a
durable controller for the Metapod → Judge Dredd → Brian Spillner optimization
loop — locally over stdio, or self-hosted on Cloudflare Workers.

**The connected AI client executes the skills.** Standalone tools return
instructions and input packets; they do not secretly call an LLM. Pipeline tools
track isolated worker dispatches, validate returned output, enforce loop limits,
and persist artifacts. No API key or model-provider account is required.

## Install and run (zero-install, recommended)

Requires **Node.js 22.12+** (`node --version`). Then add Promptzilla to your
MCP client:

```json
{
  "mcpServers": {
    "promptzilla": {
      "command": "npx",
      "args": ["-y", "promptzilla"]
    }
  }
}
```

Client-specific setup:

| Client | How to add |
|---|---|
| Claude Code | `claude mcp add promptzilla -- npx -y promptzilla` |
| Claude Desktop | Settings → Developer → edit `claude_desktop_config.json`, merge the JSON above |
| Cursor | Settings → MCP → edit `mcp.json`, merge the JSON above |
| Any MCP client | Command `npx`, args `-y promptzilla`, stdio transport |

A ready-to-merge configuration is in [`examples/mcp.json`](examples/mcp.json).
Restart or reconnect your client, then confirm it lists 13 tools, 5 prompts and
the `promptzilla://` resources.

Validate any time without a client:

```sh
npx -y promptzilla --validate     # "Validated 5 skills and 9 source assets."
npx -y promptzilla --version
```

Pipeline runs are stored in `~/.promptzilla-mcp/runs` by default. Updating is
just re-running with the latest tag:

```sh
npx -y promptzilla@latest --validate
```

> **Agent-assisted install:** this repo ships an agent skill at
> [`agent-skills/promptzilla-setup/SKILL.md`](agent-skills/promptzilla-setup/SKILL.md).
> Copy it into your agent's skills directory (e.g. `~/.claude/skills/promptzilla-setup/`)
> and ask the agent to "install Promptzilla" — it walks through Node checks,
> client configuration, and optional Cloudflare self-hosting.

### Options

| Option | Environment variable | Default |
|---|---|---|
| `--skills-dir PATH` | `PROMPTZILLA_SKILLS_DIR` | Bundled `skills/` inside the package |
| `--runs-dir PATH` | `PROMPTZILLA_RUNS_DIR` | `~/.promptzilla-mcp/runs` |
| `--validate` | — | Validate catalog and exit |
| `--help`, `--version` | — | Print and exit |

Flags take precedence over environment variables. Relative override paths resolve
against the launching process's working directory. The bundled skills work from
any directory. Skill edits require a server restart; existing runs pin the stage
skill instructions they started with.

## From source

```sh
git clone https://github.com/andymccutcheon/promptzilla-mcp.git
cd promptzilla-mcp
npm ci
npm run build
node dist/cli.js --validate
npm start   # stdio server; point your client at `node <repo>/dist/cli.js`
```

Python 3 is needed only to test the original Python helper scripts; the MCP
server never launches Python or a shell.

## Self-host on Cloudflare Workers (optional)

Promptzilla can also run as a private, authenticated HTTP MCP server on
Cloudflare Workers with SQLite-backed Durable Object storage — no database or
model API needed. See [`CLOUDFLARE.md`](CLOUDFLARE.md) for architecture,
deployment, persistence and credential rotation. Quick path:

```sh
npm ci
npm run check
npm run worker:secrets     # generates a private client credential locally
npm run worker:deploy      # builds and deploys with the cf CLI (must be logged in)
npm run worker:verify -- https://<your-worker>.<your-subdomain>.workers.dev/mcp
```

## Tools

| Tool | Required arguments | Behavior |
|---|---|---|
| `list_skills` | none | Compact catalog |
| `search_skills` | `query` | Ranked keyword discovery; optional `limit` |
| `get_skill` | `name` | Full instruction packet |
| `tasker` | `task` | Prepare execution-ready task optimization |
| `metapod` | `request` | Prepare System + Task Prompt generation |
| `judge_dredd` | `prompt` | Prepare evaluation; optional `fidelity_source`, `earlier_scorecards`, `priorities` |
| `brian_spillner` | `prompt`, `scorecard` | Prepare complete rewrite; optional `priorities` |
| `prompt_pipeline` | `mode`, `input` | Create run; optional `priorities` |
| `pipeline_status` | `run_id` | Read history, artifact URIs and next dispatch |
| `pipeline_submit` | `run_id`, `dispatch_id`, `execution_id`, `fresh_context`, `output` | Validate output and advance/retry |
| `pipeline_pause` | `run_id`, `reason` | Pause current worker stage for a decision/blocker |
| `pipeline_resume` | `run_id`, `decision` | Resume the saved stage with the user's actual answer |
| `pipeline_apply_fixes` | `run_id`, `fixes` | Apply Judge-authorized exact old/new pairs, then request diff confirmation |

Tools return readable JSON in `content` and the same object in `structuredContent`.
Invalid input or operation failures return `isError: true`. Each tool advertises
whether it is read-only; no tool deletes files or runs arbitrary code. Text inputs
are bounded at 200,000 characters. Scorecards are validated for structure and
consistency, not semantic truth, completeness of evidence or model quality.

## Prompts and resources

Five MCP prompts use the source skill names:
`tasker`, `metapod`, `judge-dredd`, `brian-spillner`, `prompt-pipeline`.
All take `input`; Brian also requires `scorecard`. Optional string arguments are
`fidelity_source`, `priorities` and (for other skills) `scorecard`.
The skill instructions and JSON-encoded caller data are separate messages.
The `prompt-pipeline` prompt supplies the orchestration instructions; use the
pipeline tools below for durable run tracking.

- `promptzilla://catalog` — skills and supporting-asset inventory.
- `promptzilla://skills/metapod` — exact original `SKILL.md`, including YAML.
- `promptzilla://assets/prompt-pipeline/scripts/stage_control.py` — original
  helper, read-only; supporting documents and all skill files are also listed.
- `promptzilla://runs/{run_id}/{file}` — immutable artifacts; use the exact URIs
  returned by the tools. This template is discoverable through
  `resources/templates/list`; run files are not globally enumerated.

## Execute a pipeline end to end

Tell your MCP-enabled agent:

> Use Promptzilla to create and polish a prompt for a meeting-notes summarizer.
> Start a Full run, execute every dispatch in a fresh isolated worker, show each
> stage's output, submit it, and continue until STOP, a user decision, or the cap.

For an existing prompt, use `mode: "optimize-only"` and pass its exact text.
The server cannot create isolated AI workers itself. A host without fresh-context
workers must pause with a blocker; changing the worker ID does not create
isolation. Unique IDs and `fresh_context: true` are recorded attestations, not a
technical sandbox or proof of separate model execution.

### Protocol flow

1. Call `prompt_pipeline`:

   ```json
   { "mode": "full", "input": "Create a prompt for a meeting-notes bot" }
   ```

2. Read `dispatch.instructions` and `dispatch.input`. Run that skill in a fresh
   worker with no earlier worker conversation. Give it only this packet. Do not
   send the entire run or other skill files to the worker.
3. Show the worker output to the user, then call `pipeline_submit`:

   ```json
   {
     "run_id": "<id from start>",
     "dispatch_id": "<current dispatch.id>",
     "execution_id": "<unique actual worker/context ID>",
     "fresh_context": true,
     "output": "<worker's exact output text>"
   }
   ```

4. Repeat with the returned dispatch. Each attempt needs a new context/ID. A
   rejected output is retained and gets one retry; the second rejection blocks
   the run. Stale dispatches and reused worker IDs are rejected.
5. At `paused`, ask the user the actual question. Use `pipeline_resume` with
   their answer; do not manufacture an answer. `pipeline_pause` also handles
   unresolved user choices or unavailable isolated workers during any normal
   stage. It preserves the current stage and remaining retry budget.
6. At `completed`, show `final.text`, score history, DEFERRED items and unresolved
   placeholders. At `capped` or `blocked`, a best scored candidate may be exported
   as **provisional**, with `approved: false`.

Full runs start with Metapod. Optimize-only runs save `00-original.md` unchanged
and start with Judge. After CONTINUE, Brian rewrites and Judge re-scores the exact
BODY, without Brian's checklist. DEFERRED items are passed separately. Pass 1
counts toward the four-round maximum. Non-improvement after two Brian rewrites
(Judge pass 3) pauses for the user's decision. Only Judge's valid STOP at 9–10
approves the scored input; the server never invents scores or changes a verdict.

### Stage output contracts

- **Metapod:** exact `=== SYSTEM PROMPT ===` and `=== TASK PROMPT ===` markers,
  all 11 System headings and all 4 Task headings from the original skill.
- **Judge:** plain `Section Ratings`, section lines like
  `- Clarity: 8/10 — contains "notes".`, one `Overall Rating: 8/10 — reason`,
  one `Verdict: CONTINUE`, and `Recommendations` with sequential numbered recs
  (3–5 for CONTINUE; STOP may have fewer). STOP iff overall >=9.
- **Brian:** exactly one `<!-- BEGIN BODY -->` before one `<!-- END BODY -->`,
  nonempty complete prompt between them, followed by `Rec-application checklist`
  with a line for every rec: `1. APPLIED — where` or `1. DEFERRED — reason`.
  Interior whitespace, Unicode, trailing spaces and CRLFs are preserved.
- **Diff confirmation:** exactly one `1. PASS — reason` or `1. FAIL — reason`
  line for each proposed replacement. Any FAIL blocks approval.

Structural acceptance does not verify that a rewrite preserves all facts or
implements its recommendations. Those are explicit worker/Judge duties from the
source skills. Pipeline dispatches retain the source's growth guidance (about
15% unless recs require more), overriding Brian's standalone 750-token limit.

### Exact fixes after STOP

Fixes are explicit, never automatically inferred from a scorecard:

```json
{
  "run_id": "<completed run id>",
  "fixes": [{ "old": "notes", "new": "meeting notes" }]
}
```

Call `pipeline_apply_fixes` only for changes the user selected or Judge designated
for application. Each pair must match a quoted `"old" → "new"` or `"old" -> "new"`
pair in a Judge recommendation, and each old string must occur exactly once.
All fixes succeed or none are written. The immutable `05-final.md` is retained;
the new `05-final-fixed.md` is unapproved until a fresh Judge confirms the diff.
Submit that confirmation through `pipeline_submit` like other stages. The host
is responsible for distinguishing required, optional and user-selected fixes.

## Persistence and recovery

Each run lives at `<runs-dir>/<UUID>/` (default `~/.promptzilla-mcp/runs/<UUID>/`)
with private directory/file permissions:

- `run.json`: canonical state, pinned skill sources, history, provenance and
  dispatch briefs, plus artifact text for recovery.
- `00-original.md` (optimize-only) or `00-request.md` (Full).
- `01-metapod.md`, `02-judge-pass1.md`, `03-brian-rewrite.md`,
  `04-judge-pass2.md`, then letter-suffixed later stages.
- `-retry.md` stage files preserve retries and rejected outputs.
- `05-final.md`, optional `05-final-fixed.md`, `06-judge-confirmation.md`,
  or `05-provisional.md` at a cap/blocker with a scored candidate.

Use `pipeline_status` with the UUID to resume after a server restart. Never edit
stage files manually: changed artifacts are detected, missing derived files are
reconstructed from `run.json`. Atomic state replacement is the commit point;
per-run filesystem locks prevent two processes from advancing the same run.
If a process is killed while holding `.lock`, verify no process is still using
that run before removing that one stale lock. Uncommitted `.state-*.tmp` files
may be discarded after stopping the process. A successful MCP response confirms
the canonical state and derived artifacts were saved.

Catalog assets and run artifacts are allowlisted; arbitrary paths, symlinks and
oversized/non-UTF-8 files are rejected. The configured skills/runs roots and their
parent directories must be trusted local directories. This is a single-user
stdio service with filesystem permissions as its access boundary. Run data stays
on disk until you remove it; it can contain your prompt text. The server itself
does not send prompt data to external services.

## Test and package

```sh
npm run check
npm audit
npm pack --dry-run
npm run test:package
```

`check` compiles TypeScript, runs unit/integration/real-stdio-client tests with
>=80% coverage thresholds, and tests the unchanged Python helpers. Tests include
both modes, STOP/cap/pause, retries, isolation packet boundaries, exact fixes,
concurrent submissions, restarts, file recovery, tampering, symlinks and invalid
inputs. Stage fixtures are authored deterministic test data, **not live model
evaluations or proof of prompt quality**. CLI tests cover actual subprocess
startup, help/version, configuration precedence and arbitrary working directories.
CI runs on Node 22, 24 and 26 on Linux; results are recorded in
[`TEST-RESULTS.md`](TEST-RESULTS.md).

The suite also runs a real Workers runtime with SQLite-backed Durable Objects:
authenticated HTTP MCP, per-owner isolation, simultaneous submissions, workflow
caps/retries, exact-fix confirmation, and a multi-megabyte Unicode run surviving
a full runtime restart. `npm run test:worker-types` checks the Worker/config types.
The authentication and shared pipeline logic are measured in-process; the other
Worker-only modules are executed by workerd and are outside V8's coverage
instrumentation in the Node test runner.

`test:package` builds an actual tarball, installs it in a clean temporary
directory, verifies its bundled assets, and completes a real stdio fixture run
through the installed entry point. The temporary installation is removed on exit.

## Releases (maintainers)

The package publishes to npm as [`promptzilla`](https://www.npmjs.com/package/promptzilla).
Manual publish: bump `version` in `package.json`, run `npm run check`, then
`npm publish --access public`. Alternatively trigger the **publish** GitHub
Actions workflow, which runs the full check and publishes with provenance using
an `NPM_TOKEN` repository secret. Users update with `npx -y promptzilla@latest`.

The original source material is kept under `skills/`; server code is under `src/`;
Worker code is under `worker/`. The full implementation plan and acceptance
criteria are in [`PLAN.md`](PLAN.md).
