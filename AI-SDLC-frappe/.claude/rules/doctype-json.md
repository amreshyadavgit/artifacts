---
paths:
  - "sample-app/spice_lite/**/doctype/**/*.json"
  - "sample-app/spice_lite/spice_lite/patches.txt"
  - "sample-app/spice_lite/spice_lite/hooks.py"
---

# DocType, patch and Frappe hook rules

- A DocType JSON change that adds, renames or retypes a field, or changes data, ships with a patch module listed in `patches.txt` (`[pre_model_sync]` for work before schema sync, `[post_model_sync]` for data fixes after it).
- Fields used in list filters or search get `search_index: 1`. Identifiers such as MRN get `unique: 1`.
- Permissions live in the DocType JSON `permissions` array: `Clinician` may read/write/create, never delete; `System Manager` has full access. Changing that array is a security-reviewed change.
- Never name documents by PHI (`autoname` stays a series like `SLP-.#####`).
- A new `hooks.py` key (`doc_events`, `scheduler_events`, `permission_query_conditions`, `has_permission`, `override_whitelisted_methods`) is an architecture decision: record it in an ADR under `docs/adr/`.
