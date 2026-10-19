# Promptzilla v2 — CLI-native plan

**Status: implemented and verified on 2026-10-19.** Version 1 was an MCP server; version 2
removes the transport and makes the skills and the pipeline usable from the command line.
The five `skills/*/SKILL.md` files and both Python helpers remain the source material.

## Goal

Keep the durable Compose → Judge → Revise loop, drop the MCP and Cloudflare
surface, and make the product installable and runnable without a client integration:

1. `promptzilla install` copies the five skills into the agent hosts on the machine.
2. `promptzilla run` orchestrates the real skills with a fresh process per stage.
3. A STOP at 9 or higher writes a clean Markdown prompt; a cap, block or plateau writes a
   provisional candidate.
4. `promptzilla test --live` exercises the real pipeline programmatically.

## Architecture

```
skills/*/SKILL.md ──► Catalog (validate YAML, pin sources)
                         │
                         ▼
              PipelineEngine (state, validation, retries, cap)
                         │
          ┌──────────────┴───────────────┐
          ▼                              ▼
   Orchestrator (CLI)              Manual commands
   worker per stage                start/status/submit/pause/resume/fix
          │
          ▼
   ProcessWorker                  FixtureWorker
   opencode | claude | codex      deterministic tests
```

The engine is unchanged in behavior from v1: immutable artifacts, atomic state writes,
per-run locks, one retry per invalid stage, STOP only at 9+, four scoring rounds, explicit
plateau pause, exact Judge-authorized fixes with diff confirmation.

### Worker isolation

Every stage calls a new subprocess:

| Worker | Invocation |
|---|---|
| `opencode` | `opencode run --format json` with the packet on stdin |
| `claude` | `claude -p --output-format text` with the packet on stdin |
| `codex` | `codex exec --skip-git-repo-check -` with the packet on stdin |
| `fixture` | in-process deterministic responses |

The execution ID is the worker's session ID when it exposes one, otherwise a fresh UUID.
The engine still records `fresh_context: true`; with the CLI that attestation is backed by
an actual separate process.

### Install

`promptzilla install` walks the bundled `skills/` directory and copies each skill folder
into the targets it detects: Claude Code (`~/.claude/skills`), OpenCode
(`~/.config/opencode/skills`) and shared agents (`~/.agents/skills`). `--target`, `--dir`
and `--dry-run` override the behavior. The default when no host is detected is Claude
Code.

### Export

`exportRun` takes the terminal `run.final` and writes:

- `./prompts/<slug>.md` when the run is completed and approved;
- `./prompts/<slug>.provisional.md` otherwise.

The slug comes from the first meaningful line of the original input, lowercased, with
stopword trimming. The file is the prompt only — no frontmatter. A collision adds the run
ID prefix. Output directories are checked for symlinks and files are written atomically
with owner-only permissions.

## Acceptance criteria

- [x] All five skills are discoverable and validate from any working directory.
- [x] `install` copies the skills and their supporting files; `--dry-run` writes nothing.
- [x] A Full run calls Compose, Judge and Revise with a separate process per stage.
- [x] An Optimize-only run starts at Judge and preserves the input byte-for-byte on STOP.
- [x] Invalid output retries once, then blocks and preserves the best candidate.
- [x] STOP at 9+ exports an approved Markdown prompt.
- [x] Cap, block and plateau export a provisional Markdown prompt.
- [x] A plateau is resumable with an explicit decision.
- [x] Manual `start`, `submit`, `pause`, `resume`, `fix` and `export` work without a worker.
- [x] Fixture tests cover the full loop; `--live` runs the real skills.
- [x] No MCP dependency, no Cloudflare dependency, no API key required by Promptzilla.
- [x] The packaged tarball installs in a clean directory and runs the fixture pipeline.

## Decisions and trade-offs

- **Keep the durable engine.** The state machine and validators were the valuable part of
  v1; the MCP transport was a wrapper. The CLI reuses the engine rather than reimplementing
  the loop in a shell script.
- **Fresh process, not an attestation.** The host is responsible for isolation in manual
  mode. The built-in CLI can guarantee it, so it does.
- **Provisional on plateau.** A paused plateau previously produced no artifact. The best
  scored candidate is now exported as provisional on pause, cap and block. The run remains
  resumable; a later STOP replaces the provisional final with the approved one.
- **No automatic fixes.** Judge recommendations are not applied silently. `fix` requires
  explicit pairs that match a Judge recommendation, and a fresh Judge confirms the diff.
- **Workers are adapters, not providers.** Promptzilla never reads provider keys. Adding a
  new worker means a command builder and an output parser, not a new API client.
- **The live test is a protocol test.** It can pass on a provisional cap at 8. It fails on
  a blocked run, because that means the model could not satisfy the stage contract twice.
  Prompt quality remains a model and Judge decision.

## Removed in v2

- `src/mcp.ts`, `src/server.ts`, `src/packets.ts`
- `worker/`, the Cloudflare Vite config, `CLOUDFLARE.md`, the Cloudflare scripts
- `@modelcontextprotocol/*`, `cf`, `miniflare`, `@cloudflare/*`, `esbuild`
- The MCP-specific tests (`server`, `cloudflare`, `auth`)
- `agent-skills/promptzilla-setup` (replaced by `promptzilla install`)
- `examples/mcp.json`
