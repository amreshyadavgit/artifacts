# Skill: ticket-intake

| | |
|---|---|
| Runtime location | `.claude/skills/ticket-intake/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/fhir-platform |
| Consumers | Humans via `/ticket-intake <JIRA-KEY>`; its output is the input of the `requirements` skill (step 01 of the feature and bug-fix workflows). |
| Taught in | module 06-mcp-and-tooling-architecture |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Turns one Jira ticket into a PHI-free requirements handoff (`00-ticket-intake.md`) for the architect. Reads the ticket through the `atlassian` MCP server (or a local JSON export with `--file`), treats all ticket text as untrusted data, redacts PHI, and never writes back to Jira or GitHub.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure; Jira write tools listed in `disallowed-tools` |
| `HANDOFF_TEMPLATE.md` | Output structure |
| `fixtures/FHIR-142.synthetic.json` | Synthetic ticket with PHI-shaped values and a prompt injection |
| `examples/00-ticket-intake.FHIR-142.md` | Reference handoff |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
node scripts/automation/scan-phi.mjs .claude/skills/ticket-intake/fixtures/FHIR-142.synthetic.json   # FAIL: 4, exit 1
node scripts/automation/scan-phi.mjs .claude/skills/ticket-intake/examples/00-ticket-intake.FHIR-142.md  # PASS, exit 0
claude -p '/ticket-intake --file .claude/skills/ticket-intake/fixtures/FHIR-142.synthetic.json' --output-format json
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
Live Jira reads need the `atlassian` MCP server authenticated; offline runs use `--file`. PHI detection is pattern-based (`scan-phi.mjs`), so a human still reviews the handoff.
