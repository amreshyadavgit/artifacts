# Skill: test-strategy (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/test-strategy/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | Platform engineering, tester-agent maintainers |
| Consumers | `tester` agent (preloaded via `skills: [test-strategy, run-tests]`, see module 05-agent-roster), humans via `/test-strategy <method, DocType or ADR>` |
| Writes files | No. The plan is returned as text; the tester agent writes the tests. |
| Golden cases | [tests/cases.json](tests/cases.json) (6 cases) |

## What it does
Produces a risk-based test plan for a change to `spice_lite`: change surface with `path:line` evidence, existing coverage, defects found while planning (canonical findings, ids `TS-NNN`), test cases with exact `TestClass#test_method` names, and a coverage matrix over eight categories (unit, integration, api, negative, edge, performance, security, regression) mapped to stdlib `unittest`, `FrappeTestCase`, the `tests/utils.py::call` helper, `frappe.set_user`, User Permissions, a query counter, and the `bench run-tests` flags (`--app`, `--module`, `--test`, `--case`, `--doctype`, `--failfast`, `--junit-xml-output`).

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure and rules |
| `TEST_PLAN_TEMPLATE.md` | Output structure (the only file with placeholders) |
| `tooling-map.md` | Category to tool to pattern, `bench run-tests` flags, and harness facts (per-class rollback, redis not rolled back, no migrate, Postgres specifics, `assertQueryCount` on Postgres) |
| `examples/lastn-test-plan.md` | Reference plan for `spice_lite.api.fhir.lastn` (24 cases, 7 findings) |
| `examples/test_lastn_plan.py` | The plan's integration cases as a `FrappeTestCase` module (14 tests) |
| `examples/test_lastn_mappers_unit.py` | The plan's new unit cases (stdlib `unittest`, no site) |
| `scripts/validate-test-plan.mjs` (+ `.test.mjs`, 10 tests) | Structure validator, existing/new test checker against the app's `test_*.py` files, golden-case grader |

## Measured on the bench (Postgres 16 and MariaDB 10.11)
- `test_lastn_plan.py` copied into `spice_lite/tests/`: `Ran 14 tests`, `OK (skipped=4)` on `test.localhost` and on `mariadb.localhost`.
- With the four `@unittest.skip` lines removed: 4 failures, one per finding (`[] != ['SLO-00002']`, `'SLO-00009' != 'SLO-00010'`, `0.0 == 0.0`, `40 not less than or equal to 10`).
- Unit example added to `tests/unit/`: `python -m unittest discover -s spice_lite/tests/unit -t .` gives `Ran 11 tests`, `OK`.
- `FrappeTestCase.assertQueryCount(1000)` around one `lastn` call: `TypeError ... LazyDecode` on Postgres, `OK` on MariaDB. The plan and the example use a query counter instead.

## Defects this skill surfaced
Planning `lastn` found three real defects besides the planted N+1 (all reproduced by the example tests): a `system|code` token matches nothing (TS-002), an undated amendment loses to the final it replaces (TS-003), and a newer preliminary Observation with no value is reported as 0.0 (TS-004, via D-1). It also found a Frappe v15 + Postgres test-harness defect: `assertQueryCount` cannot be used on Postgres (TS-005). They are findings and skipped tests, not fixes, because other modules depend on the app as it is.

## How to test
```bash
cd AI-SDLC-frappe
node --test .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs
node .claude/skills/test-strategy/scripts/validate-test-plan.mjs \
  .claude/skills/test-strategy/examples/lastn-test-plan.md --repo . --bench /home/user/frappe-bench \
  --case skills/test-strategy/tests/cases.json#ts-01-lastn
# Example tests: copy into the app only for the run, then remove them (from the bench directory, as the bench user)
cp .claude/skills/test-strategy/examples/test_lastn_plan.py sample-app/spice_lite/spice_lite/tests/
bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_plan     # Ran 14 tests, OK (skipped=4)
rm sample-app/spice_lite/spice_lite/tests/test_lastn_plan.py
```

## Change policy
- New categories or columns are a major bump and must be mirrored in `scripts/validate-test-plan.mjs`.
- When `testing-standards.md` changes, update `tooling-map.md` and re-run the golden cases.
- The `run:` facts in `tests/cases.json` were measured; re-measure them after any change to `sample-app` or a Frappe upgrade.
