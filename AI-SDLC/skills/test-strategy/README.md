# Skill: test-strategy

| | |
|---|---|
| Runtime location | `.claude/skills/test-strategy/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | Platform engineering, tester-agent maintainers |
| Consumers | `tester` agent (preloaded via `skills: [test-strategy, run-tests]`, see module 05-agent-roster), humans via `/test-strategy <endpoint or ADR>` |
| Writes files | No. The plan is returned as text; the tester agent writes the test classes. |
| Golden cases | [tests/cases.json](tests/cases.json) (6 cases) |

## What it does
Produces a risk-based test plan for a change to `sample-app`: change surface with `path:line` evidence, existing coverage, defects found while planning (canonical findings, ids `TS-NNN`), test cases with exact `TestClass#method` names, and a coverage matrix over eight categories (unit, integration, api, negative, edge, performance, security, regression) mapped to JUnit 5, Mockito, MockMvc, H2 and Hibernate statistics per `context/standards/testing-standards.md`.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure and rules |
| `TEST_PLAN_TEMPLATE.md` | Output structure (the only file with placeholders) |
| `tooling-map.md` | Category → tool → pattern, plus harness facts (shared H2 database, NULL ordering) |
| `examples/lastn-test-plan.md` | Reference plan for `GET /fhir/Observation/$lastn` (18 cases, 6 findings) |
| `examples/ObservationLastnTest.java`, `examples/ObservationServiceLastnTest.java` | The plan implemented; verified on a copy of sample-app: 13 tests pass, 3 are `@Disabled` and fail for the documented defects when enabled |
| `scripts/validate-test-plan.mjs` (+ `.test.mjs`, 9 tests) | Structure validator, existing/new test checker, golden-case grader |

## Defects this skill surfaced in the sample app
Planning `$lastn` found two real defects besides the planted N+1, both reproduced by running the example tests: an Observation without `effectiveDateTime` wins `$lastn` (TS-001), and duplicate subject ids produce duplicate entries (TS-002). They are documented as findings and `@Disabled` tests, not fixed, because the sample app is shared by other modules.

## How to test
```bash
cd AI-SDLC
node --test .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs
node .claude/skills/test-strategy/scripts/validate-test-plan.mjs \
  .claude/skills/test-strategy/examples/lastn-test-plan.md --repo . \
  --case skills/test-strategy/tests/cases.json#ts-01-lastn-endpoint
# Example tests on a throwaway copy of the app (never commit them into sample-app from here):
cp -r sample-app /tmp/sample-app-copy
cp .claude/skills/test-strategy/examples/ObservationLastnTest.java /tmp/sample-app-copy/src/test/java/org/example/fhir/
mkdir -p /tmp/sample-app-copy/src/test/java/org/example/fhir/service
cp .claude/skills/test-strategy/examples/ObservationServiceLastnTest.java /tmp/sample-app-copy/src/test/java/org/example/fhir/service/
(cd /tmp/sample-app-copy && mvn -q -B test)   # exits 0: 41 tests, 3 skipped
```

## Change policy
- New categories or columns are a major bump and must be mirrored in `scripts/validate-test-plan.mjs`.
- When `testing-standards.md` changes, update `tooling-map.md` and re-run the golden cases.
- The `facts` in `tests/cases.json` marked "run" were measured; re-measure them after any change to `sample-app`.
