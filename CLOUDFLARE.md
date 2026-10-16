# Cloudflare implementation and operations

Promptzilla can be self-hosted as a private HTTP MCP server on Cloudflare
Workers, with each pipeline run persisted in a SQLite-backed Durable Object.
This document covers the architecture, deployment, and operations. Deploying is
optional — the npm package works locally over stdio without any Cloudflare
account.

## Architecture

1. Platform-neutral catalog, MCP registration and pipeline state machine live in
   `src/`. The filesystem adapter and local stdio CLI remain compatible.
2. The nine original skill/support assets are bundled at build time as an
   immutable generated catalog (`worker/skills.generated.json`).
3. A Worker serves MCP over Streamable HTTP at `/mcp` using the official SDK's
   web-standard handler, plus a minimal public `/health` endpoint.
4. Authentication uses high-entropy bearer credentials. Only credential hashes
   are stored in a Worker secret; every run is scoped to its authenticated
   owner. Client connection details stay in a local, gitignored, mode-0600 file.
5. Each run is persisted in a SQLite-backed Durable Object with atomic
   transactions. Canonical state is chunked into bounded BLOB rows to avoid
   SQLite row-size limits. Stale dispatches are rejected; original artifact
   contents are immutable.
6. Tests run in the actual Workers runtime: HTTP MCP clients, ownership
   isolation, invalid authentication, concurrency, persistence after runtime
   restart, caps, retries, pause/resume and exact fixes.

## Execution model

The host AI still performs generation, evaluation and rewriting in independent
fresh workers. Cloudflare serves the instructions and persists the workflow. No
model-provider credentials are needed. Authentication is private bearer access
for clients supporting custom HTTP headers; OAuth browser sign-in is not part
of this deployment.

## Deploy

Prerequisites: Node.js 22.12+, a Cloudflare account with Workers and Durable
Objects enabled, and the `cf` CLI logged in (`npm i -g cf && cf auth login`, or
use the project's devDependency via `npx cf`). If your login can access more
than one account, set `CLOUDFLARE_ACCOUNT_ID` in your environment; with exactly
one account it can stay unset.

From a clone of this repository:

```sh
npm ci
npm run check
npm run test:package
npm run worker:secrets     # creates .secrets/ with a private client credential
npm run worker:deploy      # builds, then deploys version + secret hash together
npm run worker:verify -- https://<your-worker>.<your-subdomain>.workers.dev/mcp
```

`worker:secrets` reuses the saved credential; it does not rotate it on each run.
Set `PROMPTZILLA_OWNER` to choose the owner ID (default `owner`).
`worker:deploy` uses `cf deploy --prebuilt --secrets-file` so the hash secret
and the Worker version upload together. A dry run is available with
`cf deploy --dry-run` after a build.

`worker:verify` creates explicitly labeled fixture runs in the live service and
stores their UUIDs in `.secrets/deployment-verification.json`. It never prints
the credential. Verification is deterministic protocol/workflow testing, not a
live model-quality evaluation. The fixture runs remain as small audit records.

## Connect a client

`worker:verify` writes the fully populated configuration, including the private
bearer credential, to `.secrets/remote-mcp.json` (mode `0600`, inside a
mode-`0700` directory, excluded from Git and npm packaging). Its entry has this
shape:

```json
{
  "mcpServers": {
    "promptzilla": {
      "type": "http",
      "url": "https://<your-worker>.<your-subdomain>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <private credential from .secrets/>" }
    }
  }
}
```

Different clients may use a different outer configuration format; the endpoint
and Authorization header are the same. The endpoint does not implement OAuth
browser login. Credentials in query strings or cookies are not accepted.

## Files and build

| File | Role |
|---|---|
| `cloudflare.config.ts` | Worker, SQLite DO lifecycle and bindings; deployed with `cf` |
| `vite.config.ts` | Cloudflare Vite build integration |
| `worker/index.ts` | Authenticated HTTP MCP endpoint and public health route |
| `worker/run.ts` | Durable Object RPC boundary |
| `worker/sqlite-store.ts` | Transactional, owner-checked, byte-chunked canonical state |
| `worker/auth.ts` | Bearer verification against SHA-256 hashes |
| `worker/skills.generated.json` | Build-generated immutable catalog, not hand-edited |
| `src/pipeline-engine.ts` | Shared platform-neutral workflow logic |
| `src/file-run-store.ts` | Filesystem adapter retained for local stdio |
| `src/mcp.ts` | Shared tool/prompt/resource registrations |

The Worker uses the official MCP SDK v2 web-standard handler. It accepts current
HTTP MCP and the SDK's stateless legacy Streamable HTTP fallback. Pipeline state
is independent of protocol sessions; clients can reconnect without losing runs.

The original nine source assets are bundled at build time. No runtime filesystem
or Python process is used by the Worker. Byte chunks keep SQLite rows bounded
and preserve UTF-8 even when a chunk boundary crosses an emoji's encoded bytes.

## Persistence and ownership

Every run is routed to a Durable Object named from the authenticated owner and
run UUID. The SQLite identity record independently checks both. A second valid
credential belonging to another owner cannot read or mutate a known run UUID.

All stage transitions execute in synchronous SQLite transactions. The canonical
run includes immutable artifact text, pinned skill instructions, score history
and provenance. Runtime eviction or deployment does not erase it. Artifact URIs
remain `promptzilla://runs/{id}/{file}` and are retrieved over authenticated MCP
resource calls, not public HTTP downloads. No filesystem locks are used remotely.

Keep the `PipelineRun` export and binding stable on future deployments; changing
the namespace/export creates a different location for the existing run data.
Local filesystem runs are separate and are not automatically uploaded.

## Credentials and recovery

- `.secrets/client-credential.json`: raw private credential and stable owner ID.
- `.secrets/cloudflare-secrets.json`: deployment file containing only hashed
  credentials in the secret binding.
- `.secrets/remote-mcp.json`: ready-to-use remote client entry with Authorization.
- Losing the raw credential does not delete runs. Deploy a replacement hash for
  the **same owner** to retain access. Multiple distinct hashes may share an
  owner for rotation; duplicate hashes across owners are rejected.
- Missing/malformed authentication configuration returns `503`; missing or
  invalid bearer credentials return `401`. Cross-origin browser requests are
  rejected. Private responses use `Cache-Control: no-store`.
- HTTP request bodies are bounded at 4 MiB; tool inputs retain their 200,000
  character limit; canonical run state is bounded at 16 MB.

The service uses your own Cloudflare account and its normal Workers/Durable
Objects usage billing. No additional database, R2 bucket or model API is needed.
