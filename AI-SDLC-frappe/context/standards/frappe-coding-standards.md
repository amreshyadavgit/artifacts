# Frappe coding standards (spice_lite, Frappe v15)

1. **Where logic goes**: field-level rules in the DocType controller (`validate`, `before_save`, `on_update`, `on_trash`); cross-DocType or country-specific behaviour through `doc_events` in the owning app's `hooks.py`; HTTP-facing code only in `spice_lite/api/`. Whitelisted methods stay thin and call controllers or services.
2. **Permissions**: request paths read with `frappe.get_list` or `frappe.get_doc` plus `frappe.has_permission`. `frappe.get_all`, `frappe.qb`, `frappe.db.sql`, `frappe.db.get_value` and `ignore_permissions=True` bypass permissions; each use needs a comment explaining why that is safe.
3. **Whitelisting**: `@frappe.whitelist(methods=["GET"])` or `["POST"]`; never `allow_guest=True` for clinical data; validate and type every parameter.
4. **SQL**: `frappe.db.sql(query, values)` with `%(name)s` / `%s` placeholders, or `frappe.qb`. No f-strings or string concatenation into SQL. Prefer `frappe.get_list` with `filters` over raw SQL.
5. **No queries in loops**: batch with `filters={"name": ("in", names)}`, `pluck=`, or one query per request. Use explicit `fields`, never `["*"]`, in hot paths.
6. **Schema and data changes**: DocType JSON edits come with a patch module in `patches.txt` when data must change; never edit an applied patch; patches are idempotent.
7. **Background work**: `frappe.enqueue(method, queue="short"|"default"|"long", timeout=..., job_id=..., deduplicate=True)` with an idempotent job; never do slow external calls inside a web request.
8. **Caching**: `frappe.cache` with explicit keys and invalidation on `on_update`; never cache PHI under guessable keys shared across users.
9. **Errors**: `frappe.throw(msg, exc=frappe.ValidationError)` in controllers; API returns `OperationOutcome` via `_error(...)`. Messages never contain field values.
10. **Logging**: `spice_lite.audit.log_access` for access events; `frappe.log_error(title, message)` never with PHI.
11. **Naming**: `autoname` series, never by PHI; DocTypes prefixed `SL `; Python modules snake_case; tabs for indentation.
12. **Customisation**: country-specific fields go in a country app (Custom Field / Property Setter fixtures), not in `spice_lite` DocType JSON.
