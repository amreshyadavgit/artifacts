# Changelog: test-strategy skill (Frappe edition)

Semantic versioning: a change to the plan structure is major, a new category rule or golden case is minor, wording is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md`: eight-step procedure, `allowed-tools: Read Grep Glob Bash(git diff *) Bash(git status *)`, diff injection when no argument is given.
- `TEST_PLAN_TEMPLATE.md` and `tooling-map.md` (eight categories mapped to `unittest`, `FrappeTestCase`, `call()`, `frappe.set_user`, a query counter; `bench run-tests` flags; harness facts).
- `examples/lastn-test-plan.md` (24 cases, 7 findings) and the example tests `test_lastn_plan.py` (14) and `test_lastn_mappers_unit.py` (2), measured on Postgres and MariaDB.
- `scripts/validate-test-plan.mjs` and 10 tests.
- Golden cases `tests/cases.json` (6 cases: `lastn`, `create_observation`, `search_patients`, the country backfill patch, ADR-0002 national health ID, bug SL-133).
