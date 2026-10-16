# Promptzilla — verification results

Latest verification: **2026-10-15/16 (local time)** for the public npm release
(`promptzilla` package). Runtime: official MCP TypeScript SDK server/client
**2.3.1**, `cf` 1.0.0-beta.17, Cloudflare Vite integration.

## Release verification (npm package `promptzilla`)

| Check | Actual result |
|---|---|
| Production, tests and Worker/config TypeScript checks | PASS |
| Full checks on installed Node 22.23.1 and Node 26.8.1 | PASS on both |
| Full TypeScript/Vitest suite | **33 passed across 7 files**, no skipped tests |
| Original Python helper suite | **4 passed** |
| Latest measured coverage | **96.49% statements, 92.54% branches, 100% functions, 99.44% lines** |
| `npm run test:package` (tarball → clean temp install → real stdio run) | PASS — 9 bundled assets, 5 prompts, 13 tools, `.bin/promptzilla --validate`, byte-exact final artifact |
| `npm pack --dry-run` | PASS — `promptzilla-1.0.0.tgz`, 59 files, ~64 kB; credentials, `.secrets/`, node_modules, build output excluded |
| Dependency audit | **0 known vulnerabilities** |
| Anonymization scan | PASS — no personal paths, emails, account IDs, deployment URLs or owner names in tracked files |
| `npm publish --access public` | PASS — **promptzilla@1.0.0** live at https://www.npmjs.com/package/promptzilla (tag `latest`, license MIT) |
| Registry metadata | PASS — version 1.0.0 published 2026-10-16T03:55:04Z; republish correctly refused |
| `npx -y promptzilla@latest` from clean directory | PASS — `--validate` (5 skills, 9 assets), `--version`, `--help` |
| Real MCP client → npx-installed server | PASS — **13 tools, 5 prompts, 15 resources** over stdio from the public registry |

## Cloudflare extension verification

| Check | Actual result |
|---|---|
| `cf build`, `cf deploy --dry-run` | PASS |
| Live Worker deployment | PASS (private deployment; endpoint intentionally not recorded in this public repo) |
| Cloudflare secret inspection | `PROMPTZILLA_CLIENTS` confirmed as `secret_text`; only credential hashes uploaded |
| Live remote SDK client | PASS — 13 tools, 5 prompts, 9 source assets |
| Live authenticated Full and optimize-only fixture runs | PASS — 8 → 9/STOP, byte-exact final resource retrieval |
| New client/session reading existing live runs | PASS |
| Live missing/invalid credentials | Rejected with `401` |

The Workers runtime tests use workerd/Miniflare with actual SQLite Durable Object
storage. They cover per-owner authorization, concurrent submissions, user pause
and retry budgets, four-round cap, exact replacements with fresh confirmation,
and recovery of a multi-megabyte Unicode run after a full runtime shutdown and
restart using the same durable storage. Separate auth tests cover missing,
malformed and ambiguous configuration failing closed with `503`.

Coverage is measured for Node-executed shared modules and authentication logic;
the remaining Worker-only code runs in a separate workerd process and is verified
behaviorally rather than counted as Node V8 coverage.

---

## Original local-server verification

Date: **2026-10-15**. Environment: macOS, Node **26.8.1**, npm **11.19.0**.

| Command/check | Actual result |
|---|---|
| Initial `npm test` before implementation | Failed: catalog, validation and pipeline modules did not yet exist (red phase) |
| `npm run build` | PASS — strict TypeScript production build |
| `npm run test:types` | PASS — source, tests and Vitest configuration typechecked |
| `npm run test:coverage` | PASS — **23 tests in 5 test files**, no skipped tests |
| `npm run test:helpers` | PASS — **4 Python tests** against the unchanged original helpers |
| `node dist/cli.js --validate` | PASS — **5 skills, 9 source assets** |
| Real SDK client → compiled stdio server | PASS — initialization, discovery, tool/prompt/resource calls, Full and optimize-only fixture workflows, byte-exact final resource retrieval |
| `npm run test:package` | PASS — packed and installed in a clean temporary directory, 9 bundled skill/support assets, 5 prompts, 13 tools, installed CLI validation, real stdio fixture run and final artifact round-trip |
| `npm pack --dry-run` | PASS — compiled CLI and original source skills included; Python bytecode excluded from final package file patterns |
| `npm audit` | PASS — **0 known vulnerabilities** at verification time |

## Behavior exercised

- All five original skills and supporting files discoverable; exact skill-source
  retrieval, keyword search, invalid/missing metadata and name/folder mismatch.
- Standalone skill execution packets, five MCP prompts with separated caller
  data, catalog resources and run artifact resources.
- Both pipeline modes; Metapod → Judge → Brian → Judge; unchanged pass-1 STOP
  export; latest rewrite BODY carried forward without checklist contamination.
- DEFERRED recommendations carried separately; four-round hard cap; best scored
  candidate exported as provisional; plateau pause after two rewrites; explicit
  user decisions preserved on resume.
- One validation retry per stage, immutable rejected outputs, stale dispatch
  rejection, distinct worker ID checks and fresh-context attestation requirement.
- User pause/resume preserving stage and retry budget; state recovery after a
  server/controller restart; pinned skill instructions.
- Exact fixes authorized by literal Judge replacement pairs, substring-spoof
  rejection, zero/multiple-match rejection, CRLF/Unicode preservation,
  all-or-nothing replacement, fresh diff-only confirmation, failed and malformed
  confirmation remaining unapproved.
- Concurrent submissions allow one advancement; traversal and symlink rejection;
  invalid/oversized input rejection; tampered artifacts detected; missing derived
  artifacts reconstructed from canonical state.
- Real CLI processes from another working directory; help/version; invalid flags;
  missing catalog failures; flags overriding environment configuration.
- Original Python helpers: BYTE-preserving BODY extraction, overwrite refusal,
  STOP/cap/plateau bookkeeping, invalid histories, exact replacement rollback.

## Test boundaries

Stage outputs are **authored deterministic fixtures**. No model API was called,
no model-generated score was claimed, and these tests do not prove real prompt
quality, factual fidelity or independent AI-worker isolation. The host supplies
the actual model execution and fresh worker contexts. The server records their
provenance and validates structural contracts.

## Reproduce

From the project root with Node.js 22.12+:

```sh
npm ci
npm run check
npm run test:package
npm audit
node dist/cli.js --validate
npx -y promptzilla --validate   # after npm publication
```
