---
name: explain-endpoint
description: Explain one spice_lite whitelisted method end to end (route /api/method/..., @frappe.whitelist rules, argument coercion, permission checks, controller methods and doc_events, the SQL Frappe actually sends, status codes, audit logging, covering tests) with path:line citations. Read-only; needs no bench.
when_to_use: When someone asks how a spice_lite API method works, who may call it, what SQL or how many queries it runs, what it returns on error, or where to change it, e.g. spice_lite.api.fhir.lastn or /api/method/spice_lite.api.fhir.search_patients.
argument-hint: "<dotted.method or /api/method/dotted.method>, e.g. spice_lite.api.fhir.lastn"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(grep *)
  - Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/doctype_summary.py)
---

# Explain a spice_lite whitelisted method

Method to explain: **$ARGUMENTS**

Strip a leading `/api/method/` or `/api/v2/method/` and any query string. If nothing was given, or
the dotted path is not in the map below, list the methods in the map and stop. Do not guess.

Whitelisted methods in the app (decorator line, then the `def` line), captured when this skill was invoked:

!`grep -rn -A1 "@frappe.whitelist" sample-app/spice_lite/spice_lite --include=*.py`

DocTypes (naming, indexes, required fields, Links, DocPerm rows by role: r=read w=write c=create d=delete), read from the DocType JSON:

!`python3 ${CLAUDE_SKILL_DIR}/scripts/doctype_summary.py`

Frappe hook keys in the app's `hooks.py` that change request or document behaviour (no output means none are set; a line starting with `#` is commented out):

!`grep -nE "^#? ?(doc_events|permission_query_conditions|has_permission|override_whitelisted_methods|override_doctype_class)" sample-app/spice_lite/spice_lite/hooks.py`

## Procedure

Read [reference.md](reference.md) first. It holds the Frappe request pipeline with source
locations and the SQL observed for each method on PostgreSQL 16. Then trace the method, reading each
file in this session rather than assuming:

1. **Route and whitelist**: the decorator line: allowed `methods`, `allow_guest` (must be absent for
   clinical data), and what Frappe returns for a wrong verb or a guest (reference.md section 1, steps 5 and 6).
2. **Arguments**: the signature and type hints; which are coerced (step 7), which parsing the method
   does itself (`parse_reference`, `parse_token`, `parse_subjects` in `api/mappers.py`), and which
   inputs are rejected before any query runs.
3. **Permission checks**: each `frappe.has_permission`, `frappe.get_list`, `frappe.get_all`,
   `doc.insert()` call and what it does and does not check (reference.md section 2). Name every read
   that bypasses permissions.
4. **Controller and Frappe hooks**: for writes, the controller methods that run (`validate`,
   `on_update`, `on_trash`) and the `doc_events` that apply, including Frappe's own `"*"` handlers
   (reference.md section 3). For reads, say that no controller method runs.
5. **SQL**: the statements in order with the Frappe call that emits each (reference.md section 4),
   the index each can use (reference.md lists the indexes that really exist on Postgres; `search_index` in the JSON is not proof), and the count per request. Say whether
   the count grows with the input.
6. **Responses**: each HTTP status and the line that produces it (`_error(...)` in `api/fhir.py`, or
   Frappe's own 403/417). Remember `{"message": ...}` wrapping and commit versus rollback by verb.
7. **Audit and PHI**: the `log_access` call, and confirm that no PHI field or search term (see
   `context/domain/spice-lite-glossary.md`) reaches a log line, an `OperationOutcome` diagnostic or a
   `frappe.throw` message.
8. **Tests**: the test methods that call this method (`grep -n "fhir.<method>" -r sample-app/spice_lite/spice_lite/tests`), and which of success, 4xx and 403 are not covered.

## Output format

```markdown
## <dotted.method> (<HTTP methods>)
One paragraph: what it does and for whom.

### Request flow
| Step | Layer | Location (path:line) | What happens |
|---|---|---|---|

### SQL (PostgreSQL, warm caches)
Numbered statements with the emitting call and the index used; then "Statements per request: ...".

### Responses
| Status | When | Produced at (path:line) |
|---|---|---|

### Permissions, audit and PHI
### Test coverage
### Notes and risks
```

Rules:
- Every row cites a real `path:line` you read in this session. Frappe framework lines are cited as `frappe/<file>:<line>` from reference.md.
- The SQL comes from reference.md (observed), not from memory. If the method is not in reference.md, derive the statements from the calls and label them "not observed".
- Quote code only as short fragments.
- Mention a `TEACHING-DEFECT` or a `KNOWN_DEFECTS.md` entry on the path, but do not propose a fix unless asked.
- Do not edit files, do not run bench, the site or the tests, and never read `site_config.json`.
