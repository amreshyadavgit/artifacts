# Performance review checklist (spice_lite, Frappe v15)

Paths are relative to `AI-SDLC-frappe/`. `APP` = `sample-app/spice_lite/spice_lite`. Frappe and bench references are to the v15 source in the bench (`apps/frappe/`) and to bench 5.31's templates (`bench/config/templates/`). Production defaults quoted here are bench's; check the site's `common_site_config.json` values with a human (agents do not read that file).

## queries
- List every database call on the request path: `frappe.get_doc` (1 query for the doc, plus 1 per child table), `frappe.get_list` / `get_all` (1, plus permission lookups that are usually cached in Redis), `frappe.db.get_value` / `exists` / `count` (1 each), `doc.insert()` / `save()` (several: link validation, naming series, the write itself, and on `save()` a Version row when `track_changes` is on).
- Rows the query returns versus rows the response needs. `lastn` on the shipped app returns every matching observation of a patient to keep `rows[0]` (5 rows per subject with 4 observations each in the test; a patient with a year of history returns hundreds).
- Columns: `fields=["*"]` in a hot path loads every column including `_comments`, `_liked_by` and PHI columns the response never uses. Use explicit `fields`.
- Read the generated SQL: `frappe.db.sql` wrapped in a test (see `examples/lastn-fix/test_lastn_query_count.py`) or `bench --site test.localhost run-tests ... --profile`. On Postgres, `get_list` with `pluck="name"` and an `in` filter renders `cast("tabSL Patient"."name" as varchar) in (...)`; `EXPLAIN` on test.localhost shows it still uses `"tabSL Patient_pkey"`.

## indexes
- Every field used in a `filters` key, `order_by` or join needs an index: `search_index: 1` in the DocType JSON, `unique: 1`, or a patch calling `frappe.db.add_index(doctype, fields, index_name)`.
- **Frappe v15 on Postgres names a `search_index` index after the field only** (`sample-app/docs/KNOWN_DEFECTS.md` D-6) (`CREATE INDEX IF NOT EXISTS "<fieldname>"`, `frappe/database/postgres/schema.py` lines 63 and 115). Postgres index names are unique per schema, so the second DocType with the same indexed fieldname silently gets no index. On test.localhost: `tabSL Encounter.patient` and `tabSL Patient.country` have `search_index: 1` and **no index** (the names `patient` and `country` belong to `tabSL Observation` and `tabAddress Template`). MariaDB names indexes per table, so `mariadb.localhost` has both. Check with:
  ```sql
  select tablename, indexname from pg_indexes where tablename like 'tabSL%' order by 1, 2;
  ```
  Fix with a post-model-sync patch that calls `frappe.db.add_index("SL Encounter", ["patient"], "sl_encounter_patient_idx")` (explicit, unique names).
- `lastn` filters on `patient`, `code`, `effective_datetime` and orders by `effective_datetime desc, creation desc`. Single-column `patient` and `code` indexes exist; a composite `(patient, code, effective_datetime)` index serves the `max(...) group by patient` query of the fix directly.
- Confirm with `EXPLAIN (ANALYZE, BUFFERS)` on a synthetic dataset, never on production data.

## n+1
- Any `frappe.get_doc`, `get_all`, `get_list`, `db.get_value`, `db.count` or `db.exists` inside `for` over names or rows. Grep `for .* in ` in `APP/api` and `APP/**/doctype/**/*.py` and read the loop bodies. Also controller methods called per row (`doc.save()` in a loop runs the whole lifecycle each time).
- `doc_events` and controller `on_update` that query: a bulk import that saves 500 documents runs them 500 times.
- Measure: statements for 1 subject vs 20 vs 100. Constant is fine; linear is an N+1. The shipped `lastn`: 2, 40, 200.

