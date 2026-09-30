# Threat model: spice_lite (STRIDE summary)

| Asset | Threat | STRIDE | Current control | Gap / agent check |
|---|---|---|---|---|
| Patient records | Guest or unauthenticated read | Spoofing / Info disclosure | No `allow_guest` on `spice_lite.api.fhir.*` | security agent checks every new `@frappe.whitelist` |
| Patient records | Permission bypass through `frappe.get_all`, `frappe.qb`, raw SQL or `ignore_permissions` | Elevation of privilege | API uses `frappe.get_list` except the teaching defect | reviewer and security flag each bypass in request paths |
| Clinical documents | Clinician deletes data | Tampering | DocType permissions: no delete for `Clinician` | security agent reviews every change to a DocType `permissions` array |
| Search parameters | SQL injection via `frappe.db.sql` string building | Tampering | No raw SQL in the app today | reviewer flags f-strings or `%` formatting into SQL |
| Search parameters | Wildcard enumeration (`family="%"`) | Info disclosure | Rejected (D-5 fixed) | test-strategy keeps the regression test |
| Logs, Error Log, Version | PHI leakage | Info disclosure | `audit.py` logs names only | security agent greps for `frappe.log_error`, `frappe.logger`, `frappe.throw` with field values |
| `site_config.json` | Secret disclosure to agents or repo | Info disclosure | `permissions.deny` + block-secrets Claude Code hook | security agent scans diffs and manifests |
| Availability | N+1 in `lastn`, unbounded lists, long jobs on the default queue | Denial of service | `MAX_LASTN_SUBJECTS = 100` | sre / performance-review flag query counts and queue timeouts |
| Agent tooling | Prompt injection via Jira tickets, DocType field content, or MCP results | Tampering / Elevation | deny rules, `ask` on outbound actions, human gates | see `docs/governance/prompt-injection.md` |
