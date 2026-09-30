# MCP permissions, scopes and limits

Source of truth for formats: `build/CLAUDE_CODE_FACTS.md` sections 5 and 7. This page applies them to the three servers in `AI-SDLC/.mcp.json`.

## 1. Rule syntax for MCP tools

| Rule | Matches |
|---|---|
| `mcp__github` | every tool of the `github` server |
| `mcp__github__*` | every tool of the `github` server (glob after the literal `mcp__<server>__`) |
| `mcp__github__merge_pull_request` | one tool |
| `mcp__*` | every MCP tool of every server (tool-name glob; use in `deny` / `ask`) |

Evaluation order is **deny, then ask, then allow; first match wins**. Specificity does not matter: a `deny` on `mcp__github__merge_pull_request` beats an `allow` on `mcp__github__*`.

Hook matchers differ: in a `PreToolUse` matcher, `mcp__github` alone matches nothing; write `mcp__github__.*` (regex).

## 2. The policy for this repo

`mcp/permissions.settings-fragment.json` is the proposed block. It is a complete, valid settings file, so you can try it without editing anything: `claude --settings mcp/permissions.settings-fragment.json`. Merging it into `.claude/settings.json` is owned by module `10-governance`.

- **allow** (no prompt): `mcp__fhir-readonly__*`, and an explicit list of GitHub and Jira *read* tools (`get_file_contents`, `pull_request_read`, `issue_read`, `list_commits`, `search_code`, `getJiraIssue`, ...).
- **ask** (human approves each call): opening a PR, commenting on an issue or PR, posting a review, commenting on Jira.
- **deny**: merge, auto-merge, push, create/update/delete file, create branch, fork, create repo, trigger workflows, create/edit/transition Jira issues.

Why an explicit read list rather than `allow: ["mcp__github__*"]` plus denies: a server upgrade that adds a new write tool (say `delete_branch`) would be auto-allowed by the glob. With an explicit allow list, a new tool falls through to the default and prompts. Pair it with the verb-based `PreToolUse` hook from module `10-governance` (`.claude/hooks/guard-outbound.mjs`), which asks on any MCP tool whose name looks like a write, so unknown tools are gated on day one.

Belt and braces for GitHub: the GitHub server itself can drop write tools. `docs/remote-server.md` in github/github-mcp-server (checked 2026-09-30) documents a `/readonly` URL suffix (`https://api.githubcopilot.com/mcp/readonly`) and an `X-MCP-Readonly` header. That is the server's promise, not Claude Code's; keep the deny rules either way.

The PAT is the last line: give `GITHUB_PAT` read-only fine-grained scopes on this repository. A deny rule you forgot is still stopped by a token that cannot write.

## 3. Scoping servers to agents and skills

- A subagent with no `tools` field inherits **every** MCP tool of the main session. Roster agents in `.claude/agents/` list their tools explicitly (module `05-agent-roster`); add MCP tools by full name, e.g. `tools: Read, Grep, Glob, mcp__fhir-readonly__explain_query_plan` for the `sre` agent.
- The subagent `mcpServers` field (camelCase) can reference a configured server by name or define one inline, so a server can exist only inside one agent.
- A skill's `allowed-tools` **pre-approves** tools while the skill runs; it does not restrict. `ticket-intake` pre-approves the two Jira read tools and uses `disallowed-tools` to remove the Jira write tools for the rest of that turn.

## 4. Scopes: local, project, user

| Scope | Stored in | Shared | Use for |
|---|---|---|---|
| `local` (default of `claude mcp add`) | `~/.claude.json` under this project's path | no | trying a server, personal tokens, a server only you need |
| `project` | `.mcp.json` at the project root | yes, via git | servers the whole team and CI rely on (all three here) |
| `user` | `~/.claude.json` top level | no, all your projects | personal utilities |

Same name at several scopes: **local beats project beats user** (then plugin, then claude.ai connectors). The whole entry wins; fields are not merged. So a developer can shadow the team's `atlassian` entry with a local one pointing at a sandbox site without touching git:

```bash
claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp --scope local
```

`.mcp.json` has no per-server `scope`, `enabled` or `disabled` keys. Disable with `disabledMcpjsonServers` in settings or from `/mcp`. `node scripts/automation/check-mcp-config.mjs` fails the build if someone adds those keys.

## 5. Approval of project servers

- Interactive sessions prompt before using a `.mcp.json` server. `claude mcp reset-project-choices` clears your answers.
- `enableAllProjectMcpServers` / `enabledMcpjsonServers` / `disabledMcpjsonServers` control approval from settings. Committed to the project's `.claude/settings.json` they only count after you accept the workspace trust dialog; from user settings, managed settings or `--settings` they count immediately.
- `claude -p`, the Agent SDK and cloud sessions do **not** prompt: they load project servers. In CI, pass `--strict-mcp-config --mcp-config ci.mcp.json` so the job sees only the servers you intend.

## 6. Output limits

- Claude Code warns when one MCP tool result exceeds **10,000 tokens**; the default maximum is **25,000 tokens** (`MAX_MCP_OUTPUT_TOKENS` raises it). Over the limit, the result is saved to a file under the session's `tool-results` directory and Claude gets the path.
- A server can raise the limit for one tool by returning `_meta["anthropic/maxResultSizeChars"]` in that tool's `tools/list` entry (ceiling 500,000 characters). `fhir-readonly` sets 50,000 on `get_schema`, the only tool whose output grows with the schema.
- Prefer small outputs by design: `count_observations_by_code` returns one row per LOINC code, `list_observation_ids` caps `limit` at 50. A tool that can return a patient's full history is a context-window problem before it is a PHI problem.
- `MCP_TIMEOUT` (default 30,000 ms) bounds server start-up.