## caching
- `frappe.cache` (a `RedisWrapper`): `get_value(key, generator=...)`, `set_value(key, val, expires_in_sec=...)`, `hget/hset`, and the decorators `@request_cache`, `@site_cache(ttl=...)`, `@redis_cache(ttl=...)` in `frappe/utils/caching.py`. Keys are namespaced per site by `make_key`; raw `get/set` on the wrapper skip the prefix.
- Is the data cacheable at all? Latest observations change on every POST; caching them needs invalidation in `SL Observation.on_update`, and a cached clinical row is PHI in Redis. Reference data (LOINC display names, `SL Country`) is a good fit.
- Frappe already caches roles and user permissions in Redis; the permission lookups of `get_list` are usually cache hits after the first call (the query-count test warms them first).

## latency
- Per-request bound on work: `MAX_LASTN_SUBJECTS = 100` caps subjects, not rows; `search_patients` uses `limit_page_length=MAX_SEARCH_RESULTS` (50).
- Timeouts in a bench production setup (`bench setup supervisor` / `systemd`): gunicorn `-t {http_timeout}` (default 120 s), nginx `proxy_read_timeout {http_timeout or 120}`. A request longer than that is killed (`[CRITICAL] WORKER TIMEOUT` in `logs/web.error.log`) and nginx answers 502/504. There is no Frappe statement timeout on Postgres by default; set `statement_timeout` on the database role if you want one.
- Anything slow and not needed for the response goes to `frappe.enqueue(..., queue=..., timeout=..., job_id=..., deduplicate=True)` or `enqueue_after_commit=True`.

## concurrency
- gunicorn in bench production runs **sync** workers: `-w {gunicorn_workers}` with a default of `cpu_count() * 2 + 1` (bench `config/common_site_config.py`). One slow request occupies one worker completely; with 9 workers, 9 concurrent slow requests queue everything else, including desk and login.
- RQ: bench starts one worker per queue by default (`background_workers: 1`) for `default`, `short` and `long`. Queue timeouts: `short` 300 s, `default` 300 s, `long` 1500 s (`frappe/utils/background_jobs.py`). A job that exceeds its timeout is killed (`JobTimeoutException`) and does not retry by itself. Queue keys in Redis are `rq:queue:<bench_id>:<queue>`, so `LLEN rq:queue:<bench_id>:short` is the backlog.
- Web requests and jobs share one Postgres. A heavy import job on `long` and a web N+1 compete for the same CPU and buffers.
- Check-then-act sequences (`validate_unique_mrn` then insert) are races, not locks; the unique constraint is the real guard. Report races to security-review too.

## memory
- Rows hydrated per request: `frappe.get_all(..., fields=["*"])` returns `frappe._dict` rows; 100 subjects times a deep history is tens of thousands of dicts in one gunicorn worker.
- gunicorn `--max-requests 5000 --max-requests-jitter 500` recycles workers, which hides slow leaks but not per-request peaks.
- RQ jobs that load whole tables (`frappe.get_all` without `limit` over `SL Observation`) grow the worker; page with `limit_start`/`limit_page_length` or `as_iterator=True` on `frappe.db.sql`.

## cpu
- Python work per row that the database could do (sorting or filtering after loading everything). The shipped `lastn` sorts in SQL but discards all rows but one per patient in Python.
- JSON serialisation of large `Bundle` responses and FHIR mapping per row runs in the gunicorn worker.
- Postgres CPU: sequential scans caused by missing indexes (see the Postgres index-name trap above) under concurrent requests.

## network
- Round trips per request: each statement is one round trip to Postgres. 200 statements at 1 ms is 0.2 s before any work; under load it is much more.
- Payload size: `Bundle` responses grow with the number of subjects; `lastn` returns one observation per subject, `search_patients` at most 50 patients.
- URL length: 100 subject names in a GET query string is about 1.5 KB; nginx `large_client_header_buffers` defaults allow 8 KB per request line. Prefer POST for larger batches (also keeps identifiers out of access logs, see security-review SEC-003).
