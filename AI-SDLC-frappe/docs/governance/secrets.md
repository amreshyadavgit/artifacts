# Secrets and credentials for agents (Frappe edition)

Policy: `context/security/phi-and-secrets-policy.md`. This page lists the mechanisms that enforce it, from the edge inwards, and the facts about Frappe that make them necessary.

## What is secret on a bench

| Secret | Where it lives | Why it matters |
|---|---|---|
| `db_password`, `db_name` | `sites/<site>/site_config.json` | Full read/write access to one site's database, bypassing every DocType permission |
| `encryption_key` | `sites/<site>/site_config.json` | Decrypts every `Password` field of the site (stored encrypted in the `__Auth` table), including every user's `api_secret` and integration credentials. Losing it breaks them all; leaking it exposes them all. |
| `root_password`, `admin_password`, redis passwords | `sites/common_site_config.json` or `site_config.json` (when set) | Bench-wide access |
| `api_key` / `api_secret` per user | `User.api_key` (Data) and `User.api_secret` (Password) | `Authorization: token <api_key>:<api_secret>` acts as that user through `/api/method/...` and `/api/resource/...` |
| The Claude Code API key | the developer's machine | Spend and data access in the model provider account |

## 1. Agents cannot read secret files or print them

- `permissions.deny` in `.claude/settings.json`: `Read(**/site_config.json)`, `Read(**/common_site_config.json)`, `.env` (root and nested), `*.pem`, `*.key`, `~/.ssh/**`, `~/.config/gh/**`, `**/*.phi.*`. A `Read` deny also blocks `Edit` and `Write` on the same path.
- `Read(...)` rules do not stop a shell command, and bench has several commands that print secrets. Verified on the course bench: `bench --site test.localhost show-config` prints a table that includes `db_password` and `encryption_key`. So `Bash(cat *site_config.json*)`, `Bash(bench --site * show-config*)`, the DB shells (`mariadb`, `postgres`, `db-console`), `jupyter`, `printenv` and `env` are denied.
- The Claude Code hook `.claude/hooks/guard-bench.mjs` (PreToolUse on `Bash`) closes what prefix rules cannot: it denies **any** command that names `site_config.json` or `common_site_config.json` (`jq`, `python -c`, `grep`, `git diff -- sites/...`), `bench --site x execute frappe.get_site_config`, and `show-config` however it is spelled (`bench --verbose --site=x show-config`, inside `su - frappe -c "..."`).
- `bench --site x console` and `execute` can read `frappe.conf` in one line of Python, so they are `ask` (G2), never allowed.

## 2. Agents cannot write secrets (`block-secrets.mjs`)

`PreToolUse` Claude Code hook on `Edit|Write` (`.claude/hooks/block-secrets.mjs`, owned by the orchestrator/platform team). It exits 2 when new content contains a site_config secret (`"db_password": "..."`, `"encryption_key": "..."`), a Frappe API token (`token <15 hex>:<15 hex>`), a database URL with an inline password, a private key, an AWS, GitHub or Anthropic key, or a hard-coded password. `${SPICE_API_KEY}:${SPICE_API_SECRET}` placeholders pass. Test: `node .claude/hooks/block-secrets.test.mjs`.

## 3. Agents cannot send secrets or PHI out (`guard-outbound.mjs`)

`PreToolUse` Claude Code hook on `mcp__.*`. It returns `permissionDecision: "deny"` when an MCP tool input contains a Frappe API token or `api_secret`, a site_config value, a database URL with a password, another secret-like token, a non-synthetic MRN (anything other than `MRN-000xxx`) or an SSN-shaped value. String values are checked unescaped, so a secret inside a search query string is seen. Test: `node .claude/hooks/guard-outbound.test.mjs`.

## 4. One API user and one key per integration

Every integration (the ERPNext billing connector, the telephony integration app, the read-only MCP server of module 06-mcp-and-tooling-architecture) gets its **own** Frappe User and its own key pair. Never share a key between integrations and never reuse a human's key.

