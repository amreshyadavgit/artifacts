# Skill: requirements

| | |
|---|---|
| Runtime location | `.claude/skills/requirements/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | The orchestrator as step 01 of the feature and bug-fix workflows; humans via `/requirements <ticket-id or text>`. |
| Taught in | module 08-workflow-orchestration |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Turns a ticket, bug report or incident note into a PHI-free requirements handoff (`NN-requirements.md`): user story (or Observed/Expected/Reproduction in bug mode), Given/When/Then acceptance criteria, non-functional requirements and explicit scope. Read-only tools (`disallowed-tools: Edit Bash`).

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure and handoff rules |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
node .claude/hooks/check-handoff.mjs workflows/examples/feature-patient-pagination/01-requirements.md
grep -c '^| AC-' workflows/examples/feature-patient-pagination/01-requirements.md   # 6
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
Does not make design decisions (architect) or break work into tasks (implementation-plan).
