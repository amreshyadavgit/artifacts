# Code review checklist (spice_lite, Frappe v15)

Each check names the rule it enforces. Cite that rule in the finding's recommendation (for example `frappe-coding-standards.md#4`). Categories are the eight from `context/standards/review-standards.md`.

## correctness
- [ ] Legal domain input still works: last names with apostrophes or hyphens (`O'Brien`, `Meitner-Frisch`), identifier tokens `system|value`, empty optional parameters. With raw SQL on Postgres a syntax error also aborts the whole transaction (`InFailedSqlTransaction` until rollback).
- [ ] Error paths return an `OperationOutcome` through `_error(...)` with the status in `frappe.local.response.http_status_code`; a `ValidationError` inside `insert()` is rolled back to a savepoint as `create_observation` does. An uncaught exception becomes a 500 or Frappe's 417. (`frappe-coding-standards.md#9`, `api-standards.md` error list)
- [ ] Controller invariants still hold: `SLObservation.validate_immutable` (final is immutable), `validate_value_for_final`, `SLPatient.validate_unique_mrn`, `search_patients` rejecting `%`, `_`, `\` (D-5).
- [ ] Float/Int/Check columns are `NOT NULL DEFAULT 0` (D-1): code that tests `value is None` after a reload never sees `None`.
- [ ] Postgres versus MariaDB: `ORDER BY x DESC` puts NULLs first on Postgres; `("is", "set")` on a Datetime fails on Postgres (D-2).

## design
- [ ] Logic sits in the right place: field rules in the controller, cross-DocType or country behaviour in `doc_events` of the owning app, HTTP code only in `spice_lite/api/`. (`frappe-coding-standards.md#1`)
- [ ] Whitelisted methods return FHIR-lite resources built by `api/mappers.py` (`patient_to_fhir`, `observation_to_fhir`, `bundle`), never raw rows or `doc.as_dict()`. (`api-standards.md` "Success returns", `frappe-coding-standards.md#1`)
- [ ] `api/mappers.py` stays free of `import frappe`. (`.claude/rules/spice-lite-python.md`)
- [ ] Country-specific fields arrive as Custom Fields / Property Setters in a country or integration app, not in `spice_lite` DocType JSON. (`frappe-coding-standards.md#12`)
- [ ] A new `hooks.py` key (`doc_events`, `scheduler_events`, `permission_query_conditions`, `has_permission`, `override_whitelisted_methods`, `override_doctype_class`) comes with an ADR. (`.claude/rules/doctype-json.md`)

## readability
- [ ] Names state intent, tabs for indentation, no dead or commented-out code, docstrings on new whitelisted methods match behaviour. (`frappe-coding-standards.md#11`)

## testing
- [ ] Every new or changed whitelisted method has `FrappeTestCase` tests through `tests/utils.py::call`: happy path, each 4xx, 403 for `norole@spice-lite.test`, and membership checks against `frappe.whitelisted` / `frappe.guest_methods`. (`testing-standards.md` Integration, Negative, Permission rows)
- [ ] `test_whitelisted_methods_are_not_guest_accessible` lists four functions by name; a new method is not covered unless the test is extended.
- [ ] Collection methods have a query-count test (a query counter; `assertQueryCount` raises `TypeError` on Postgres in v15.121.2). (`testing-standards.md` Performance smoke row)
- [ ] Every patch in `patches.txt` has a test that runs `execute()` twice against seeded rows. (`testing-standards.md` Patch row)
- [ ] A bug fix starts with a failing test named after the defect id. (`testing-standards.md` Regression row)
- [ ] Test data is synthetic and created by the helpers in `tests/utils.py`; `tearDown` resets `frappe.set_user("Administrator")`.

## security
- [ ] No `allow_guest=True` on anything that touches clinical DocTypes. (`frappe-coding-standards.md#3`, phi-and-secrets-policy.md "Authentication and authorization")
- [ ] `@frappe.whitelist(methods=["GET"])` for reads, `["POST"]` for writes. (`api-standards.md` Methods)
- [ ] No user input in SQL text: no f-strings, `%` formatting or concatenation into `frappe.db.sql`; values go in the `values` argument (`%(name)s` / `%s`) or through `frappe.qb`. (`frappe-coding-standards.md#4`, threat-model.md "SQL injection" row)
- [ ] Reads in request paths are permission-aware: `frappe.get_list`, or `frappe.has_permission` before `frappe.get_doc`. `frappe.get_all`, `frappe.db.sql`, `frappe.qb`, `frappe.db.get_value`, `frappe.db.count` and `ignore_permissions=True` bypass DocType permissions, User Permissions and `permission_query_conditions`; each use needs a comment saying why that is safe. (`frappe-coding-standards.md#2`)
- [ ] No PHI (MRN, names, birth date, gender, observation values, search terms) in `frappe.log_error`, `frappe.logger`, `print`, `frappe.throw` messages or `OperationOutcome.diagnostics`. No `with_more_info=True` on a logger: it appends `frappe.form_dict` to every line. (phi-and-secrets-policy.md "PHI", glossary PHI table, `frappe-coding-standards.md#10`)
- [ ] Searches cannot enumerate: at least one criterion, LIKE metacharacters rejected, results capped. (glossary business rule 6, threat-model.md "Wildcard enumeration" row)
- [ ] DocType `permissions` array changes (for example `delete` for `Clinician`) are flagged for the security agent. (`.claude/rules/doctype-json.md`, review-standards.md)
- [ ] No secrets: nothing read from or written to `site_config.json`; API keys come from the environment. (phi-and-secrets-policy.md "Secrets")

## performance
- [ ] No `frappe.get_doc`, `frappe.get_all` or `frappe.db.*` call inside a loop over documents. (`frappe-coding-standards.md#5`)
- [ ] Explicit `fields`, never `["*"]`, in hot paths; results bounded (`limit_page_length`, `MAX_SEARCH_RESULTS`). (`frappe-coding-standards.md#5`)
- [ ] Filters can use an index: `search_index: 1` on filtered fields; a leading-wildcard `LIKE '%x%'` cannot use the `last_name` index.
- [ ] Slow or external work goes through `frappe.enqueue(..., queue=..., timeout=..., job_id=..., deduplicate=True)`, never inside the request. (`frappe-coding-standards.md#7`)

## standards
- [ ] Access to clinical documents is recorded with `spice_lite.audit.log_access` (names and counts only). (`frappe-coding-standards.md#10`)
- [ ] DocType JSON changes that add a `reqd` field, rename, retype, or need data changes ship with a patch module listed in `patches.txt` under the right section; applied patches are never edited. (`frappe-coding-standards.md#6`, `.claude/rules/doctype-json.md`)
- [ ] Fields used in filters get `search_index: 1`; identifiers get `unique: 1`; `autoname` stays a series, never PHI. (`.claude/rules/doctype-json.md`, `frappe-coding-standards.md#11`)
- [ ] Fixtures (`hooks.py` `fixtures`) are overwritten on every migrate: a fixture for a record that admins edit in desk loses their edits. (`frappe-coding-standards.md#12`)

## docs
- [ ] The `api/fhir.py` module docstring endpoint list, `sample-app/README.md` API table and `context/architecture/overview.md` match new or changed whitelisted methods.
- [ ] A new defect found during review that is not fixed goes into `sample-app/docs/KNOWN_DEFECTS.md` through its owner, not silently.
