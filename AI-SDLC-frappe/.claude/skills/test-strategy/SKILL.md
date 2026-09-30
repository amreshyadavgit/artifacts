---
name: test-strategy
description: Produce a risk-based test plan for a change to the spice_lite Frappe app covering unit, integration, API, negative, edge, performance, security and regression tests, mapped to FrappeTestCase, stdlib unittest, frappe.set_user, a query counter, and bench run-tests flags per context/standards/testing-standards.md. Lists existing coverage, defects found while planning, and exact TestClass#test_method names.
when_to_use: Before implementing a change or after an ADR is drafted; when asked "what should we test", "write a test plan", "how do we test this whitelisted method or DocType"; when the tester agent starts work.
argument-hint: "[whitelisted method, DocType, ADR path, or change description]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git status *)
---

# Test strategy for a spice_lite change

Change to plan tests for: $ARGUMENTS

If the argument is a path (an ADR under `docs/adr/`, a handoff under `.ai-sdlc/runs/`), Read it first. If it is empty, plan for the uncommitted diff:

!`git diff --stat HEAD -- sample-app`

You write a plan, not tests. The tester agent (or a human) implements it.

## Procedure

1. **Find the change surface.** Locate every element the change touches, as `path:line` plus a verbatim quote:
   - the whitelisted method in `sample-app/spice_lite/spice_lite/api/fhir.py`: decorator (`methods=[...]`, no `allow_guest`), parameters and their type hints (Frappe enforces hints through pydantic when `frappe.flags.in_test` is set, so an unhinted parameter such as `subjects` is not validated),
   - permission checks (`frappe.has_permission`, `frappe.get_list`) and anything that bypasses them (`frappe.get_all`, `frappe.db.sql`, `frappe.qb`, `ignore_permissions=True`),
   - controller rules (`validate`, `on_update`, `on_trash`) in `clinical/doctype/<name>/<name>.py`,
   - the DocType JSON (`reqd`, `unique`, `search_index`, `permissions`), `patches.txt`, and `hooks.py` entries,
   - pure mappers in `api/mappers.py`.
2. **Inventory existing coverage.** Grep `sample-app/spice_lite/spice_lite` for `def test_` in `tests/test_*.py`, `tests/unit/test_*.py` and `clinical/doctype/*/test_*.py` that call the method or DocType. List each with what it proves. Reference them with status `existing`; never re-plan one.
3. **Read the standards.** `context/standards/testing-standards.md` (layers, users, naming, rollback), `context/standards/api-standards.md` (status codes, `Bundle`, `OperationOutcome`), the business rules in `context/domain/spice-lite-glossary.md`, and `sample-app/docs/KNOWN_DEFECTS.md` (open defects the plan must pin, not fix).
4. **Analyse risk.** For each element ask: which legal but unusual input breaks it (empty, duplicate, `None`, boundary such as 100 vs 101, equal timestamps, token `system|code`, Postgres versus MariaDB ordering)? Which error path answers (`_error` status and `issue[0].code`)? Who may call it (Guest, `norole@spice-lite.test`, `clinician@spice-lite.test`, a user with User Permissions)? How many SQL queries for N rows? Can PHI reach the audit log, Error Log or an `OperationOutcome`? Write each defect as a finding (`TS-001`...) in the canonical format. Mark behaviour inferred without running as "reasoned from code".
5. **Design cases.** Fill [TEST_PLAN_TEMPLATE.md](TEST_PLAN_TEMPLATE.md). Take the tool for each category, the `bench run-tests` flags and the harness facts from [tooling-map.md](tooling-map.md). Each case gets `TestClass#test_method`, a concrete scenario, an observable expectation (HTTP status from `tests/utils.py::call`, a JSON field, a query count), and a status: `existing`, `new`, or `new-failing`.
6. **Cover all eight categories.** unit, integration, api, negative, edge, performance, security, regression. A category may be `N/A: <reason>` only when there is genuinely nothing to test there.
7. **Prioritise.** Within each category, order cases that guard `high` or `critical` findings first.
8. **Hand off.** End with the files to create and the exact commands: `bench --site test.localhost run-tests --module spice_lite.tests.<module>` (from the bench directory, as the bench user) for integration tests, and `cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .` for unit tests. The run-tests skill (module 02) runs and summarises them.

## Rules
- Synthetic data only: `tests/utils.py` helpers (`make_patient` generates a random `MRN-` value, `make_observation`, `ensure_test_users`), LOINC codes from the glossary. Never name a real person.
- `FrappeTestCase` rolls back once per class, not per test: every test creates its own records and asserts on them only, never on global counts.
- Anything that writes to redis (User Permissions, cached roles) is not rolled back: plan an explicit delete in `finally`.
- Plan the performance test with a query counter. `FrappeTestCase.assertQueryCount` raises `TypeError` on Postgres in Frappe v15.121.2 (see tooling-map.md); use it only on MariaDB.
- Unit tests use only the standard library: `bench run-tests --app` imports every `test_*.py` in the app, and the bench venv has no pytest.
- Do not plan to fix `TEACHING-DEFECT(perf-n+1)` or the open defects in `KNOWN_DEFECTS.md`; plan the test that detects each and mark it `new-failing` with a ticket id. A `new-failing` test ships with `@unittest.skip("<ticket>: <reason>")`.
- Keep the plan structure exactly as in the template. `scripts/validate-test-plan.mjs` checks it; with `--repo .` it also checks that every `existing` test exists, every `new` one does not, and every `path:line` resolves.
