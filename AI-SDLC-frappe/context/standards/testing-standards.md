# Testing standards (spice_lite)

| Layer | Tooling | Required for |
|---|---|---|
| Unit | `python -m unittest discover -s spice_lite/tests/unit -t .` (no site) | mappers and pure helpers |
| Integration | `frappe.tests.utils.FrappeTestCase`, `bench --site test.localhost run-tests --app spice_lite` | controllers, validations, whitelisted methods |
| Negative | FrappeTestCase | `frappe.ValidationError` on bad input; `OperationOutcome` 4xx from the API |
| Permission | `frappe.set_user(...)` with `clinician@spice-lite.test` and `norole@spice-lite.test` | every whitelisted method and every DocType permission change |
| Performance smoke | a query-count assertion (count `frappe.db.sql` calls as in `test_lastn_query_count_grows_with_subjects`; `assertQueryCount` breaks on Postgres in v15, D-10) | any method that returns collections |
| Regression | a test named after the defect id, e.g. `test_d5_family_wildcard_rejected` | every bug fix |
| Patch | run the patch function in a test against seeded rows | every patch in `patches.txt` |

Rules
- Every bug fix starts with a failing test.
- Tests create their own synthetic records and clean up (FrappeTestCase rolls back per test class).
- Always `frappe.set_user("Administrator")` in `tearDown` after switching users.
- `bench --site test.localhost run-tests --app spice_lite` must pass before a handoff is marked `complete`.
