# explain-endpoint reference: how a spice_lite whitelisted method runs

Frappe paths are relative to `apps/frappe/` in the bench (Frappe 15.121.2, commit `fd533e8d`). App
paths are relative to `AI-SDLC-frappe/`. Line numbers were read on 2026-09-30; re-check them with
`grep -n` before citing, because Frappe minor releases move lines.

## 1. Request pipeline (the same for every `/api/method/...` call)

| Step | Where | What happens | Status it can produce |
|---|---|---|---|
| 1 | `frappe/app.py:136` `application()` | `init_request`, then `validate_auth()` (line 144): session cookie, or `Authorization: token <key>:<secret>` / Basic (`frappe/auth.py` `validate_auth_via_api_keys`) | 401 on a bad token |
| 2 | `frappe/app.py:156` | path starts with `/api/` → `frappe.api.handle(request)` | |
| 3 | `frappe/api/v1.py:145` | `Rule("/method/<path:method>", endpoint=handle_rpc_call)`; `handle_rpc_call` (line 34) sets `form_dict.cmd` and calls `frappe.handler.handle()` | 404 for an unknown route |
| 4 | `frappe/handler.py:65` `execute_cmd` | `override_whitelisted_method(cmd)` (line 67: a `hooks.py` `override_whitelisted_methods` entry in ANY installed app can replace the method), then a Server Script with `_api` type, then `get_attr(cmd)` | 417 "Failed to get method" |
| 5 | `frappe/handler.py:83` → `frappe/__init__.py:878` `is_whitelisted` | not in `frappe.whitelisted`, or Guest calling a non-`allow_guest` method | **403** ("... is not whitelisted") |
| 6 | `frappe/handler.py:84` → `:99` `is_valid_http_method` | verb not in `@frappe.whitelist(methods=[...])` | **403** (`throw_permission_error`, not 405) |
| 7 | `frappe/__init__.py:829` `whitelist` wrapper | `validate_argument_types` coerces and checks type hints with pydantic when there is a request (or `flags.in_test`): `"72"` becomes `72.0` for `float` | 417 on a type error |
| 8 | `frappe/handler.py:86` → `frappe/__init__.py:1765` `frappe.call` | `get_newargs` drops query/body keys the function does not accept, then calls it with `**form_dict` | |
| 9 | the spice_lite function | permission checks, controller work, SQL (sections 2 to 4) | `_error(...)` sets `frappe.local.response.http_status_code` |
| 10 | `frappe/handler.py:62` | return value stored as `frappe.response["message"]` | |
| 11 | `frappe/app.py:451` `sync_database` | **commits** for POST, PUT, DELETE, PATCH (`UNSAFE_HTTP_METHODS`, `frappe/auth.py:31`); **rolls back** everything else, so writes done inside a GET method are discarded unless `frappe.local.flags.commit` is set | |
| 12 | `frappe/app.py:361` `handle_exception` | an uncaught exception's `http_status_code` becomes the status: `AuthenticationError` 401, `PermissionError` 403, `DoesNotExistError` 404, `ValidationError` 417, anything else 500 | |

spice_lite's own `_error()` (`sample-app/spice_lite/spice_lite/api/fhir.py:39`) returns an
`OperationOutcome` and sets the status, so its 400, 403, 404 and 422 bodies are FHIR-shaped. The
403 from steps 5 and 6 is Frappe's own error body, not an `OperationOutcome`.

## 2. Permission checks: what each call really does

| Call in spice_lite | Checks | Source |
|---|---|---|
| `frappe.has_permission("SL Patient", "read")` | DocType-level: does any of the user's roles have a DocPerm row with `read` (rows are in the DocType JSON `permissions` array, synced to the DB on migrate) | `frappe/permissions.py:77` |
| `frappe.has_permission(..., doc=doc)` | also user permissions (`has_user_permission`, line 333) and `has_permission` Frappe hooks (`has_controller_permissions`, line 455; a hook can only deny) | `frappe/permissions.py` |
| `frappe.get_list(...)` | read permission, user permissions and `permission_query_conditions` Frappe hooks as extra WHERE clauses | `frappe/__init__.py:2020`, `frappe/model/db_query.py:870` |
| `frappe.get_all(...)` | **nothing**: `get_list` with `ignore_permissions=True` | `frappe/__init__.py:2043` |
| `doc.insert()` | `check_permission("create")` before any controller method | `frappe/model/document.py:300` |
| `frappe.db.exists`, `frappe.db.get_value`, `frappe.db.sql`, `frappe.qb` | nothing | |

