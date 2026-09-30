# Skill: run-tests

| | |
|---|---|
| Runtime location | `.claude/skills/run-tests/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/fhir-platform |
| Consumers | `developer` and `tester` agents (preloaded via `skills:`, see module 05-agent-roster); humans via `/run-tests [TestClass | TestClass#method]`. |
| Taught in | module 02-first-agent-skill-tools |
| Golden cases | [tests/cases.json](tests/cases.json) (4 cases) |

## Purpose
Runs the sample-app Maven suite (or one class or method) and reports a compact pass/fail summary with each failing test, its assertion message and the failing line, using `scripts/summarize-surefire.mjs` over the Surefire XML reports.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure; injects the time and `git status` of sample-app, never Maven |
| `scripts/summarize-surefire.mjs` | Surefire XML to Markdown summary; exit 2 when no reports exist |
| `scripts/summarize-surefire.test.mjs` | 6 tests |

## How it is tested
Deterministic cases (`kind: deterministic` in `tests/cases.json`) run without a model and must pass in CI; `live` cases run through a headless `claude -p` session and are graded by hand or by the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC
node --test .claude/skills/run-tests/scripts/summarize-surefire.test.mjs   # pass 6, fail 0
(cd sample-app && mvn -q -B test) && node .claude/skills/run-tests/scripts/summarize-surefire.mjs | head -3
node scripts/governance/validate-skill-library.mjs    # this entry: SKILL.md ok, version 1.0.0
```

## Known limitations
Reads only `sample-app/target/surefire-reports`; a compilation failure produces NO REPORTS (exit 2), which the skill reports instead of a false PASS.
