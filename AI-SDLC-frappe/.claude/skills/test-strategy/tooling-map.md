# Test categories mapped to this repo's tooling (Frappe v15)

Every plan uses these eight categories. The `tool` column of a test case names the tooling below. Everything here ships with Frappe v15 or the Python standard library; the bench venv has no pytest, so do not plan tests that need it.

| Category | Tooling | Where | Pattern in this repo |
|---|---|---|---|
| unit | stdlib `unittest.TestCase`, no Frappe import, no site | `sample-app/spice_lite/spice_lite/tests/unit/` | `from spice_lite.api import mappers as m`; `m.observation_to_fhir({...})` on plain dicts |
| integration | `FrappeTestCase` (`from frappe.tests.utils import FrappeTestCase`) against the real site database | `tests/test_*.py`, `clinical/doctype/<name>/test_<name>.py` | `make_patient()` then `self.assertRaises(frappe.ValidationError, ...)`; controller rules, patches, Frappe hooks |
| api | `FrappeTestCase` + `tests/utils.py::call(fn, **kwargs)`, which calls the whitelisted function in-process and returns `(http_status, body)` | `tests/test_*.py` | `status, body = call(fhir.lastn, subjects=[p.name])`; assert `body["resourceType"]`, `total`, `entry[].resource` |
| negative | `FrappeTestCase` + `call()` | same | `(status, body["issue"][0]["code"])` equals `(400, "invalid")`, `(400, "required")`, `(400, "too-costly")`, `(403, "forbidden")`, `(404, "not-found")`, `(422, "invalid")` |
| edge | `FrappeTestCase` + `call()`, or `unittest` for pure mappers | same | duplicates, `None` values, equal timestamps, 100 vs 101 subjects, `system\|code` tokens, undated rows |
| performance | query counter: patch `frappe.db.__class__.sql` and count calls (`count_queries()` in `examples/test_lastn_plan.py`, or the inline counter in `test_fhir_api.py::test_lastn_query_count_grows_with_subjects`) | same | warm caches with one call, then count a second call; assert `<= K` |
| security | `frappe.set_user(CLINICIAN / NO_ROLE_USER)`, `frappe.whitelisted`, `frappe.guest_methods`, `frappe.allowed_http_methods_for_whitelisted_func`, `frappe.permissions.add_user_permission` | same | 403 `forbidden` for `norole@spice-lite.test`; method not in `frappe.guest_methods`; `["GET"]` only |
| regression | an existing test that must keep passing, or a new one named after the defect id | same | `test_d5_family_wildcard_rejected` style (`testing-standards.md`), `test_framework_defect_*` pins |

## Commands and `bench run-tests` flags (run from the bench directory, as the bench user)
| Goal | Command |
|---|---|
| Whole app (integration + unit, 46 today) | `bench --site test.localhost run-tests --app spice_lite` |
| One module | `bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api` |
| One test method | `bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_lastn_returns_latest_per_patient` (`--test` is repeatable) |
| One test class | `bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --case TestFhirApi` |
| One DocType's tests | `bench --site test.localhost run-tests --doctype "SL Observation"` |
| Per-test names | `bench --verbose --site test.localhost run-tests --app spice_lite` (`--verbose` belongs to `bench`, not to `run-tests`) |
| Stop at first failure, CI report | `--failfast`, `--junit-xml-output report.xml`, `--coverage` |
| Same suite on MariaDB | `bench --site mariadb.localhost run-tests --app spice_lite` |
| Unit tests without a bench | `cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .` |

`run-tests` needs `allow_tests` in the site config (`bench --site test.localhost set-config allow_tests true`, done by `setup-bench.sh`). It exits 0 even when tests fail unless the `CI` environment variable is set (`frappe/commands/utils.py`: `if os.environ.get("CI"): sys.exit(ret)`), so a plan's exit criteria read the final `OK` / `FAILED` line and the `Ran N tests` count, or use `CI=1 bench --site test.localhost run-tests ...` when an exit code gates something.

## Facts about the harness that change test design
- **Rollback is per class.** `FrappeTestCase.setUpClass` commits, then rolls back when the class ends. Records created in one test are visible to the next test of the same class. Use unique values (`make_patient()` generates the MRN) and a fresh patient per test in `setUp`.
- **Redis is not rolled back.** User Permissions and roles are cached in redis. A test that adds a User Permission deletes it in `finally` (its `on_trash` clears the cache).
- **Always reset the user.** `tearDown` calls `frappe.set_user("Administrator")`.
- **`run-tests` does not migrate.** DocType JSON is read from the database, not the file. A field or permission added to a DocType JSON is invisible to tests until `bench --site test.localhost migrate` (an `ask` rule in `.claude/settings.json`). A green run proves nothing about an unmigrated schema change.
- **Test records.** `frappe/test_runner.py` `make_test_records` creates records for Link targets (including frappe's own `User` test records) and commits them. spice_lite uses the helpers in `tests/utils.py` instead of `test_records`.
- **Postgres specifics (primary database).** Any SQL error aborts the whole transaction (`InFailedSqlTransaction` until rollback): wrap an expected failure in `frappe.db.savepoint(...)` / `frappe.db.rollback(save_point=...)` as `test_framework_defect_is_set_filter_on_datetime` does. `ORDER BY x DESC` puts NULLs first on Postgres and last on MariaDB.
- **`assertQueryCount` is broken on Postgres (Frappe v15.121.2).** It builds its message with `"\n\n".join(queries)` (`apps/frappe/frappe/tests/utils.py:144`), and on Postgres every entry is a `LazyDecode`, so it raises `TypeError: sequence item 0: expected str instance, LazyDecode found` as soon as one query runs, even under the limit. It works on MariaDB. Measured with `assertQueryCount(1000)` around one `lastn` call: `ERROR` on `test.localhost`, `OK` on `mariadb.localhost`.
- **Type hints are enforced in tests.** With `frappe.flags.in_test`, hinted parameters are validated and coerced by pydantic (`value="72"` becomes `72.0`). Unhinted parameters (`lastn(subjects, ...)`) are not.
- **Background jobs.** `frappe.enqueue(..., now=True)` calls the function directly, which is the deterministic way to test a job body.
- **Test users.** `ensure_test_users()` creates `clinician@spice-lite.test` (Clinician) and `norole@spice-lite.test` (no roles).
- **Status values in a plan.** `existing` (method already in the app's tests), `new` (passes against current code once written), `new-failing` (fails today because of a defect the plan found; ship with `@unittest.skip("<ticket>: reason")` until the fix).