DocPerm changes in the JSON take effect only after `bench --site <site> migrate`; until then the
database still holds the old rows.

## 3. Controller and Frappe hooks on writes

`doc.insert()` order (`frappe/model/document.py:261`): `check_permission("create")` → `before_insert`
→ naming (`SLO-.#####` takes `SELECT ... FROM "tabSeries" ... FOR UPDATE` and an `UPDATE`) →
`before_validate` → `validate` (spice_lite: `SLObservation.validate`) → `before_save` → mandatory,
link and length checks → `db_insert` → `after_insert` → `on_update` → `on_change`.

Each controller event also runs every `doc_events` entry for that DocType **and for `"*"`** from
every installed app (`Document.run_method`, `document.py:1002`). spice_lite's `hooks.py` has no
`doc_events` (the block is commented out), but Frappe's own `frappe/hooks.py:166` registers seven
`"*"` `on_update` handlers. One of them,
`frappe.core.doctype.user_type.user_type.apply_permissions_for_non_standard_user_type`, calls
`frappe.db.table_exists("User Type")`. On Postgres `get_tables()` ignores its `cached` argument
(`frappe/database/postgres/database.py:225`), so **every insert or save runs an
`information_schema.tables` query**. That is statement 6 in the `create_observation` capture below.
A country app or integration app that adds `doc_events` for `SL Observation` adds its queries here.

## 4. SQL observed on PostgreSQL 16

Captured with `docs/tutorials/level-2/tools/capture_sql.py` (records every statement through
`Database._log_query`, as psycopg2 sent it) on `test.localhost`, calling each method in-process as
`clinician@spice-lite.test`, then rolled back. `<patient>` stands for an `SLP-` name. Frappe writes
backticks; `modify_query` in `frappe/database/postgres/database.py` rewrote them to double quotes.

"Warm" is the second call in the same process. The first ("cold") call also loads the user's
roles, User document, User Permissions and DocType meta: 9 to 12 extra statements (for example
`get_patient`: 11 cold, 2 warm).

### Indexes that really exist (Postgres) versus `search_index` in the JSON

`pg_indexes` on `test.localhost` (2026-09-30):

| Table | Indexes |
|---|---|
| `tabSL Patient` | `tabSL Patient_pkey` (name), `tabSL Patient_mrn_key` (unique mrn), `last_name` |
| `tabSL Observation` | `tabSL Observation_pkey`, `patient`, `code` |
| `tabSL Encounter` | `tabSL Encounter_pkey` only |

`SL Patient.country` and `SL Encounter.patient` have `search_index: 1` in their JSON, but **no index
was created**. On Postgres, Frappe v15 names an index after the bare field name
(`CREATE INDEX IF NOT EXISTS "{fieldname}"`, `frappe/database/postgres/schema.py:63` and `:115`), and
Postgres index names are unique per schema: `country` already belongs to `tabAddress Template` and
`patient` to `tabSL Observation`, so the statement silently did nothing. Cite an index only after
checking it (`select tablename, indexname from pg_indexes where tablename = 'tabSL Encounter'`), never from
the JSON alone. MariaDB names indexes per table and is not affected.

`EXPLAIN` with `enable_seqscan = off` showed `last_name ilike 'Zz%'` and `last_name like 'Zz%'` both as
`Seq Scan` (a plain b-tree serves a prefix `LIKE` only under the `C` collation or with `text_pattern_ops`, and never `ILIKE`), while
`last_name = 'Zz'` used `Index Scan using last_name`.

### get_patient (warm: 2 statements)
1. `SELECT "name" FROM "tabSL Patient" WHERE "name"='<patient>' LIMIT 1` (`frappe.db.exists`, fhir.py:52; primary key)
2. `SELECT * FROM "tabSL Patient" WHERE "name"='<patient>' LIMIT 1` (`frappe.get_doc`, fhir.py:55; every column, including PHI fields)

Both `has_permission` calls (fhir.py:50 and :56) ran no SQL once the caches were warm.

### search_patients?family=... (warm: 1 statement)
1. `select "name", "mrn", "first_name", "last_name", "gender", "birth_date", "active", "country" from "tabSL Patient" where "tabSL Patient"."last_name" ilike '<family>%%' order by last_name asc, name asc limit 50 offset 0`

