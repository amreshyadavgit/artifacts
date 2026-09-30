# PHI and secrets policy (agents and humans, Frappe edition)

Applies to code, logs, Error Log, Version history, prompts, eval datasets, commit messages, and anything an agent sends to an MCP server.

## PHI
- Never log PHI. `spice_lite.audit.log_access` logs document names and counts only. Do not use `frappe.logger(..., with_more_info=True)`: it appends `frappe.form_dict` (request parameters, including search terms) to every line.
- `frappe.throw` messages and `OperationOutcome.diagnostics` must not echo field values or search terms. They reach the client and the Error Log.
- Never paste real patient data into a prompt, a skill, an eval case, or a Jira/GitHub comment. Use synthetic data (`MRN-000123`, "Test Patient").
- Attachments with clinical content are `is_private = 1`.
- Agents must not read `**/*.phi.*` (enforced by `permissions.deny` in `.claude/settings.json`).

## Secrets
- `sites/<site>/site_config.json` and `sites/common_site_config.json` hold the database password, `encryption_key`, and other secrets. Agents never read them (`permissions.deny`). They are never committed.
- Integration users authenticate with an API key and secret (`Authorization: token <key>:<secret>`). Keys come from environment variables or a secret store, never from the repo.
- MCP server credentials use `${VAR}` expansion in `.mcp.json`.
- A `PreToolUse` Claude Code hook (`.claude/hooks/block-secrets.mjs`) blocks writes containing likely secrets: site_config secrets, Frappe API tokens, database URLs with passwords, private keys.

## Authentication and authorization
- Every whitelisted method in `spice_lite/api/fhir.py` requires login (no `allow_guest`), and GET/POST methods are restricted with `methods=[...]`.
- Roles: `Clinician` (read/write/create clinical DocTypes, no delete), `System Manager` (all).
- Reads use `frappe.get_list` / `frappe.has_permission`. `frappe.get_all`, `frappe.qb`, `frappe.db.sql` and `ignore_permissions=True` skip permission checks, so they must not decide what a user can see.

## Review severities
`critical` (exploitable now, PHI leaves the service, guest access to clinical data) · `high` (permission bypass on a read or write path, PHI in logs) · `medium` (defence-in-depth gap) · `low` (hardening) · `info`.
