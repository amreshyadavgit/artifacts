# Governance (Frappe edition)

How this repository keeps AI agents inside the lines a healthcare engineering org needs on a Frappe platform: humans approve every command that changes a site and every schema change, untrusted content (Jira tickets, DocType field values, PR diffs) cannot steer agents into writes, site secrets and API keys stay in, spend is bounded, and skills are maintained like libraries. Built in module 10-governance.

| Topic | Document | Enforced by |
|---|---|---|
| Human approval gates | `approval-gates.md` | plan mode; `permissions.ask`/`deny` in `.claude/settings.json`; Claude Code hooks `.claude/hooks/guard-bench.mjs` (bench commands) and `guard-outbound.mjs` (MCP writes); `CODEOWNERS.example` (`**/doctype/**`, `patches.txt`, `hooks.py`, `fixtures/**`, `.claude/**`); `ai-change-gate.yml.example`; `managed-settings.example.json` |
| Prompt injection | `prompt-injection.md` | deny rules, `guard-bench.mjs`, `guard-outbound.mjs` (`ask`/`deny`), `.claude/hooks/flag-injection.mjs` (PostToolUse warning, also on DocType field content from MCP), PR review of `.claude/**` and schema |
| Secrets and API keys | `secrets.md`, `integration-users.json` | `permissions.deny` read rules, `guard-bench.mjs` (site_config, show-config, DB shells), `block-secrets.mjs`, `guard-outbound.mjs`, `scripts/governance/audit_api_users.py`, `apiKeyHelper` (`scripts/governance/api-key-helper.sh`) |
| Model and cost | `model-and-cost-policy.md` | `scripts/governance/agent-policy.json` + `check-agent-policy.mjs`, `--max-turns`, `--max-budget-usd`, `cost-report.mjs` |
| Skill library | `../../skills/README.md` | `scripts/governance/validate-skill-library.mjs`, `package-plugin.mjs`, `company-ai/`, `claude plugin validate` |

## Run every governance check

```bash
cd AI-SDLC-frappe
node .claude/hooks/block-secrets.test.mjs
node .claude/hooks/guard-bench.test.mjs
node .claude/hooks/guard-outbound.test.mjs
node .claude/hooks/flag-injection.test.mjs
node scripts/governance/check-ai-change-approval.test.mjs
node scripts/governance/check-agent-policy.test.mjs
node scripts/governance/cost-report.test.mjs
node scripts/governance/validate-skill-library.test.mjs
python3 -m unittest scripts/governance/test_audit_api_users.py
node scripts/governance/check-agent-policy.mjs
node scripts/governance/validate-skill-library.mjs
claude plugin validate company-ai
jq empty .claude/settings.json && echo "settings.json is valid JSON"
```

Against the test site (as the bench user, read-only):

```bash
cd /home/user/frappe-bench/sites && ../env/bin/python \
  /home/user/artifacts/AI-SDLC-frappe/scripts/governance/audit_api_users.py --site test.localhost
```