Notes: the `like` filter became `ilike` on Postgres (`frappe/model/db_query.py`). The comment at
fhir.py:78 ("prefix match so the last_name index can be used") is not true on Postgres: the `last_name`
b-tree does not serve `ilike` (see the EXPLAIN above). `limit 50` is `MAX_SEARCH_RESULTS` (fhir.py:34). No permission WHERE clause
appears because spice_lite has no `permission_query_conditions` and the Clinician has no User Permissions.

### lastn (warm: 2 statements per subject)
Per subject, in the loop at fhir.py:155 (`TEACHING-DEFECT(perf-n+1)`):
1. `SELECT * FROM "tabSL Patient" WHERE "name"='<patient>' LIMIT 1` (`frappe.get_doc`, fhir.py:165)
2. `select * from "tabSL Observation" where "tabSL Observation"."patient" = '<patient>' and "tabSL Observation"."effective_datetime" > '1900-01-01 00:00:00.000000' and "tabSL Observation"."code" = '8480-6' order by effective_datetime desc, creation desc` (`frappe.get_all`, fhir.py:177; no LIMIT, every column)

Measured: 1 subject → 2 statements, 2 → 4, 5 → 10 (warm). The cold call adds 10. `MAX_LASTN_SUBJECTS = 100`
allows 200 statements in one request. The `get_all` also skips permission query conditions on SL Observation.

### create_observation (POST, warm: 6 statements)
1. `savepoint sl_create_observation` (fhir.py:124)
2. `SELECT "current" FROM "tabSeries" WHERE "name"='SLO-' FOR UPDATE` (naming series, row lock)
3. `UPDATE "tabSeries" SET "current" = "current" + 1 WHERE "name"='SLO-'`
4. `SELECT "name" FROM "tabSL Patient" WHERE "name"='<patient>' LIMIT 1` (`SLObservation.validate_patient`, `frappe.db.exists`)
5. `INSERT INTO "tabSL Observation" ("name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "patient", "encounter", "code", "code_display", "status", "effective_datetime", "value", "unit", "replaces") VALUES (...)`
6. `select table_name from information_schema.tables where table_catalog='<db_name>' and table_type = 'BASE TABLE' and table_schema='public'` (Frappe's `"*"` `on_update` `doc_events`, section 3)

The cold call (18 statements) also loaded the user's roles, User Permissions and defaults and ran
`SELECT "issingle" FROM "tabDocType" ...` for `SL Observation` and `Version`; warm, those came from caches. The commit happens after
the method returns (`sync_database`, POST).

## 5. Reproduce a capture

Hold the lock on a shared bench. As the bench user:

```bash
cd /home/user/frappe-bench/sites
../env/bin/python /path/to/AI-SDLC-frappe/docs/tutorials/level-2/tools/capture_sql.py test.localhost lastn --subjects 5
```

Frappe's built-in alternative is `frappe.print_sql(True)` (`frappe/__init__.py:471`): while the
site has `allow_tests`, every query is printed (`frappe/database/database.py:333`). It sets a flag in
the site's Redis cache, so it affects every process on that site until you call `frappe.print_sql(False)`.

## 6. Where things live in spice_lite

| Concern | File |
|---|---|
| Endpoints, `_error`, limits | `sample-app/spice_lite/spice_lite/api/fhir.py` |
| JSON shapes, parsing of `Patient/<id>` and `system|value` tokens | `sample-app/spice_lite/spice_lite/api/mappers.py` (no `import frappe`) |
| Controllers | `sample-app/spice_lite/spice_lite/clinical/doctype/<name>/<name>.py` |
| Schema, indexes, DocPerm rows | `sample-app/spice_lite/spice_lite/clinical/doctype/<name>/<name>.json` |
| Frappe hooks | `sample-app/spice_lite/spice_lite/hooks.py` |
| Audit (names and counts only) | `sample-app/spice_lite/spice_lite/audit.py` `log_access` |
| Tests | `sample-app/spice_lite/spice_lite/tests/test_fhir_api.py`, `clinical/doctype/*/test_*.py`, `tests/unit/test_mappers.py` |
| Known defects | `sample-app/docs/KNOWN_DEFECTS.md` (T-1 in `lastn`; D-1..D-12 with their status) |
