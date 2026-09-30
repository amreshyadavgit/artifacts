# Skill: feature

| | |
|---|---|
| Runtime location | `.claude/skills/feature/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | Humans via `/feature <ticket-id> <summary>`; it makes the main session act as the orchestrator (`.claude/agents/orchestrator.md`). |
| Taught in | module 08-workflow-orchestration |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Entry point of the feature-delivery workflow (`workflows/feature-delivery.md`): requirements, architecture review, implementation plan, developer, tester and security in parallel, code review, with human gates G1/G2 and a run folder under `.ai-sdlc/runs/`. User-invoked only (`disable-model-invocation: true`).

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Step table and gate rules; registers `.claude/hooks/check-handoff.mjs` on SubagentStop |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
node .claude/hooks/check-handoff.mjs workflows/examples/feature-patient-pagination | grep -c PASS   # 9
node --test .claude/hooks/check-handoff.test.mjs
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
A full run needs a live model and a human at each gate; the deterministic cases check the committed reference run and the entry-point configuration only.
