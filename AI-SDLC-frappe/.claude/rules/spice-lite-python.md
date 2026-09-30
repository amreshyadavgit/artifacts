---
paths:
  - "sample-app/spice_lite/**/*.py"
---

# Python rules for spice_lite

- Frappe v15, Python 3.11, tabs for indentation (Frappe style), type hints on whitelisted method parameters.
- Request paths read with `frappe.get_list` (permission-aware). `frappe.get_all` and `ignore_permissions=True` need a comment explaining why permissions do not apply.
- SQL: `frappe.db.sql` with `%(name)s` parameters or `frappe.qb`; never f-strings or `%` formatting into SQL. `frappe.qb` and raw SQL skip permissions, so check `frappe.has_permission` first.
- Whitelisted methods: `@frappe.whitelist(methods=[...])`, never `allow_guest=True`; errors return an `OperationOutcome` via the helpers in `spice_lite/api/fhir.py`.
- Log access through `spice_lite.audit.log_access` with document names only. Never log field values or search terms.
- Keep `spice_lite/api/mappers.py` free of `import frappe` so its unit tests run without a site.
- No queries inside loops over documents (the one exception is the marked teaching defect).
