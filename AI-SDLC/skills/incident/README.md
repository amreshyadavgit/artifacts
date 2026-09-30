# Skill: incident

| | |
|---|---|
| Runtime location | `.claude/skills/incident/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | Humans via `/incident <incident-id> <symptom and time window>`; the `sre` agent does the analysis with its preloaded `production-rca` and `performance-review` skills. |
| Taught in | module 08-workflow-orchestration |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Entry point of the incident-response workflow (`workflows/incident-response.md`): PHI-free incident brief, sre root-cause analysis with conditional parallel security triage, human mitigation decision, optional fix via `/bug-fix`, and a postmortem draft. No agent changes production: `kubectl apply` is an `ask` rule and `kubectl delete` is denied in `.claude/settings.json`.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Step table; registers `.claude/hooks/check-handoff.mjs` on SubagentStop |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-latency | grep -c PASS   # 8
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
Mitigation is always a human action; the skill can only recommend it. A live run needs the incident evidence files (logs, metrics) the sre agent reads.
