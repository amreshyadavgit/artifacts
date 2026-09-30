---
name: security-review
description: Security review of the spice_lite Frappe app or a pending diff covering whitelisted methods (allow_guest, methods), DocType permissions, permission_query_conditions and has_permission Frappe hooks, ignore_permissions, get_all vs get_list, input validation, site_config and API-key secrets, PHI in logs, Error Log, Version and frappe.throw, SQL injection through frappe.db.sql, API security, dependencies and logging. Produces a JSON report valid against report.schema.json and a Markdown rendering. Replaces the bundled /security-review inside this project.
when_to_use: Before merging any change under sample-app/ (Python, DocType JSON, hooks.py, patches.txt, fixtures), when a workflow step needs a security gate, or when someone asks whether code can leak PHI or bypass Frappe permissions.
argument-hint: "[diff | path | git-range]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git log *) Bash(grep -rn *) Bash(node ${CLAUDE_SKILL_DIR}/scripts/render-report.mjs *)
---

# Security review (Frappe, PHI-first)

You are reviewing a Frappe v15 clinical app. One patient's name in `logs/frappe.log` or in an Error Log traceback is a reportable privacy incident, so PHI handling is checked first and never downgraded to "style".

Scope requested: `$ARGUMENTS`

Pending changes in the working tree (injected before you start):
!`git diff --stat`

Attack surface: every whitelisted method in the app (injected):
!`grep -rn -A1 "@frappe.whitelist" sample-app/spice_lite/spice_lite --include=*.py`

## 1. Decide the scope
- Empty or `diff`: review `git diff` (staged and unstaged) and every file it touches. For a DocType JSON change also read the controller, `hooks.py`, `patches.txt` and any fixture of that DocType: in Frappe, behaviour lives in all four.
- A path (for example `sample-app/`): review everything under it.
- A git range (for example `main...HEAD`): run `git diff <range>` and review the touched files.
Read `context/security/threat-model.md`, `context/security/phi-and-secrets-policy.md` and the PHI table in `context/domain/spice-lite-glossary.md` before the first finding.

## 2. Work through every category
Use [checklist.md](checklist.md). It lists, per category, what to open, the Grep patterns to run, and the Frappe behaviour that makes each pattern dangerous. Cover all ten categories, in this order:

1. `phi`: PHI in `frappe.logger`, Error Log tracebacks, `logs/frappe.log` Form Dict lines, Version diffs, `frappe.throw` and `OperationOutcome.diagnostics`, URLs, the Postgres server log
2. `logging-audit`: `spice_lite.audit.log_access` coverage and what an auditor can reconstruct
3. `authn`: `allow_guest`, token auth, API key handling
4. `authz`: DocType `permissions` arrays, `frappe.get_all`, `frappe.qb`, `frappe.db.sql`, `ignore_permissions`, `permission_query_conditions` and `has_permission` Frappe hooks, User Permissions
5. `input-validation`: typed whitelisted parameters, values that reach the database unvalidated
6. `injection`: `frappe.db.sql` with f-strings, `%` or `.format`, `order_by`/`fields` built from input
7. `api-security`: `methods=[...]`, unbounded lists, 403 vs 404 oracles, tracebacks in responses
8. `secrets`: `site_config.json`, `common_site_config.json`, API keys and secrets, `frappe.conf` use
9. `dependencies`: `pyproject.toml`, `[tool.bench.frappe-dependencies]`, Frappe version support
10. `infrastructure`: `sample-app/docker/`, `sample-app/k8s/`, Procfile-style process split

A category you checked and found clean goes into `checkedClean` with the evidence you looked at. Never leave a category silent.

## 3. Frappe facts that decide findings (do not guess these)
- `frappe.get_all` is `get_list` with `ignore_permissions=True`. It skips DocType permissions, User Permissions and `permission_query_conditions`. `frappe.qb`, `frappe.db.sql`, `frappe.db.get_value` and `frappe.db.exists` skip them too.
- `permission_query_conditions` applies to `frappe.get_list` only. A `has_permission` Frappe hook can only deny.
- An uncaught exception in a request with status >= 500 reaches `frappe.utils.error.log_error_snapshot`: the Error Log stores `frappe.get_traceback(with_context=True)`, which includes local variable values, and `frappe.logger(with_more_info=True)` appends `Form Dict: {...}` (the request parameters) to `logs/frappe.log`. Only keys containing `password`, `secret`, `token`, `key`, `pwd` are masked.
- On Postgres, a failed statement is written to the Postgres server log with its literal values (`STATEMENT: INSERT ... VALUES (...)`), because Frappe sends the query with values already interpolated.
- `track_changes: 1` makes every save write the old and new field values to `Version.data`.
- A wrong HTTP verb on `@frappe.whitelist(methods=[...])` gives 403, not 405. System Settings `allow_error_traceback` defaults to 1, so error responses carry a traceback in `exc`.

