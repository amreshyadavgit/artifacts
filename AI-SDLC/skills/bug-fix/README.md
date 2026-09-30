# Skill: bug-fix

| | |
|---|---|
| Runtime location | `.claude/skills/bug-fix/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | Humans via `/bug-fix <bug-id> <observed behaviour>`; the incident workflow hands confirmed code defects to it (`06-bug-fix-handover.md`). |
| Taught in | module 08-workflow-orchestration |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Entry point of the bug-fix workflow (`workflows/bug-fix.md`): reproduce and specify, plan, failing regression test plus fix, tester and conditional security in parallel, code review, with human gates and a run folder under `.ai-sdlc/runs/`. User-invoked only.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Step table; registers `.claude/hooks/check-handoff.mjs` on SubagentStop |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
grep -hE '^(name|disable-model-invocation|argument-hint):' .claude/skills/bug-fix/SKILL.md
node --test .claude/hooks/check-handoff.test.mjs
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
No committed reference bug-fix run exists yet; the incident example's `06-bug-fix-handover.md` is the documented input shape.
