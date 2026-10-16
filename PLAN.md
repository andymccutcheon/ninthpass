# Promptzilla MCP — implementation plan

**Status: implemented and verified on 2026-10-15.** See `TEST-RESULTS.md` for
measured results, commands, and test boundaries. The original five skill markdown
files and both Python helpers were preserved.

**Cloudflare extension:** subsequently implemented and deployed. The hosting
plan, architecture and operations are documented in `CLOUDFLARE.md`.

## Goal and architecture

Turn the five existing `skills/*/SKILL.md` files into a locally runnable MCP
server. Preserve those files and the Python helpers as the source material.
Use the official TypeScript SDK v2, Zod validation, Node.js 22.12+, and stdio.
No model credentials, HTTP listener, or external service is needed.

The MCP host is the execution engine: a tool returns a skill's exact instructions
and a bounded input packet. The host runs the requested skill in a fresh worker
context and returns the output. The server never fabricates generated prompts or
scores. MCP sampling is not assumed because not every host supports it.

## Source inventory

| Skill | MCP contract |
|---|---|
| Tasker | Rough task → execution-ready instruction packet |
| Metapod | Request → system/task prompt generation packet |
| Judge Dredd | Prompt + optional fidelity source → evaluation packet |
| Brian Spillner | Prompt + scorecard → rewrite packet |
| Prompt Pipeline | Full/optimize-only orchestration plus persisted run state |

The original pipeline requires independent contexts. The server records distinct
worker IDs and an explicit fresh-context attestation, but a client is responsible
for actually providing isolation. Without fresh workers, the host must report a
blocker. The supplied verification documents are historical evidence, not tests
of this implementation.

## Build sequence

1. **Bootstrap and executable contracts**
   - Package metadata, lockfile, TypeScript, Vitest, coverage thresholds, CI.
   - Write failing tests before implementing catalog and pipeline behavior.
2. **Skill catalog**
   - Discover immediate skill folders, validate YAML metadata and folder/name
     agreement, fail clearly on invalid catalogs, read original instructions.
   - List/search with compact metadata; retrieve instructions and supporting
     text assets through allowlisted MCP resource URIs.
   - Expose five prompts and four standalone skill tools. Treat caller text as
     data using separate instruction and JSON input messages.
3. **Pipeline controller**
   - `prompt_pipeline` starts a full or optimize-only run; `pipeline_status`
     returns its state, artifacts, history, and next worker dispatch.
   - `pipeline_submit` validates one expected stage, worker provenance, required
     prompt sections, Judge score/verdict consistency and recommendations,
     Brian BODY/checklist structure, and confirmation results.
   - Persist stage text, briefs, provenance, history, and state in generated
     UUID run directories. Never accept caller-supplied filesystem paths.
   - Give Judge only Brian's exact BODY, original fidelity source, earlier
     scorecards, and separately extracted DEFERRED items.
   - Retry malformed stages once, preserve rejected attempts, then block.
   - Respect Judge STOP, cap at four scoring rounds, pause for user decisions
     on non-improvement after two rewrites. Explicit resume only; cap never
     resumes. Export best scored candidate as provisional on cap/blocker.
   - On STOP export scored input unchanged. Optional exact replacements must
     each match exactly once; publish a new immutable revision, dispatch a
     fresh Judge for diff-only confirmation, and preserve previous artifacts.
   - Atomic state replacement plus per-run lock; regenerate missing artifacts
     from canonical state; reject tampered artifacts. Bounded input/file sizes,
     traversal and symlink protection, no shell/script execution from tools.
4. **MCP integration and packaging**
   - Stdio CLI with absolute package-relative defaults, env/flag overrides,
     stderr-only diagnostics, graceful shutdown, clear help/validation mode.
   - Catalog and individual skill/asset resources. Typed tool inputs and JSON
     tool results with readable text and errors marked `isError`.
   - Client configuration examples and complete run instructions in README.
5. **Verification and handoff**
   - Unit/integration tests for catalog, validators, state transitions, retry,
     STOP/cap/pause, exact replacements, isolation packet boundaries, restart,
     concurrency, traversal/symlinks, and immutable outputs.
   - Real SDK client spawns the compiled CLI over stdio: initialization,
     tools/list, prompts/list/get, resources/list/read, tools/call, both pipeline
     modes, invalid calls, and final artifact round-trip.
   - `npm run check`, coverage with >=80% thresholds, `npm audit`, and package
     dry-run/install smoke check. Test the original Python helpers separately.
   - Record actual results and the distinction between protocol/state-machine
     tests with authored stage fixtures and live model-quality evaluations.

## Acceptance criteria

- All five skills are discoverable, with instructions matching source files.
- A real stdio client can discover and invoke tools, prompts, and resources.
- Full and optimize-only fixture runs produce correct immutable artifacts.
- Invalid or out-of-order output cannot advance a run; retries are bounded.
- Judge never receives Brian's checklist as part of the prompt to score.
- Only a valid Judge STOP authorizes a final; capped/blocked exports are labeled
  provisional; pending/failed confirmations are not reported as approved.
- An installed package finds its bundled skills from any working directory.
- Checks pass and setup requires no credentials. Actual prompt quality and
  independent worker execution remain host/model responsibilities.

## Design decisions and source ambiguities

- The pipeline's explicit ~15% growth instruction overrides Brian's standalone
  750-token guidance, as the pipeline itself requires. The server conveys this
  in the dispatch; it does not pretend word counts are exact token counts.
- Plateau comparison starts after two Brian rewrites, matching the supplied
  Python helper and the pipeline's final clarification (pass 3 onward).
- STOP-level recommendations are not applied automatically: the host explicitly
  supplies exact Judge-authorized replacements, followed by diff confirmation.
- Standalone skill tools prepare host execution; they are not hidden LLM calls.
- Future remote HTTP deployment/provider adapters are outside this local build.
