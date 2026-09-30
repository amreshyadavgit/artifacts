# Skill: implementation-plan

| | |
|---|---|
| Runtime location | `.claude/skills/implementation-plan/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | The orchestrator before any developer launch in the feature and bug-fix workflows; humans via `/implementation-plan <run-id>`. |
| Taught in | module 08-workflow-orchestration |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Turns approved requirements and the architect's handoff into a step-by-step plan (`NN-implementation-plan.md`) for the developer: files to change, verification per step, mapping of every `AC-n` and medium-or-higher `ARC-n` to a step, security scope and rollback. The plan always ends at gate G1 (`status: needs-human`).

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure, security-scope rule and plan rules |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
node .claude/hooks/check-handoff.mjs workflows/examples/feature-patient-pagination/03-implementation-plan.md
grep -c '^| P[0-9]' workflows/examples/feature-patient-pagination/03-implementation-plan.md   # 6
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
Never edits code; if the requirements need a design change it stops with `status: blocked` for the architect.
