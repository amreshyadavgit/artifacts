# Secrets and credentials for agents

Policy: `context/security/phi-and-secrets-policy.md`. This page lists the mechanisms that enforce it, from the edge inwards.

## 1. Agents cannot read secret files (`permissions.deny`)

`.claude/settings.json` denies reads of `.env`, `.env.*` (at the root and nested), `**/secrets/**`, `*.pem`, `*.key`, `~/.ssh/**`, `~/.aws/**`, `~/.config/gh/**`, real data under `sample-app/data/real/**` and `**/*.phi.*`. A `Read` deny also blocks `Edit` and `Write` on the same path. Because deny rules are evaluated first, no `allow` rule re-opens them.

`Read(...)` rules do not stop a shell command from reading the same file, so the Bash side is closed too: `Bash(cat .env*)`, `Bash(printenv)`, `Bash(printenv *)` and `Bash(env)` are denied. The Bash allow-list is narrow (`mvn -q -B test`, `git diff`, `git status`, `git log`), so anything else prompts a human.

## 2. Agents cannot write secrets (`block-secrets.mjs`)

`PreToolUse` hook on `Edit|Write` (`.claude/hooks/block-secrets.mjs`, owned by the platform team). It exits 2 when the new content contains an AWS key, a GitHub token, a private key, an Anthropic API key, a hard-coded password or a JDBC URL with an inline password. `${DB_PASSWORD}` placeholders pass. Test: `node .claude/hooks/block-secrets.test.mjs`.

## 3. Agents cannot send secrets or PHI out (`guard-outbound.mjs`)

`PreToolUse` hook on `mcp__.*`. It returns `permissionDecision: "deny"` when an MCP tool input contains a secret-like token, a non-synthetic MRN (anything other than `MRN-000xxx`) or an SSN-shaped value. Test: `node .claude/hooks/guard-outbound.test.mjs`.

## 4. MCP credentials never sit in `.mcp.json`

`.mcp.json` uses `${VAR}` expansion for tokens (for example `"Authorization": "Bearer ${JIRA_TOKEN}"`). The variable comes from the developer's shell or secret agent, not from a committed file.

## 5. The Claude Code API key itself (`apiKeyHelper`)

Do not export a long-lived `ANTHROPIC_API_KEY` in a shared shell profile. Use the `apiKeyHelper` setting: Claude Code runs the command and sends its stdout as the key (`X-Api-Key` and `Authorization: Bearer`).

```json
{ "apiKeyHelper": "/opt/ai-sdlc/api-key-helper.sh" }
```

- Put it in `~/.claude/settings.json` (per developer) or in managed settings (org-wide), never in the committed `.claude/settings.json`: a project file must not decide where every developer's credentials come from.
- Example helper: `scripts/governance/api-key-helper.sh`. It reads a `chmod 600` file named by `CLAUDE_KEY_FILE`, else a Vault path, and exits 1 with no output when neither is available.
- In CI, inject the key from the CI secret store into the job environment for that job only.

## 6. Where a secret leak is detected after the fact

If `block-secrets.mjs` or `guard-outbound.mjs` fires on real data: rotate the credential first, then remove it from history, then add a pattern to the hook and a test case for it.
