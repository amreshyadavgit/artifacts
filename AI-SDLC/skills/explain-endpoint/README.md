# Skill: explain-endpoint

| | |
|---|---|
| Runtime location | `.claude/skills/explain-endpoint/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/fhir-platform |
| Consumers | Humans via `/explain-endpoint <METHOD> <path>`; no agent preloads it. |
| Taught in | module 02-first-agent-skill-tools |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Explains one sample-app HTTP endpoint end to end (security rule, controller, mapper, service, repository, SQL, error paths, audit logging, covering tests) with `path:line` citations. Read-only: it never edits files.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure; injects the live route map with a pre-approved `grep` (`!` command) |
| `reference.md` | Layer-by-layer reference the procedure links to |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
grep -rnE "@(Get|Post|Put|Delete|Request)Mapping" sample-app/src/main/java/org/example/fhir/api | wc -l   # 11
grep -c '\[reference.md\](reference.md)' .claude/skills/explain-endpoint/SKILL.md          # 1
claude -p '/explain-endpoint GET /fhir/Observation/$lastn' --output-format json | jq -r '.result'
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
Knows only the `/fhir/Patient` and `/fhir/Observation` routes; a new controller needs no skill change because the route map is injected at invocation time.
