# Changelog: test-strategy skill

Semantic versioning: a change to the plan structure is major, a new category rule or golden case is minor, wording is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md`: eight-step procedure, `allowed-tools: Read Grep Glob Bash(git diff *) Bash(git status *)`, diff injection when no argument is given.
- `TEST_PLAN_TEMPLATE.md` and `tooling-map.md` (eight categories mapped to JUnit 5, Mockito, MockMvc, H2, Hibernate statistics).
- `examples/lastn-test-plan.md` with 18 cases and 6 findings, and the two example test classes that implement it.
- `scripts/validate-test-plan.mjs` and 9 tests.
- Golden cases `skills/test-strategy/tests/cases.json` (6 cases: `$lastn`, create Observation, update Patient, delete Patient, ADR-0002 pagination, FHIR-130 bug fix).
