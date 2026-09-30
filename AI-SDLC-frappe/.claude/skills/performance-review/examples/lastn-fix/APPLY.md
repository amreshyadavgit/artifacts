# Proving the lastn fix: apply, test, revert

The course keeps `TEACHING-DEFECT(perf-n+1)` in `sample-app/` (CLAUDE.md rule 8). The bench runs the app from the repo through a symlink (`apps/spice_lite -> sample-app/spice_lite`), so "a scratch copy" means: apply the patch, run the tests, and revert, all in one go.

| File | Purpose |
|---|---|
| `test_lastn_query_count.py` | 3 `FrappeTestCase` tests on 100 synthetic patients: statements for 1, 20 and 100 subjects with `assertQueryCount(6)`, latest-per-patient in request order, 101 subjects rejected with 400. Prints the SQL of the 20-subject call between `LASTN_BEGIN` and `LASTN_END` |
| `lastn-set-based.patch` | `fhir.py`: permission-aware set-based `lastn` (3 queries). `tests/test_fhir_api.py`: replaces the pinning test `test_lastn_query_count_grows_with_subjects` with `test_lastn_query_count_is_constant`. `tests/utils.py`: `PostgresQueryCountMixin` |
| `sql-before.log`, `sql-after.log` | The statements captured for `lastn(subjects=20, code="8480-6")` on test.localhost, input for `scripts/count-queries.mjs` |

## Commands (from `AI-SDLC-frappe/`, as the bench user)

```bash
APP=sample-app/spice_lite
EX=.claude/skills/performance-review/examples/lastn-fix
cp $EX/test_lastn_query_count.py $APP/spice_lite/tests/

# 1. Prove the defect: the constant-count test fails, 2 statements per subject
(cd /home/user/frappe-bench && bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_query_count) 2>&1 | grep -E "LASTN_QUERY_COUNT|^Ran|^OK|^FAILED|AssertionError" | tee /tmp/lastn-before.txt

# 2. Apply the fix and run the new test and the whole suite
(cd $APP && git apply ../../$EX/lastn-set-based.patch)
(cd /home/user/frappe-bench && bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_query_count) 2>&1 | grep -E "LASTN_QUERY_COUNT|^Ran|^OK|^FAILED"
(cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite) 2>&1 | tail -3

# 3. Revert: sample-app is back to the shipped state
git checkout -- $APP/spice_lite/api/fhir.py $APP/spice_lite/tests/test_fhir_api.py $APP/spice_lite/tests/utils.py
rm $APP/spice_lite/tests/test_lastn_query_count.py
git status --short sample-app        # prints nothing
```

On the shared course bench, wrap steps 1 to 3 in one `flock /tmp/spice-bench.lock bash -c '...'` so no other run sees the patched files, and put the revert in a `trap ... EXIT` so it runs even if a step fails.

## Recorded results (2026-09-30, Frappe 15.121.2, PostgreSQL 16 site test.localhost)

```text
=== BEFORE (shipped app)
AssertionError: 200 not less than or equal to 6 : Queries executed:
Ran 3 tests in 8.356s
FAILED (failures=1)
LASTN_QUERY_COUNT subjects=1 queries=2 rows_returned_by_sql=5
LASTN_QUERY_COUNT subjects=20 queries=40 rows_returned_by_sql=100
LASTN_QUERY_COUNT subjects=100 queries=200 rows_returned_by_sql=500
=== AFTER (patched)
Ran 3 tests in 7.073s
OK
LASTN_QUERY_COUNT subjects=1 queries=3 rows_returned_by_sql=3
LASTN_QUERY_COUNT subjects=20 queries=3 rows_returned_by_sql=60
LASTN_QUERY_COUNT subjects=100 queries=3 rows_returned_by_sql=300
=== AFTER on MariaDB (mariadb.localhost)
Ran 3 tests in 4.492s
OK            (same three LASTN_QUERY_COUNT lines)
=== AFTER full app suite (46 shipped tests + the 3 above)
Ran 49 tests in 10.159s
OK
```

"rows_returned_by_sql" counts rows from every statement: before, 1 patient row plus 4 observation rows per subject; after, 1 patient name, 1 aggregate row and 1 observation row per subject. With real histories the "before" number grows with each patient's history; the "after" number does not.

## Two Frappe v15 facts this depends on
- **`assertQueryCount` crashes on Postgres.** `FrappeTestCase.assertQueryCount` builds its failure message with `"\n\n".join(queries)` before comparing, and on Postgres `frappe.db.last_query` is a `LazyDecode`, not a `str`. Every use raises `TypeError: sequence item 0: expected str instance, LazyDecode found`, pass or fail. `PostgresQueryCountMixin` exposes `last_query` as `str` for the duration of the block. It must patch `frappe.db.__class__`, not `type(frappe.db)`: `frappe.db` is a `LocalProxy`.
- **Permissions stay on.** Both observation queries go through `frappe.get_list`, so User Permissions and `permission_query_conditions` apply. With the patch applied, security probes 1 and 2 (`.claude/skills/security-review/probes/`) stop reproducing SEC-001.

The patch changes query shape only. D-1 (missing value stored as 0.0), D-2 (the `("is", "set")` workaround stays) and D-3 (no timezone offset) in `sample-app/docs/KNOWN_DEFECTS.md` are unchanged.
