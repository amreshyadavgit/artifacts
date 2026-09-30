# MCP permissions, scopes and limits (Frappe edition)

Source of truth for formats: `build/CLAUDE_CODE_FACTS.md` sections 5 and 7. This page applies them to the three servers in `AI-SDLC-frappe/.mcp.json`, and adds the second permission system every Frappe MCP server lives behind: the site's own roles.

## 1. Two permission systems, both required

| Layer | Decides | Configured in | Example |
|---|---|---|---|
| Claude Code permission rules | which MCP tools the model may call, with or without a prompt | `permissions.allow/ask/deny` in settings | `mcp__github__merge_pull_request` in `deny` |
| Frappe roles and DocPerm | what the API key can do on the site, whatever calls it | Role, Custom DocPerm, User in the site | `SL Aggregate Reader`: read on three DocTypes, nothing else |

Claude Code rules stop the model from calling a tool. Frappe permissions stop the token from doing anything else, including when someone copies it out of an environment variable into `curl`. Neither replaces the other.

## 2. Rule syntax for MCP tools

| Rule | Matches |
|---|---|
| `mcp__spice-site` | every tool of the `spice-site` server |
| `mcp__spice-site__*` | every tool of the server (glob after the literal `mcp__<server>__`) |
| `mcp__spice-site__count_patients_by_country` | one tool |
| `mcp__*` | every MCP tool of every server (tool-name glob; use in `deny` / `ask`) |

Evaluation is **deny, then ask, then allow; first match wins**. Specificity does not matter: a `deny` on `mcp__github__merge_pull_request` beats an `allow` on `mcp__github__*`.

Claude Code hook matchers differ: in a `PreToolUse` matcher, `mcp__github` alone matches nothing; write `mcp__github__.*` (regex).

## 3. The policy for this repo

`mcp/permissions.settings-fragment.json` is the proposed block. It is a complete, valid settings file, so you can try it without editing anything: `claude --settings mcp/permissions.settings-fragment.json`. Merging it into `.claude/settings.json` belongs to module `10-governance`.

- **allow** (no prompt): the four `spice-site` tools by name, and an explicit list of GitHub and Jira *read* tools (`get_file_contents`, `pull_request_read`, `issue_read`, `list_commits`, `search_code`, `getJiraIssue`, ...).
- **ask** (human approves each call): opening a PR, commenting on an issue or PR, posting a review, commenting on Jira.
- **deny**: merge, auto-merge, push, create/update/delete file, create branch, fork, create repo, trigger workflows, create/edit/transition Jira issues.

Why explicit names instead of `allow: ["mcp__spice-site__*"]`: a server upgrade that adds a tool (say `export_patients`) would be auto-allowed by the glob. With explicit names a new tool falls through to a prompt. The same holds for the remote servers, whose tool lists change without a commit in your repo. Pair it with the verb-based `PreToolUse` Claude Code hook from module `10-governance` (`.claude/hooks/guard-outbound.mjs`, matcher `mcp__.*`).

Defence in depth for GitHub: a read-only fine-grained PAT, then GitHub's documented `/readonly` URL suffix or `X-MCP-Readonly` header (GitHub's promise, not Claude Code's), then deny rules, then the Claude Code hook.

## 4. The Frappe side: the read-only API user

`mcp/spice-site-server/scripts/provision_api_user.py` creates, on a test site only:

- Role `SL Aggregate Reader` with Custom DocPerm `read = 1` (nothing else) on SL Patient, SL Encounter and SL Observation.
- User `mcp-reader@spice-lite.test` with only that role, and an API key and secret from `frappe.core.doctype.user.user.generate_keys` (System Manager only; the secret is shown once).

Measured against the course bench with `bench serve` (see `scripts/run-live-test.sh`):

| Request with the reader's token | HTTP |
|---|---|
| `GET /api/method/frappe.desk.listview.get_group_by_count` (what the server calls) | 200 |
| Same request as Guest | 403 |
| Wrong secret | 401 |
| `POST /api/resource/SL Country` (a write) | 403 |
| `GET /api/resource/SL Patient?limit_page_length=1` (a row read) | **200** |

