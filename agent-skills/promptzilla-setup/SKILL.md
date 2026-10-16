---
name: promptzilla-setup
description: Install, configure, update, or self-host Promptzilla — the prompt-engineering MCP server. Use when the user wants to add Promptzilla to an MCP client (Claude Code, Claude Desktop, Cursor, or any MCP-capable agent), verify an existing installation, update to the latest version, or deploy the optional private Cloudflare Workers remote.
---

# Promptzilla setup

Promptzilla is an MCP server exposing five prompt-engineering skills (tasker,
metapod, judge-dredd, brian-spillner, prompt-pipeline) plus a durable
optimization pipeline. The connected AI client executes the skills; the server
needs **no API key and no model account**.

## Step 1 — Preflight

- Check `node --version`. Promptzilla requires **Node.js 22.12 or newer**.
  If too old, install a current LTS (via `nvm install 22` or the system package
  manager) before continuing. Note that on some machines `node` resolves to an
  older runtime while a newer one exists (e.g. under a version manager); prefer
  the newer binary.
- Python is **not** required at runtime.

## Step 2 — Choose an install mode

Ask only if the user hasn't implied one:

- **A. Zero-install (recommended):** run from npm with `npx`. Nothing to clone.
- **B. From source:** clone the repo for hacking or auditing the code.
- **C. Cloudflare self-host:** private authenticated HTTP endpoint. Choose only
  if the user wants a remote server; it requires their own Cloudflare account.

## Mode A — Zero-install

1. Validate: `npx -y promptzilla --validate` must print
   `Validated 5 skills and 9 source assets.` If it fails, stop and report the
   error; do not improvise a fix.
2. Add the server to the user's MCP client (merge; never overwrite existing
   entries or other servers):

   ```json
   {
     "mcpServers": {
       "promptzilla": { "command": "npx", "args": ["-y", "promptzilla"] }
     }
   }
   ```

   - **Claude Code:** prefer the CLI: `claude mcp add promptzilla -- npx -y promptzilla`
   - **Claude Desktop:** `claude_desktop_config.json`
   - **Cursor:** `mcp.json` in settings
   - **Other clients:** command `npx`, args `-y promptzilla`, stdio transport.
3. Tell the user to restart/reconnect the client, then confirm it shows
   13 tools, 5 prompts (`tasker`, `metapod`, `judge-dredd`, `brian-spillner`,
   `prompt-pipeline`) and `promptzilla://` resources.
4. Runs persist in `~/.promptzilla-mcp/runs`. Optional flags:
   `--runs-dir PATH` (or `PROMPTZILLA_RUNS_DIR`) to relocate them;
   `--skills-dir PATH` to use a customized skill catalog.

## Mode B — From source

1. `git clone https://github.com/andymccutcheon/promptzilla-mcp.git && cd promptzilla-mcp`
2. `npm ci && npm run build && node dist/cli.js --validate`
3. Point the client at `node <absolute-repo-path>/dist/cli.js` (stdio).
4. Run the full verification if the user will modify code: `npm run check`.

## Mode C — Cloudflare self-host

Only proceed with all of: Node 22.12+, the repo cloned (Mode B steps 1–2 done),
the `cf` CLI authenticated (`cf accounts list` works), and a Cloudflare account
with Workers + Durable Objects.

1. If `cf accounts list` shows more than one account, have the user pick one and
   export `CLOUDFLARE_ACCOUNT_ID=<that account id>`. With one account, skip.
2. `npm run worker:secrets` — generates a private credential under `.secrets/`
   (never commit or print it; set `PROMPTZILLA_OWNER` first if the user wants a
   specific owner ID).
3. `npm run worker:deploy` — builds and deploys; note the printed
   `https://<worker>.<subdomain>.workers.dev` URL.
4. `npm run worker:verify -- <URL>/mcp` — must end in `Live verification PASS`.
   It writes the ready-to-use HTTP client entry (with bearer header) to
   `.secrets/remote-mcp.json`.
5. Merge that entry into the user's MCP client config (Streamable HTTP,
   `Authorization` header). Operations details are in the repo's `CLOUDFLARE.md`.

## Updating

- Mode A: `npx -y promptzilla@latest --validate` (npx resolves the latest
  published version each time the tag is used).
- Mode B: `git pull && npm ci && npm run build`.
- Mode C: pull, then `npm run worker:deploy && npm run worker:verify -- <URL>/mcp`.
  Keep the `PipelineRun` Durable Object export name unchanged or existing run
  data becomes unreachable.

## Troubleshooting

| Symptom | Action |
|---|---|
| `--validate` says Node too old | Install Node ≥22.12; ensure the client launches that runtime (absolute path to the newer node if several are installed). |
| `npx` cannot find the package | Check `npm view promptzilla version` and network/registry access. |
| Client shows no tools | Restart the client after editing config; validate JSON; run `npx -y promptzilla --validate` to isolate server vs client issues. |
| Remote `401` | Bearer credential wrong or missing; re-merge `.secrets/remote-mcp.json`. |
| Remote `503` | Deployment secret not set; re-run `npm run worker:deploy`. |

## Rules

- Never commit or print the contents of `.secrets/`.
- Never invent endpoints, account IDs, or credentials; ask the user for theirs.
- The server executes no LLM calls; if the user expects it to "run prompts by
  itself," explain that the connected agent executes skills in fresh workers.