- **Registry:** `docs/governance/integration-users.json` names the integration, its user, the roles it may hold, the owner, where the secret is stored (`secret_ref`, a reference, never the value) and the rotation period.
- **Issuing:** `frappe.core.doctype.user.user.generate_keys(user)` is whitelisted for `POST` and calls `frappe.only_for("System Manager")`. It creates an `api_key` if the user has none, always creates a new `api_secret`, and returns the secret once. A System Manager runs it and puts the secret straight into the store named in `secret_ref`. Agents never run it: `guard-bench.mjs` denies `execute ...generate_keys`.
- **Rotation:** calling `generate_keys` again keeps the `api_key` and replaces the `api_secret`, so the old token stops working immediately. Rotate on the registry's `rotate_days`, and at once after any suspected leak.
- **Blast radius:** an integration user holds only the registry roles, never `System Manager` or `Administrator`. Frappe rejects keys of disabled users (`validate_api_key_secret` filters `enabled`), and Frappe 15.121.2 enforces `User.restrict_ip` for API-key requests too (`frappe.auth.validate_auth`), so give every integration user an IP allowlist.
- **Audit:** `scripts/governance/audit_api_users.py` lists every user with an API key on a site and compares them with the registry. It reports an error for a key on Administrator or Guest, a key holding System Manager, a key on a user that is not registered, a role the registry does not allow, and two integrations sharing one user; warnings for a missing `restrict_ip`, a disabled user that still has a key, and a registered integration with no key yet. It never prints a key or a secret. Run it with the bench's Python:

```bash
cd /home/user/frappe-bench/sites && ../env/bin/python \
  /home/user/artifacts/AI-SDLC-frappe/scripts/governance/audit_api_users.py --site test.localhost
```

- **Demo keys:** `spice_lite.demo.seed_demo` creates keys for the synthetic `clinician@spice-lite.test` and `norole@spice-lite.test` users. It refuses to run unless `allow_tests` or `developer_mode` is set. Those keys are for a local test site only; the audit flags them as unregistered on purpose.

## 5. MCP credentials never sit in `.mcp.json`

`.mcp.json` uses `${VAR}` expansion: the `spice-site` server gets `SPICE_SITE_API_KEY` and `SPICE_SITE_API_SECRET` through its `env` block (`"${SPICE_SITE_API_KEY:-}"`), GitHub and Atlassian get `"Bearer ${GITHUB_PAT}"` and `"Bearer ${ATLASSIAN_MCP_TOKEN}"` headers. The variables come from the developer's shell or secret agent, never from a committed file.

## 6. The Claude Code API key itself (`apiKeyHelper`)

Do not export a long-lived `ANTHROPIC_API_KEY` in a shared shell profile. Use the `apiKeyHelper` setting: Claude Code runs the command and sends its stdout as the key (`X-Api-Key` and `Authorization: Bearer`).

```json
{ "apiKeyHelper": "/opt/ai-sdlc-frappe/api-key-helper.sh" }
```

- Put it in `~/.claude/settings.json` (per developer) or in managed settings (org-wide), never in the committed `.claude/settings.json`: a project file must not decide where every developer's credentials come from.
- Example helper: `scripts/governance/api-key-helper.sh`. It reads a `chmod 600` file named by `CLAUDE_KEY_FILE`, else a Vault path, and exits 1 with no output when neither is available (fail closed).
- In CI, inject the key from the CI secret store into that job's environment only.

## 7. After a leak

1. Rotate first: `generate_keys` for an API user; a new database password set by a human (`ALTER ROLE ...` on Postgres, then `bench --site x set-config db_password ...` outside Claude Code); a new token in the MCP secret store.
2. `encryption_key` is special: changing it makes every stored `Password` field unreadable. Treat a leaked `encryption_key` as an incident: re-issue every API secret and integration password on that site after the key change.
3. Remove the value from git history, then add a pattern to `block-secrets.mjs` or `guard-outbound.mjs` and a test case for it.