The last row is the honest limit. Frappe has no "aggregate only" permission: `get_group_by_count` calls `frappe.get_list`, which needs `read` (or `select`, and `select` exposes the DocType's `search_fields`, which on SL Patient are `mrn,last_name`). So the key can read rows; **the MCP server is the PHI boundary, and the key must live only in the server's environment**. The stronger design is in [spice-site-server.md](spice-site-server.md#a-stronger-design).

Rules for real deployments (one site per country):

- One API user per integration and per site. Never reuse a clinician's or Administrator's keys.
- Rotate with `generate_keys` (it replaces the secret); remove the user when the integration is retired.
- Keys come from a secret store into the MCP server's environment (`${SPICE_SITE_API_KEY}` in `.mcp.json`). Never in the repo, never in `site_config.json` reads by an agent (`Read(**/site_config.json)` is denied).

## 5. Scoping servers to agents and skills

- A subagent with no `tools` field inherits **every** MCP tool of the main session. Roster agents (module `05-agent-roster`) list tools explicitly; add MCP tools by full name, e.g. `tools: Read, Grep, Glob, mcp__spice-site__get_doctype_schema, mcp__spice-site__count_observations_by_code` for the `sre` agent.
- The subagent `mcpServers` field (camelCase) can reference a configured server by name or define one inline, so a server can exist only inside one agent.
- A skill's `allowed-tools` **pre-approves** tools while the skill runs; it does not restrict. `ticket-intake` pre-approves the two Jira read tools and uses `disallowed-tools` to remove the Jira write tools, the GitHub write tools and the `spice-site` tools for the rest of that turn.

## 6. Scopes: local, project, user

| Scope | Stored in | Shared | Use for |
|---|---|---|---|
| `local` (default of `claude mcp add`) | `~/.claude.json` under this project's path | no | trying a server, a personal sandbox site |
| `project` | `.mcp.json` at the project root | yes, via git | servers the team and CI rely on (all three here) |
| `user` | `~/.claude.json` top level | no, all your projects | personal utilities |

Same name at several scopes: **local beats project beats user** (then plugin, then claude.ai connectors). The whole entry wins; fields are not merged. A developer can point `spice-site` at their own bench in live mode without touching git:

```bash
export SPICE_SITE_API_KEY=... SPICE_SITE_API_SECRET=...     # from provision_api_user.py, never committed
claude mcp add --env SPICE_SITE_MODE=live --env SPICE_SITE_URL=http://127.0.0.1:8000 --scope local \
  spice-site -- node "$PWD/mcp/spice-site-server/server.mjs"
```

`--env` takes several values, so put `--scope` (or another option) before the server name, or the name is read as an env entry. Observed with Claude Code 2.1.285: the stdio server also **inherits the environment of the shell that started `claude`** (the key and secret above reached it without an `--env` entry). That is convenient and a risk: every stdio server you approve can read every secret exported in that shell. Start Claude Code from a shell that holds only the variables its servers need.

`.mcp.json` has no per-server `scope`, `enabled` or `disabled` keys. Disable with `disabledMcpjsonServers` or from `/mcp`. `node scripts/automation/check-mcp-config.mjs` fails the build if someone adds those keys, inlines a credential, or points a server at `site_config.json`.

## 7. Approval of project servers

- Interactive sessions prompt before using a `.mcp.json` server. `claude mcp reset-project-choices` clears your answers.
- `enableAllProjectMcpServers` / `enabledMcpjsonServers` / `disabledMcpjsonServers` control approval from settings. Committed to the project's `.claude/settings.json` they count only after you accept the workspace trust dialog; from user settings, managed settings or `--settings` they count immediately.
- `claude -p`, the Agent SDK and cloud sessions do **not** prompt: they load project servers. In CI, pass `--strict-mcp-config --mcp-config ci.mcp.json` so the job sees only the servers you intend (for example `spice-site` in fixture mode only).

## 8. Output limits

- Claude Code warns when one MCP tool result exceeds **10,000 tokens**; the default maximum is **25,000 tokens** (`MAX_MCP_OUTPUT_TOKENS` raises it). Larger results are saved to a file and Claude gets the path.
- A server can raise one tool's limit with `_meta["anthropic/maxResultSizeChars"]` in its `tools/list` entry (ceiling 500,000 characters). `spice-site` sets 50,000 on `get_doctype_schema`, the only tool whose output grows with the site (country apps add Custom Fields).
- Prefer small outputs by design: the count tools return one row per LOINC code or country, capped at the 50 groups Frappe's `get_group_by_count` returns.
- `MCP_TIMEOUT` (default 30,000 ms) bounds server start-up; the server itself gives the site 10 s per request.
