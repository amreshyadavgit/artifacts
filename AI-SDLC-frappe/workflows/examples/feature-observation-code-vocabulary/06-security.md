---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 06
agent: security
status: complete
inputs: [04-developer.md]
next: orchestrator
---
## Summary
Security review (skill `security-review`) of the files listed in 04-developer.md, run because `security-scope.txt` says `SECURITY STEP: MANDATORY (rules 1, 3, 4, 5)`. Ran in parallel with 05-tester. No whitelisted method changed; `create_observation` still checks `frappe.has_permission("SL Observation", "create")` and inserts with permissions. One high finding on the new `permissions` array.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SEC-1 | high | security | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.json:67 | Clinician DocPerm row `"create": 1, "print": 1, "read": 1, "report": 1, "role": "Clinician", "write": 1` (copied from `sl_patient.json`) | Clinician must be read-only here (ADR-0002, AC-5). With write, any clinician can change the `unit` of 8480-6 or set `disabled` on a code, which changes validation of every Observation on the country site (a permission bypass on a write path under `context/security/phi-and-secrets-policy.md`). Keep `{"read": 1, "role": "Clinician"}`. |
| SEC-2 | info | security | sample-app/spice_lite/spice_lite/patches/v0_2/backfill_observation_codes.py:15 | `# get_all / ignore_permissions: a patch runs as Administrator during migrate, not in a request.` | Justified and commented as rule 4 of the coding standards requires; the patch is not reachable from a request. No change. |
| SEC-3 | info | security | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.py:42 | `frappe.throw(_("Unknown Observation code {0}").format(self.code), frappe.LinkValidationError)` | Messages name the code and unit only, never the value or the patient; they reach the client as `OperationOutcome.diagnostics` and are PHI-free. No change. |

Checked and clean: whitelisting (no `@frappe.whitelist` or `allow_guest` in the diff), permission-aware reads in request paths (`validate_code` reads the vocabulary with `frappe.db.get_value` inside a controller after the caller's create permission was checked; codes are not PHI), fixtures (no Role or DocPerm records shipped), secrets (none in the diff), `hooks.py` (only the `fixtures` key; no `doc_events` or permission hooks).

## Decisions
- SEC-1 is high: per `context/standards/review-standards.md` it blocks the merge until fixed.

## Open questions
None.

## Artifacts
- none (read-only review; handoff persisted by the orchestrator)
