## Summary
The change adds a whitelisted method `find_patients(name)` to `spice_lite/api/fhir.py` for a front-desk lookup. It is open to guests, builds SQL with an f-string, reads `tabSL Patient` with `frappe.db.sql` (no permission check), writes the search term into the Error Log, returns raw rows with MRN and birth date, and has no tests. The existing suite still passes with the patch applied (`Ran 46 tests`, `OK`), so CI does not catch any of it. Findings: 2 critical, 6 high, 2 medium, 1 low. Verdict: BLOCK.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-001 | critical | security | `sample-app/spice_lite/spice_lite/api/fhir.py:193-196` | `rows = frappe.db.sql(` ... `where last_name like '%{name}%'` (f-string); probe as Guest with `name="zz%' or last_name is not null or '%'='"` returned `3 of 3` patients | Never build SQL text from input. Use `frappe.get_list("SL Patient", filters=[["last_name", "like", f"{family}%"]], fields=PATIENT_FIELDS, limit_page_length=MAX_SEARCH_RESULTS)` as `search_patients` does, or `frappe.db.sql(query, {"name": ...})` with `%(name)s` (`frappe-coding-standards.md#4`, threat-model.md "SQL injection" row). |
| CR-002 | critical | security | `sample-app/spice_lite/spice_lite/api/fhir.py:190` | `@frappe.whitelist(allow_guest=True)`; probe: `fhir.find_patients in frappe.guest_methods` is `True` | Unauthenticated callers can read MRNs, names and birth dates. Use `@frappe.whitelist(methods=["GET"])` (`frappe-coding-standards.md#3`, phi-and-secrets-policy.md "Authentication and authorization"). |
| CR-003 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:193` | `rows = frappe.db.sql(` with no `frappe.has_permission("SL Patient", "read")` before it | `frappe.db.sql` skips DocType permissions and User Permissions, so even a logged-in `norole@spice-lite.test` would read every patient once CR-002 is fixed. Check `frappe.has_permission` and read through `frappe.get_list` (`frappe-coding-standards.md#2`). |
| CR-004 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:201` | `frappe.log_error(title="find_patients: no match", message=f"No patient matched '{name}'")`; probe: one Error Log row per unmatched lookup, and its `error` field contains the search term | The search term is a family name (PHI). Remove the call; audit with `log_access("search", "SL Patient", [...], result_count=0)` (`frappe-coding-standards.md#10`, phi-and-secrets-policy.md "PHI", glossary PHI table "Search terms"). |
| CR-005 | high | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:196` | probe with `name="O'Brien"`: `psycopg2.errors.SyntaxError syntax error at or near "Brien"` | A legitimate name gives a server error, and on Postgres the error aborts the transaction. Fixed by CR-001's parameterised query; add an apostrophe test (`frappe-coding-standards.md#4`). |
| CR-006 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:196` | `like '%{name}%'`; probe as Guest with `name="%"` returned `3 of 3` patients | Reintroduces D-5, which `search_patients` rejects at `fhir.py:69-72` (`if any(c in family for c in LIKE_METACHARS):`). Reject `%`, `_`, `\` and require a minimum length (glossary business rule 6, threat-model.md "Wildcard enumeration" row). |
| CR-007 | high | design | `sample-app/spice_lite/spice_lite/api/fhir.py:202` | `return rows` where `rows` has keys `['birth_date', 'first_name', 'last_name', 'mrn', 'name']` | Return `bundle([patient_to_fhir(r) for r in rows])` like `search_patients`; raw rows are not the FHIR-lite shape and leak every selected column (`api-standards.md` "Success returns", `frappe-coding-standards.md#1`). |
| CR-008 | high | testing | `sample-app/spice_lite/spice_lite/api/fhir.py:190` | `git diff --stat HEAD -- sample-app` lists only `api/fhir.py`; `test_whitelisted_methods_are_not_guest_accessible` checks `(fhir.get_patient, fhir.search_patients, fhir.create_observation, fhir.lastn)` only (`tests/test_fhir_api.py:106`) | Add `FrappeTestCase` tests: match, apostrophe, `%` gives 400, `norole@spice-lite.test` gives 403, not in `frappe.guest_methods`; make the guest test iterate over every whitelisted function in the module (`testing-standards.md` Integration, Negative and Permission rows). |
| CR-009 | medium | standards | `sample-app/spice_lite/spice_lite/api/fhir.py:200-202` | `if not rows:` ... `return rows` with no `log_access(` call | Record the search with `log_access("search", "SL Patient", [r.name for r in rows], result_count=len(rows))` (`frappe-coding-standards.md#10`). |
| CR-010 | medium | performance | `sample-app/spice_lite/spice_lite/api/fhir.py:196-197` | `where last_name like '%{name}%'` / `order by last_name"""` with no limit | The leading `%` cannot use the `last_name` `search_index`, and every match is returned; `search_patients` uses a prefix match and `MAX_SEARCH_RESULTS = 50` (`frappe-coding-standards.md#5`). |
| CR-011 | low | docs | `sample-app/spice_lite/spice_lite/api/fhir.py:5-9` | `Endpoints (all require login; none are allow_guest):` does not list `find_patients` | Prefer extending `search_patients` (FHIR `family` parameter) over a second lookup; if the method stays, update the docstring, `sample-app/README.md` and `context/architecture/overview.md` (`api-standards.md` Search parameters). |

## Details
### CR-001
Reproduced by applying the patch and running a probe module with `bench --site test.localhost run-tests --module ...` (Postgres). As `Guest`, `find_patients(name="zz%' or last_name is not null or '%'='")` turns the WHERE clause into `last_name like '%zz%' or last_name is not null or '%'='%'` and returns every row of `tabSL Patient` (3 of 3 in the probe). Any other SQL can be appended the same way.

### CR-002
`allow_guest=True` registers the function in `frappe.guest_methods`, so `GET /api/method/spice_lite.api.fhir.find_patients?name=...` works without a session or token. Combined with CR-001 this is an unauthenticated dump of patient demographics.

### CR-003
Fixing CR-002 alone is not enough: raw SQL ignores the `Clinician` role, User Permissions and any future `permission_query_conditions` Frappe hook. `lastn` shows the correct guard for the DocType level at `fhir.py:151`.

### CR-004
Error Log rows are kept, readable in desk by System Managers, and often forwarded to monitoring. Each unmatched lookup also creates one row, so a guest can grow the table at will (log flooding).

### CR-005
Frappe's Postgres layer passes the text through `modify_query`, and psycopg2 rejects it. After the error, every later query in the same request fails with `InFailedSqlTransaction` until rollback.

### CR-006
`search_patients` was fixed for exactly this in D-5 (`test_search_rejects_like_wildcards`). A second lookup path without the same guard undoes the fix.

### CR-007
The response is `{"message": [{"name": ..., "mrn": ..., "first_name": ..., "last_name": ..., "birth_date": ...}]}` instead of a `Bundle` of `Patient` resources, so clients get a second shape and every added column leaks automatically.

### CR-008
With the patch applied, `bench --site test.localhost run-tests --app spice_lite` reports `Ran 46 tests` and `OK`. Each finding above needs a test that fails before the fix.

### CR-009
The audit trail answers "who searched for which records". A lookup that skips `log_access` is invisible to it.

### CR-010
A front-desk lookup runs on every keystroke. With a leading wildcard Postgres scans `tabSL Patient` each time.

### CR-011
FHIR string search already covers this use (`family`); one search method means one permission and test matrix.

## Categories checked
- correctness: CR-005
- design: CR-007
- readability: no findings
- testing: CR-008
- security: CR-001, CR-002, CR-003, CR-004, CR-006
- performance: CR-010
- standards: CR-009
- docs: CR-011

## Verdict
BLOCK
