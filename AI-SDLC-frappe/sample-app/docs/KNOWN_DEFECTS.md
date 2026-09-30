# Known defects: spice_lite

This file lists the one defect left in on purpose for teaching, then the defects found while
building and testing the app on Frappe v15 with PostgreSQL 16 and MariaDB 10.11.
Each discovered defect has a status, and a test pins its current behaviour.

| ID | Kind | Where | Status |
|----|------|-------|--------|
| T-1 | **Teaching defect**: N+1 queries | `spice_lite/api/fhir.py` → `lastn()` | **Left in on purpose** |
| D-1 | Data fidelity: a missing Float is stored as `0.0` | `SL Observation.value` | Open. Pinned by a test |
| D-2 | Framework (v15 + Postgres): the `("is", "set")` filter on Datetime fails | frappe `model/db_query.py` | Worked around. Pinned by a test |
| D-3 | FHIR conformance: datetimes have no UTC offset | `api/mappers.py` `_iso()` | Open |
| D-4 | Audit lines were silently dropped (logger level) | `spice_lite/audit.py` | **Fixed**. Has a regression test |
| D-5 | `family="%"` listed every patient (LIKE wildcard) | `search_patients()` | **Fixed**. Has a test |
| D-6 | Framework (v15 + Postgres): some `search_index` indexes are never created | `SL Patient.country`, `SL Encounter.patient` | Open. Found by the course agents |
| D-7 | `lastn` code filter: a `system|code` token (e.g. `http://loinc.org|8867-4`) matches nothing | `lastn()` | Open. Found by the course agents |
| D-8 | `lastn` ordering: an undated `amended` Observation loses to the `final` it replaces | `lastn()` | Open. Found by the course agents |
| D-9 | `parse_token` drops the system part of an identifier token | `api/mappers.py` | Open. Found by the course agents |
| D-10 | Framework (v15 + Postgres): `FrappeTestCase.assertQueryCount` raises `TypeError` (LazyDecode) even under the limit | `frappe/tests/utils.py` | Open upstream. Count queries manually on Postgres |
| D-11 | PHI in logs on server errors: a 5xx in `create_observation` puts request values into the Error Log traceback, the `Form Dict` line of `frappe.log`, and the Postgres error log | `create_observation()` + Frappe error handling | Open. Found by the security-review skill (probes) |
| D-12 | PHI in URLs: `search_patients` and `get_patient` are GET methods, so `family` / `identifier` (MRN) end up in gunicorn/nginx access logs | `api/fhir.py` design | Open. Found by the security-review skill |

---

## T-1: TEACHING-DEFECT(perf-n+1) in `lastn()`

**Location:** `spice_lite/spice_lite/api/fhir.py`, in the `for s in subject_list:` loop of `lastn()`.
Search for the marker `TEACHING-DEFECT(perf-n+1)`.

**What it does:** for each requested subject it calls
1. `frappe.get_doc("SL Patient", s)`, which is one query for each subject, and
2. `frappe.get_all("SL Observation", filters=..., order_by=..., fields=["*"])`, which is one more query
   for each subject. It fetches **every column of every matching observation** for that patient and
   then keeps only `rows[0]`.

So a call with N subjects costs at least 2N queries, plus per-document permission work.
`MAX_LASTN_SUBJECTS = 100` means a single request can make 200+ database round trips.

**Secondary smell inside the same defect:** `frappe.get_all` runs with `ignore_permissions=True`
(see `apps/frappe/frappe/__init__.py`, `def get_all`). The loop does check `has_permission` on each
patient, but it skips row-level permission logic on `SL Observation`, such as `permission_query_conditions`
hooks and user permissions. The rest of the API uses `frappe.get_list`.

**How it is pinned:** `spice_lite/tests/test_fhir_api.py::test_lastn_query_count_grows_with_subjects`
counts SQL calls for 1 and for 5 subjects. It asserts that each extra subject adds at least 2 queries.

**Expected fix (for the learner):**
- Validate the subjects with one `frappe.get_list("SL Patient", filters={"name": ("in", subjects)}, pluck="name")`.
  This is permission-aware and drops unknown or forbidden ids.
- Fetch the candidate observations in one permission-aware `frappe.get_list("SL Observation", ...)`
  with explicit `fields` and `order_by="effective_datetime desc, creation desc"`. Then keep the first
  row per patient in Python. At scale, use a window function (`ROW_NUMBER() OVER (PARTITION BY patient ...)`),
  but note that `frappe.qb` and raw SQL do **not** apply permissions.
- Replace the pinning test with an assertion that the query count is a small constant K for 1 and for 5 subjects,
  using the same counting approach as the existing test. Do **not** use `FrappeTestCase.assertQueryCount` on
  Postgres: in v15.121.2 it raises `TypeError` (see D-10). On MariaDB it works and asserts `<= K`.
- Keep `test_lastn_returns_latest_per_patient` green. It covers "latest wins", filtering by
  code, undated rows, and missing subjects.

---

## D-1: a missing Float is stored as `0.0`

Frappe creates Float columns as `NOT NULL DEFAULT 0`. `BaseDocument.get_valid_dict` also coerces
`None` to `flt(None) == 0.0` (see `apps/frappe/frappe/model/base_document.py`, the branch
`elif df.fieldtype in float_like_fields`). A `preliminary` Observation saved without a value
therefore reads back as `value = 0.0`. If it also has a unit, `observation_to_fhir` emits
`valueQuantity.value = 0.0`. In a clinical system, a missing measurement that turns into a zero is
a patient-safety risk.

