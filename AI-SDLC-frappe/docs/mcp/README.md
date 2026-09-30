# MCP servers in this repository (Frappe edition)

Module: `06-mcp-and-tooling-architecture`. Format facts come from `build/CLAUDE_CODE_FACTS.md` section 5 and https://code.claude.com/docs/en/mcp (fetched 2026-09-30). Frappe facts come from `build/FRAPPE_FACTS.md` and the Frappe v15 source in the course bench (`/home/user/frappe-bench/apps/frappe`, 15.121.2).

## What is configured

`AI-SDLC-frappe/.mcp.json` (project scope, committed) declares three servers:

| Server | Transport | What it gives agents | Credentials | Status |
|---|---|---|---|---|
| `github` | `http` | Repos, PRs, issues, Actions logs (official GitHub MCP server) | `Authorization: Bearer ${GITHUB_PAT}` | `https://api.githubcopilot.com/mcp/` is the default toolset URL in github/github-mcp-server `docs/remote-server.md` (checked 2026-09-30). Not called from the build container (no token). |
| `atlassian` | `http` | Jira issues (Atlassian Rovo MCP server) | `Authorization: Bearer ${ATLASSIAN_MCP_TOKEN}` | **Illustrative.** URL defaults to `https://mcp.atlassian.com/v1/mcp`, overridable with `ATLASSIAN_MCP_URL`. Your Atlassian site may require OAuth (`/mcp`, then "Authenticate") instead of a bearer token. Tool names (`getJiraIssue`, `getAccessibleAtlassianResources`, ...) are the ones the Rovo server exposed on 2026-09-30. |
| `spice-site` | `stdio` | DocType schema with PHI flags, installed apps, suppressed aggregate counts from a Frappe site | `SPICE_SITE_API_KEY` / `SPICE_SITE_API_SECRET` of a read-only API user, from the environment | In this repo: `mcp/spice-site-server/server.mjs`. Tested offline (fixture mode) and against the course bench (live mode). See [spice-site-server.md](spice-site-server.md). |

Tool names follow `mcp__<server>__<tool>`: `mcp__github__pull_request_read`, `mcp__atlassian__getJiraIssue`, `mcp__spice-site__count_observations_by_code`. Servers rename tools; confirm with `/mcp` before you write permission rules.

## Set up (per developer)

```bash
cd AI-SDLC-frappe
export GITHUB_PAT=...                 # fine-grained PAT, read-only scopes on this repo
export ATLASSIAN_MCP_TOKEN=...        # or leave unset and authenticate through /mcp
node scripts/automation/check-mcp-config.mjs     # deterministic lint of .mcp.json, must print PASS
claude                                # first interactive run: approve the project servers when prompted
claude mcp get spice-site             # Status: √ Connected (fixture mode, no site needed)
```

`spice-site` starts in **fixture mode** (`SPICE_SITE_MODE` defaults to `fixture`): it answers from responses recorded on the course bench, so every learner gets the same numbers without a site. For **live mode** against your own bench, see [spice-site-server.md](spice-site-server.md#live-mode).

Unset variables without a default are warnings, not failures. With `GITHUB_PAT` and `ATLASSIAN_MCP_TOKEN` unset, Claude Code 2.1.285 printed:

```text
[Contains warnings] Project config (shared via .mcp.json)
 ├ [Warning] [github] mcpServers.github: Missing environment variables: GITHUB_PAT
 └ [Warning] [atlassian] mcpServers.atlassian: Missing environment variables: ATLASSIAN_MCP_TOKEN
```

The `spice-site` credentials use `${SPICE_SITE_API_KEY:-}` (empty default), so fixture-mode users get no warning. We checked with a logging wrapper that the server then receives an empty string, and the server treats empty or unexpanded (`${...}`) credentials as "not set" and refuses live calls with a tool error.

## How the approval gate works

`.mcp.json` servers are **project scope**: anyone who clones the repo gets the entries, nobody gets them silently. Observed in the build container (Claude Code 2.1.285):

```text
$ claude mcp get spice-site
  Status: ⏸ Pending approval (run `claude` to approve)
$ claude --settings mcp/permissions.settings-fragment.json mcp get spice-site
  Status: √ Connected
```

The second works because `enabledMcpjsonServers` came from `--settings`, a source that counts in an untrusted folder. The same key committed in `.claude/settings.json` is ignored until you accept the workspace trust dialog: a cloned repository cannot approve its own servers. `claude -p`, the Agent SDK and cloud sessions load project servers **without asking**; for headless runs use `disabledMcpjsonServers` or `--strict-mcp-config --mcp-config <file>`.

## Which protocol era Claude Code speaks

`spice-site` answers both the legacy handshake (`initialize`, `notifications/initialized`) and the 2026-07-28 style (`server/discover`, per-request `_meta` protocol version, `resultType`, `ttlMs`/`cacheScope`). We captured Claude Code 2.1.285 in this container with a logging wrapper around the server:

| Setting | First message Claude Code sent |
|---|---|
| none, clean config (no cached feature flags) | `initialize` with `protocolVersion: "2025-11-25"`, then `notifications/initialized`, then `tools/list` |
| none, this container's cached feature flags | `server/discover` with `_meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"` |
| `MCP_PROTOCOL_NEGOTIATION=auto` | `server/discover`; a server that does not answer it gets `initialize` next |
| `MCP_PROTOCOL_NEGOTIATION=legacy` | `initialize` with `protocolVersion: "2025-11-25"`, then `notifications/initialized`, then `tools/list` |

The Claude Code docs (mcp.md, env-vars.md) say the v2 client runtime probes HTTP servers by default and stdio servers only with `MCP_PROTOCOL_NEGOTIATION=auto`; `legacy` skips the probe for every server. The clean-config run matches that. The second row shows a feature flag Claude Code fetches switching stdio probing on for an account, so the default can change without a new version. Set the variable explicitly when the era matters, write servers that answer both eras, as this one does, and test both (`test-client.mjs` does).

More: [permissions.md](permissions.md) (rules, scopes, the Frappe side of permissions), [decision-guide.md](decision-guide.md) (script, Claude Code hook, bench command, scheduler job, MCP, skill or agent), [spice-site-server.md](spice-site-server.md) (the server, its API user, and its tests).
