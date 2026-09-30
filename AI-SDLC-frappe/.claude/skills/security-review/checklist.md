# Security review checklist (spice_lite, Frappe v15)

Paths are relative to `AI-SDLC-frappe/`. `APP` = `sample-app/spice_lite/spice_lite`. Run the Grep patterns with the Grep tool and open every hit before you decide. Frappe source references are relative to `apps/frappe/` in the bench (`/home/user/frappe-bench`).

## 1. phi: PHI and PII exposure
PHI (from `context/domain/spice-lite-glossary.md`): `mrn`, `first_name`, `last_name`, `birth_date`, `gender`, search terms (`family`, `identifier`), observation `value`/`unit` linked to a patient. Document names (`SLP-00001`) are not PHI.

- Direct logging: Grep `frappe\.logger\(|logger\.(info|warning|error|debug)\(|frappe\.log_error\(|print\(` in `APP`. Any field value or search term in the call is `high`. `with_more_info=True` anywhere is `high` (it appends `frappe.form_dict` to every line).
- **Unhandled errors.** Frappe turns every uncaught exception with status >= 500 into an Error Log whose traceback lists local variables, plus a `logs/frappe.log` line with `Form Dict: {...}` (`frappe/utils/error.py` `log_error_snapshot`, `frappe/utils/__init__.py` `get_traceback(with_context=True)`). For each whitelisted method, list the exceptions its `try/except` does not catch and ask whether a caller can trigger one. Typical triggers: a string that is not a valid datetime or number reaching `doc.insert()` (Postgres raises `InvalidDatetimeFormat`, a `DataError`, not a `ValidationError`), a value longer than a `Data` column (140), a unique-constraint race.
- **Postgres server log.** A failed statement is logged with its values (`STATEMENT:  INSERT INTO "tabSL Observation" ... VALUES (...)`). Same trigger list as above.
- **URLs.** PHI in a GET query string ends up in gunicorn and nginx access logs (`"GET /api/method/...?family=... HTTP/1.1"`). Check every `@frappe.whitelist(methods=["GET"])` whose parameters are PHI.
- **Version.** `track_changes: 1` in a DocType JSON copies old and new values into `Version.data`. Grep `"track_changes": 1` under `APP/**/doctype/**/*.json`. Fine for audit inside the site; a finding if anything exports Version (MCP, report, fixture, integration).
- **Messages.** `frappe.throw(...)` and `_error(...)` diagnostics must not format field values or search terms. Grep `frappe\.throw\(|_error\(` and read each `.format(...)` argument. A document name is fine; `self.mrn` or `family` is not.
- Test data and docs: only synthetic values. Grep `MRN-[0-9]` and check each hit is `MRN-000xxx`.

## 2. logging-audit
- Every read and write path calls `spice_lite.audit.log_access(action, doctype, names, **counts)` (`APP/audit.py`). Grep `log_access\(` in `APP/api/fhir.py` and the controllers.
- `names` must be document names, never MRNs or other field values (Grep `log_access\(.*\.mrn`).
- Can an auditor answer "which patients did user X touch, and which requests were refused?" Check whether `_forbidden(...)` paths record anything.
- D-4 regression: `audit._logger()` must keep `logger.setLevel(logging.INFO)`; `frappe.logger()` defaults to ERROR.

## 3. authn
- Grep `allow_guest\s*=\s*True` in `APP`. On any clinical DocType read or write it is `critical`. `test_whitelisted_methods_are_not_guest_accessible` in `APP/tests/test_fhir_api.py` pins today's state.
- Token auth: integrations send `Authorization: token <api_key>:<api_secret>`. Keys are generated per user (`generate_keys`, System Manager only). Check that no code or doc in the diff stores a real key pair, and that each integration has its own user (shared users defeat attribution).
- `override_whitelisted_methods` in `hooks.py` can silently replace a method, including its permission checks. Any new entry needs review.

## 4. authz
- DocType `permissions` arrays: Grep `"permissions"` in `APP/**/doctype/**/*.json`. `Clinician` has read/write/create and **no delete**; any change to the array is at least `high` until reviewed. Check `permlevel` on new fields that hold PHI.
- Permission bypasses in request paths: Grep `frappe\.get_all\(|frappe\.qb\.|frappe\.db\.sql\(|ignore_permissions|frappe\.db\.get_value\(|frappe\.db\.exists\(` in `APP/api`. For each hit ask: does this call **decide what the caller sees or can change**? If yes and no `frappe.has_permission(..., doc=...)` covers the same rows, it is `high` (`CWE-863`). Known hit: `lastn()` reads `SL Observation` with `frappe.get_all` (inside `TEACHING-DEFECT(perf-n+1)`); it checks the patient but not the observation rows, so User Permissions on `SL Observation` and any `permission_query_conditions` Frappe hook on it are ignored. Confirm with `probes/test_security_probes.py` probes 1 and 2.
- `frappe.db.exists` and `frappe.db.get_value` for validation only (existence, a foreign key) are fine when the result is not returned to the caller.
- Frappe hooks: `permission_query_conditions` (list reads) and `has_permission` (document checks; can only deny) in any installed app's `hooks.py`. A country app that adds one assumes every read path uses `get_list`/`has_permission`; list the paths that would ignore it.
- Writes through Link fields: `doc.insert()` enforces User Permissions on Link values (probe 3 shows a 403). Code that inserts with `ignore_permissions=True` or `frappe.db.set_value` loses that.
- `ignore_permissions=True` outside install, patch or test code needs a written reason next to it.