## 4. Severity (use exactly this scale)
| Severity | Use when | Frappe examples |
|---|---|---|
| `critical` | Exploitable now by the caller: guest access to clinical data, PHI returned to a user who may not read it, injectable SQL | `@frappe.whitelist(allow_guest=True)` on a patient read; `frappe.db.sql(f"... '{family}'")` |
| `high` | Permission bypass on a read or write path, PHI written to an internal sink (logs, Error Log, access log, DB server log), secret committed | `frappe.get_all` deciding what a Clinician sees; request values in an Error Log traceback |
| `medium` | Defence-in-depth gap or availability risk an attacker can drive | tracebacks in API responses; 100 subjects per call with 2 queries each |
| `low` | Hardening, or a risk that needs an unusual configuration | 403 vs 404 existence oracle on opaque names; demo keys printed to stdout |
| `info` | Observation, accepted risk, or something you could not verify | CVE status not checked offline |

Rate the realistic impact in a spice-style country deployment (User Permissions by facility, country apps adding `permission_query_conditions`), not the worst case in theory. If you are unsure between two levels, pick the higher one and say why in `evidence`.

## 5. Evidence rules
- `location` is `path:line` or `path:start-end` relative to `AI-SDLC-frappe/`, for example `sample-app/spice_lite/spice_lite/api/fhir.py:177-182`.
- `evidence` quotes the code, or the output of a command or probe. Do not paraphrase.
- A finding confirmed by running something names it in `verifiedBy` (for example `probes/test_security_probes.py::test_probe_1_lastn_bypasses_user_permission_on_observation`). You may not be allowed to run bench yourself; then set `confidence` to `medium` and name the probe in [probes/RUN.md](probes/RUN.md) that would confirm it.
- **Never copy PHI into the report.** Replace a patient value with `[REDACTED]` and name the field. Synthetic values such as `MRN-000123` are fine. Never quote an `api_key:api_secret` pair or anything from `site_config.json`.
- Add a CWE id when one clearly applies: `CWE-863` (incorrect authorization), `CWE-532` (sensitive data in logs), `CWE-598` (sensitive query strings), `CWE-209` (error message information), `CWE-89` (SQL injection), `CWE-770` (unbounded allocation), `CWE-204` (response discrepancy).

## 6. Output
Produce exactly one JSON object that validates against [report.schema.json](report.schema.json). A one-finding example is in [examples/example-report.json](examples/example-report.json).

- `summary` counts must equal the counts in `findings`.
- `verdict`: `block` if any `critical` or `high`; `needs-decision` if any `medium`; otherwise `pass`.
- `limitations` lists what you could not check (no network for CVE lookups, probes not run, no production nginx config).

If you can write files, save the JSON to the run folder given in the task (for example `.ai-sdlc/runs/<run-id>/security-report.json`) and render it:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/render-report.mjs .ai-sdlc/runs/<run-id>/security-report.json --out .ai-sdlc/runs/<run-id>/04-security.md
```

The renderer validates the schema, checks the summary counts and verdict, rejects evidence that contains a non-synthetic MRN or a Frappe API token, and exits `1` with `--fail-on high` when the report has a high or critical finding. If you cannot write files, return the JSON as your final answer inside a single fenced `json` block.

## 7. Do not
- Do not edit source, DocType JSON, `hooks.py` or `patches.txt`. You report; the developer agent fixes.
- Do not read `**/site_config.json`, `**/common_site_config.json`, `.env*` or `**/*.phi.*` (denied in `.claude/settings.json`; do not try another route such as `cat` or `bench --site * show-config`).
- Do not run `bench --site * console` or `bench --site * execute`: they run as Administrator and commit.
- Do not report `TEACHING-DEFECT(perf-n+1)` as a performance bug. Report its security angles (the `frappe.get_all` bypass, `CWE-863`; the per-call cost, `CWE-770`) and point to the performance-review skill.
- Do not mark a finding `critical` or `high` without quoted evidence.
