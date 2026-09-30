# Answer key: /performance-review sample-app/ (unmodified spice_lite, 2026-09-30)

Measured on test.localhost (PostgreSQL 16) and mariadb.localhost with `examples/lastn-fix/test_lastn_query_count.py`; indexes read from `pg_indexes` and `information_schema.statistics`.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| PERF-001 | high | n+1 | sample-app/spice_lite/spice_lite/api/fhir.py:155-184 | `for s in subject_list:` ... `patient = frappe.get_doc("SL Patient", s)` ... `rows = frappe.get_all("SL Observation", filters=filters, order_by="effective_datetime desc, creation desc", fields=["*"])` ... `results.append(observation_to_fhir(rows[0]))`. Measured: `LASTN_QUERY_COUNT subjects=1 queries=2`, `subjects=20 queries=40`, `subjects=100 queries=200`; `count-queries.mjs sql-before.log`: two shapes repeated 20 times each | Apply `examples/lastn-fix/lastn-set-based.patch` (3 queries for any number of subjects, still permission-aware); keep `test_lastn_query_count` as the regression test |
| PERF-002 | medium | queries | sample-app/spice_lite/spice_lite/api/fhir.py:177-182 | `fields=["*"]` and no limit: every matching observation of each subject is returned to keep `rows[0]`; `rows_returned_by_sql=500` for 100 subjects with 4 observations each, growing with each patient's history | Fetch only the latest row per patient with explicit fields (the patch returns 3 rows per subject) |
| PERF-003 | medium | indexes | sample-app/spice_lite/spice_lite/clinical/doctype/sl_encounter/sl_encounter.json | `patient` has `search_index: 1`, but on Postgres `pg_indexes` shows no index on `tabSL Encounter` except the primary key; same for `tabSL Patient.country`. Frappe v15 names the index `"patient"` / `"country"`, names already taken by `tabSL Observation` and `tabAddress Template` (`frappe/database/postgres/schema.py` lines 63, 115; KNOWN_DEFECTS.md D-6). mariadb.localhost has both indexes | Post-model-sync patch with `frappe.db.add_index("SL Encounter", ["patient"], index_name="sl_encounter_patient_idx")` and the same for `SL Patient.country`; a check that every `search_index` field has an index in `pg_indexes` |
| PERF-004 | low | indexes | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.json | single-column `patient` and `code` indexes only; `EXPLAIN` of the fix's grouped query on test.localhost (empty table, `enable_seqscan=off`) uses the `code` index and filters `patient` row by row | Composite `(patient, code, effective_datetime)` index in the same patch; confirm with `EXPLAIN (ANALYZE, BUFFERS)` on a synthetic dataset |
| PERF-005 | medium | concurrency | sample-app/spice_lite/spice_lite/api/fhir.py:35 | `MAX_LASTN_SUBJECTS = 100` caps subjects, not cost; one call is 200 statements and holds a gunicorn sync worker for its whole duration (bench default `-w` = `cpu_count() * 2 + 1`) | After the fix, add a per-user rate limit on `lastn`; size the cap from a measured cost per call |
| PERF-006 | info | latency | sample-app/spice_lite/spice_lite/api/fhir.py:83-89 | `search_patients` uses `frappe.get_list(..., limit_page_length=MAX_SEARCH_RESULTS)` (50) and a prefix LIKE on the indexed `last_name` | none; recorded as checked |

## Measurements
| scenario | statements | rows returned by SQL | how measured |
|---|---|---|---|
| shipped `lastn`, 1 / 20 / 100 subjects | 2 / 40 / 200 | 5 / 100 / 500 | `test_lastn_query_count.py`, test.localhost |
| patched `lastn`, 1 / 20 / 100 subjects | 3 / 3 / 3 | 3 / 60 / 300 | same test after `git apply lastn-set-based.patch`; same numbers on mariadb.localhost |
| full suite with the patch | 49 tests OK | | `bench --site test.localhost run-tests --app spice_lite` |

## Proposed fix
`.claude/skills/performance-review/examples/lastn-fix/lastn-set-based.patch`, proved by `examples/lastn-fix/test_lastn_query_count.py`; commands in `examples/lastn-fix/APPLY.md`. The patch also replaces the pinning test `test_lastn_query_count_grows_with_subjects` and adds `PostgresQueryCountMixin` (KNOWN_DEFECTS.md D-10).

## Checked and clean
- caching: nothing is cached today; observations change on every POST and cached rows would be PHI in Redis, so no cache is recommended before the query fix.
- memory, cpu, network: bounded by the fix above; 100 subject names in a GET query string is about 1.5 KB, under nginx's 8 KB request-line buffers.
- background jobs: spice_lite enqueues nothing (`hooks.py` has no `scheduler_events`); the v0_1 patch is a single `frappe.qb.update`.
