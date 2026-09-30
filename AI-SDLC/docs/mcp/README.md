# MCP servers in this repository

Module: `06-mcp-and-tooling-architecture`. Format facts come from `build/CLAUDE_CODE_FACTS.md` section 5 and https://code.claude.com/docs/en/mcp (fetched 2026-09-30). Protocol facts come from https://modelcontextprotocol.io/specification (revisions 2025-11-25 and 2026-07-28, fetched 2026-09-30).

## What is configured

`AI-SDLC/.mcp.json` (project scope, committed) declares three servers:

| Server | Transport | What it gives agents | Credentials | Status of the endpoint |
|---|---|---|---|---|
| `github` | `http` | Repos, PRs, issues, Actions logs (official GitHub MCP server) | `Authorization: Bearer ${GITHUB_PAT}` | `https://api.githubcopilot.com/mcp/` is the default toolset URL in github/github-mcp-server `docs/remote-server.md` (checked 2026-09-30). Not called from this build container (no token). |
| `atlassian` | `http` | Jira issues (Atlassian Rovo MCP server) | `Authorization: Bearer ${ATLASSIAN_MCP_TOKEN}` | **Illustrative.** The URL defaults to `https://mcp.atlassian.com/v1/mcp` and can be overridden with `ATLASSIAN_MCP_URL`. Your Atlassian site may require OAuth (`/mcp` then "Authenticate") instead of a bearer token; check Atlassian's current setup guide. |
| `fhir-readonly` | `stdio` | Schema, suppressed counts, ids and fixture query plans over synthetic data | none | Local, in this repo: `mcp/fhir-readonly-server/server.mjs`. Tested (see below). |

Tool names follow `mcp__<server>__<tool>`, so the three servers produce `mcp__github__pull_request_read`, `mcp__atlassian__getJiraIssue`, `mcp__fhir-readonly__count_observations_by_code`. The GitHub and Atlassian tool names are the ones those servers exposed on 2026-09-30; servers rename tools, so confirm with `/mcp` before you write permission rules.

## Set up (per developer)

```bash
cd AI-SDLC
export GITHUB_PAT=...            # fine-grained PAT, read-only repo scopes for this repo
export ATLASSIAN_MCP_TOKEN=...   # or leave unset and authenticate through /mcp
node scripts/automation/check-mcp-config.mjs   # deterministic lint of .mcp.json, must print PASS
claude                             # first interactive run: approve the project servers when prompted
claude mcp list                    # fhir-readonly should show "Connected"
```

Unset variables are not fatal: `claude mcp list` prints `[Warning] [github] mcpServers.github: Missing environment variables: GITHUB_PAT` and still connects the other servers.

## How the approval gate works

`.mcp.json` servers are **project scope**: anyone who clones the repo gets the entries, but nobody gets them silently. Claude Code prompts in the first interactive session and shows `⏸ Pending approval (run 'claude' to approve)` until you do. Observed in this build container with Claude Code 2.1.285:

```text
$ claude mcp get fhir-readonly
  Status: ⏸ Pending approval (run `claude` to approve)
$ claude --settings mcp/permissions.settings-fragment.json mcp get fhir-readonly
  Status: √ Connected
```

The second command works because `enabledMcpjsonServers` came from `--settings`, one of the sources the docs say still counts in an untrusted folder (with user settings and managed settings). The same key committed in `.claude/settings.json` is ignored until you trust the workspace: a cloned repository cannot approve its own servers. `claude -p`, the Agent SDK and cloud sessions load project servers **without asking**, so for headless runs use `disabledMcpjsonServers` or `--strict-mcp-config --mcp-config <file>` to keep a server out.

Details and the permission rules: [permissions.md](permissions.md). When to reach for MCP at all: [decision-guide.md](decision-guide.md).

## The local fhir-readonly server

- Zero dependencies, Node 22. Newline-delimited JSON-RPC 2.0 over stdin/stdout; logs to stderr only.
- **Dual-era.** It answers the legacy `initialize` / `notifications/initialized` handshake (what Claude Code uses for stdio servers by default) and the 2026-07-28 stateless style (`server/discover`, per-request `_meta["io.modelcontextprotocol/protocolVersion"]`, `resultType`, `ttlMs`/`cacheScope` on list results, error `-32022` for an unsupported version).
- Four tools, all `readOnlyHint: true`, all with `additionalProperties: false`: `get_schema` (parsed from the real Flyway migrations), `count_observations_by_code` (groups under 5 reported as `<5`), `list_observation_ids`, `explain_query_plan` (named fixture plans only; no SQL input).
- Any argument that looks like a PHI selector or raw SQL (`sql`, `fields`, `mrn`, `name`, ...) is refused with `isError: true`. Every result passes `assertNoPhi()` before it is written.

Verify:

```bash
node mcp/fhir-readonly-server/test-client.mjs            # 23/23 checks passed
MCP_PROTOCOL_NEGOTIATION=auto claude mcp get fhir-readonly   # v2 runtime probes stdio with server/discover
```

Both eras were checked against the real Claude Code 2.1.285 client in this container: the default connection sent `initialize` with `protocolVersion: "2025-11-25"`; with `MCP_PROTOCOL_NEGOTIATION=auto` it sent `server/discover` first and then modern `tools/list`. An early version of the server omitted `ttlMs`/`cacheScope` and Claude Code reported `Connected · tools fetch failed`, which is how we learned those fields are required in 2026-07-28.
