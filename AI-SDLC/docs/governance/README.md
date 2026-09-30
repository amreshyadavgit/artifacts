# Governance

How this repository keeps AI agents inside the lines a healthcare engineering org needs: humans approve risky actions, untrusted content cannot steer agents into writes, secrets and PHI stay in, spend is bounded, and skills are maintained like libraries. Built in module 10-governance.

| Topic | Document | Enforced by |
|---|---|---|
| Human approval gates | `approval-gates.md` | plan mode, `permissions.ask`/`deny` in `.claude/settings.json`, `.claude/hooks/guard-outbound.mjs`, `CODEOWNERS.example`, `ai-change-gate.yml.example`, `managed-settings.example.json` |
| Prompt injection | `prompt-injection.md` | deny-listed write tools, `guard-outbound.mjs` (`ask`/`deny`), `.claude/hooks/flag-injection.mjs` (PostToolUse warning), PR review of `.claude/**` |
| Secrets | `secrets.md` | `permissions.deny` read rules, `.claude/hooks/block-secrets.mjs`, `guard-outbound.mjs`, `apiKeyHelper` (`scripts/governance/api-key-helper.sh`) |
| Model and cost | `model-and-cost-policy.md` | `scripts/governance/agent-policy.json` + `check-agent-policy.mjs`, `--max-turns`, `--max-budget-usd`, `cost-report.mjs` |
| Skill library | `../../skills/README.md` | `scripts/governance/validate-skill-library.mjs`, `package-plugin.mjs`, `company-ai/` |

## Run every governance check

```bash
cd AI-SDLC
node .claude/hooks/block-secrets.test.mjs
node .claude/hooks/guard-outbound.test.mjs
node .claude/hooks/flag-injection.test.mjs
node scripts/governance/check-ai-change-approval.test.mjs
node scripts/governance/check-agent-policy.test.mjs
node scripts/governance/cost-report.test.mjs
node scripts/governance/validate-skill-library.test.mjs
node scripts/governance/check-agent-policy.mjs
node scripts/governance/validate-skill-library.mjs
jq empty .claude/settings.json && echo "settings.json is valid JSON"
```