- **Guard today:** `final` and `amended` require a value at `validate()`, before the coercion happens.
- **Pinned by:** `test_sl_observation.py::test_missing_value_is_stored_as_zero_known_defect`
- **Fix options:** add a `has_value` Check field, or store the value as `Data` and parse it. Another
  option is `data_absent_reason` (the FHIR way: emit `dataAbsentReason` instead of `valueQuantity`).

## D-2: the `("is", "set")` filter on a Datetime column breaks on Postgres (frappe v15)

`frappe/model/db_query.py` (`prepare_filter_condition`, the `elif f.operator.lower() == "is":` branch)
turns `("is", "set")` into `col != ''`. MariaDB accepts that comparison. Postgres rejects it:
`invalid input syntax for type timestamp: ""`. The error also **aborts the whole transaction**, so
every later query fails with `InFailedSqlTransaction`, including queries in other tests.
`bench new-site --db-type postgres` warns: *"PostgreSQL support is limited to Frappe v16 and above.
Fixes for earlier versions will not be added."* (`apps/frappe/frappe/commands/site.py`).

- **Workaround in `lastn()`:** filter with `(">", "1900-01-01 00:00:00")`, which excludes NULLs on both databases.
- **Related Postgres trap:** `ORDER BY x DESC` puts NULLs **first** on Postgres and last on MariaDB.
  The filter above avoids that difference too.
- **Pinned by:** `test_fhir_api.py::test_framework_defect_is_set_filter_on_datetime`. The test asserts
  that the filter raises **only** when `frappe.db.db_type == "postgres"`. It rolls back to a savepoint
  because of the transaction abort. When this test runs, frappe prints a harmless
  `Error in query: invalid input syntax for type timestamp` line.

## D-3: FHIR datetimes carry no timezone

Frappe stores naive datetimes in the site's `time_zone` (a new site defaults to `Asia/Kolkata`).
`_iso()` emits `2026-09-30T13:26:09` with no offset. FHIR `dateTime` requires an offset whenever a
time is present. **Fix:** in `fhir.py`, localise with `frappe.utils.get_system_timezone()` and emit
`+05:30` (or UTC `Z`). Keep `mappers.py` frappe-free by passing the tz name in.

## D-4 (fixed): audit lines were silently dropped

`frappe.logger()` sets the logger level to `frappe.log_level or default_log_level`, and
`default_log_level` is `ERROR`, or `WARNING` under `bench serve`
(`apps/frappe/frappe/utils/logger.py`). The first version of `audit.log_access()` called `.info()`,
so it wrote nothing. The log files existed but stayed empty. **Fix:** `audit._logger()` sets
`logging.INFO` on its own logger. **Regression test:** `test_audit_logger_emits_info`.
Related trap: do **not** pass `with_more_info=True`. `SiteContextFilter` then appends
`frappe.form_dict`, the request parameters (PHI such as a family name), to every line.

## D-5 (fixed): LIKE wildcards in `family`

`search_patients(family="%")` became `last_name LIKE '%%'` and returned every patient the caller can
read. That turned "search" into "enumerate". Frappe's filter layer doubles backslashes in LIKE
values (`db_query.py`: `value.replace("\\", "\\\\").replace("%", "%%")`), so a literal `%` or `_`
cannot be escaped through `get_list` filters. **Fix:** a `family` that contains `%`, `_` or `\`
returns 400 `OperationOutcome` (`invalid`). **Test:** `test_search_rejects_like_wildcards`.

---

## D-6: some `search_index` indexes are never created on Postgres

**Found by:** a course writer agent while capturing SQL for the `explain-endpoint` skill; confirmed with `pg_indexes`.

**What happens:** Frappe v15 on Postgres names a `search_index` index after the bare field name (`country`, `patient`). Postgres index names are unique per schema, not per table, so when another table already owns an index with that name (for example `tabAddress Template` has `country`), the index is silently not created. On the test site, `tabSL Patient` has `last_name` but no `country` index, and `tabSL Encounter` has no `patient` index, while `tabSL Observation` does have `patient` and `code`.

**Check:** `select tablename, indexname from pg_indexes where tablename like 'tabSL %' order by 1, 2;`

**Impact:** filters on `SL Patient.country` and `SL Encounter.patient` do sequential scans. Harmless at test-site size, visible at country scale.

**Expected fix (for the learner):** a patch that creates explicitly named indexes (`frappe.db.add_index("SL Patient", ["country"], index_name="sl_patient_country_idx")`), plus a check in `scripts/automation/` that every `search_index` field has an index in `pg_indexes`.

---

## D-7 to D-10 (found by the course agents while writing skills)

- **D-7:** `lastn(subjects, code="http://loinc.org|8867-4")` returns no rows because the code filter compares the whole token with `SL Observation.code`. FHIR search tokens are `system|code`.
- **D-8:** when a `final` Observation is corrected by an `amended` one that has no `effective_datetime`, `lastn` orders by `effective_datetime desc` and returns the superseded `final`.
- **D-9:** `mappers.parse_token("urn:example:mrn|MRN-000123")` returns only the value, so a caller cannot tell which identifier system was asked for.
- **D-10:** on Postgres, `with self.assertQueryCount(k):` raises `TypeError` from Frappe's query-recording wrapper (LazyDecode) in v15.121.2. Tests that need a query budget count `frappe.db.sql` calls themselves, as `test_lastn_query_count_grows_with_subjects` does. D-1 (missing Float stored as 0.0) also affects `lastn`, which returns such values as `0.0`.

- **D-11:** verified with the security-review probes in `.claude/skills/security-review/probes/`. Frappe records `frappe.form_dict` with unhandled exceptions, so any 5xx on a clinical write copies submitted values into three logs.
- **D-12:** verified by a request through gunicorn: the access-log line contains the query string. Moving search to POST (or a search body) keeps search terms out of access logs; the same applies to any proxy in front of the site.