## 5. input-validation
- Whitelisted parameters have type hints (Frappe enforces them with pydantic in requests). Untyped parameters (`subjects` in `lastn`) must be parsed defensively (`parse_subjects` raises `ValueError`, mapped to 400).
- Values passed to `doc.insert()` without validation that the database can reject: Datetime/Date strings, numbers, lengths. The database rejection is a 500, which triggers the PHI sinks in section 1.
- `Select` fields are validated by Frappe on insert (bad `status` gives a `ValidationError`, 422).

## 6. injection
- Grep `frappe\.db\.sql\(\s*f["']|frappe\.db\.sql\([^)]*%\s*\(|frappe\.db\.sql\([^)]*\.format\(|frappe\.db\.multisql` in `APP`. Any query text built from input is `critical` (`CWE-89`). Placeholders: `%s` with a tuple or `%(name)s` with a dict.
- `order_by`, `fields`, `group_by` passed to `get_list` from request parameters: Frappe sanitises some of this, but treat unvalidated input there as `high`.
- `frappe.qb` with `.where(t.col == value)` is parameterised; `frappe.qb.terms.CustomFunction` or raw `Criterion` strings from input are not.
- LIKE wildcards: Frappe doubles backslashes in LIKE values, so `%` and `_` cannot be escaped through filters. `search_patients` rejects them (D-5, `test_search_rejects_like_wildcards`).

## 7. api-security
- `methods=[...]` on every whitelisted method: reads `["GET"]`, writes `["POST"]`. A missing list means GET, POST, PUT and DELETE are all accepted, so a state-changing method becomes callable from a link.
- Unbounded input: list parameters without a cap (`MAX_LASTN_SUBJECTS = 100` exists; 100 subjects still cost 200 queries today, see performance-review), searches without `limit_page_length`.
- Enumeration: an endpoint that answers 404 for missing and 403 for forbidden documents reveals which names exist (`get_patient`). Names are an opaque series, so this is `low` unless names encode PHI.
- Tracebacks in responses: System Settings `allow_error_traceback` defaults to 1 (`frappe/core/doctype/system_settings/system_settings.json`), and `frappe/utils/response.py` `report_error` then returns the traceback in `exc`, also to guests. Recommend turning it off in production site setup.
- `/api/resource/<DocType>` is open to any user with DocType read permission: integrations must use the FHIR-lite methods so audit logging applies.

## 8. secrets
- `site_config.json` and `common_site_config.json` hold `db_password`, `encryption_key` and similar. They must never be committed, printed or read by an agent. Grep the diff for `db_password|encryption_key|api_secret|admin_password`.
- `frappe.conf.get(...)` in app code: fine for non-secret settings (`spice_lite_country_code`); a secret read from config must never be logged or returned.
- Scripts that print API keys (`APP/demo.py` `seed_demo` returns `api_key:api_secret`) must refuse to run on non-test sites (it checks `allow_tests`/`developer_mode`).
- Dev-only credentials in `sample-app/docker/docker-compose.yml` are labelled `DEV / TEACHING ONLY`. Report them `low` unless a change makes them reachable outside local development.

## 9. dependencies
- `sample-app/spice_lite/pyproject.toml`: `dependencies = []`; `[tool.bench.frappe-dependencies] frappe = ">=15.0.0,<16.0.0"`. Any new third-party package needs a pinned range and a reason.
- Frappe v15 on Postgres receives no more Postgres fixes (`bench new-site --db-type postgres` warning). Record it as `info`.
- There is no SCA step (`pip-audit`, Dependabot or Renovate). Report `low`. You cannot check CVE feeds offline: say so in `limitations` and never invent CVE ids.

## 10. infrastructure
- `sample-app/docker/`: dev stack (Postgres 16, three Redis containers, gunicorn, workers, scheduler, nginx). Check no secret is baked into the image (`Dockerfile`), and that the frontend port is the only published web port.
- `sample-app/k8s/README.md` is a pattern, not tested manifests: note it under `limitations` rather than reviewing values that do not exist.
- nginx or gunicorn access-log format: if you can see it, check whether `$request`/`%(r)s` (which include the query string) are logged for `/api/method/` paths.
