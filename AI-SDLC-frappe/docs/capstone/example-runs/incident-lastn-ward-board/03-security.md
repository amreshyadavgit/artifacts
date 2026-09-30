---
run_id: 2026-09-22-inc-lastn-ward-board
step: 03
agent: security
status: complete
inputs: [01-incident-brief.md]
next: human
---
## Summary
Verdict: BLOCK for onboarding further integration clients onto `lastn` until the fix ships; no privacy-incident escalation for this incident. Exposure triage (skill `security-review`, read-only) of the evidence up to 08:16 UTC, in parallel with 02-sre. No PHI was logged or returned to the wrong party in the evidence: `lastn` subject lists and search terms are elided by the exporter, the Error Log export carries only `JobTimeoutException` lines for the telephony job, and there is no 401 or 403 in the sampled nginx log. The login failures are 502 and 504 from saturated workers (`nginx-access.log:11`), not authentication errors. Two access concerns follow from the new client: it shares one token across 20 tablets, and `lastn` reads observations without row-level permission checks.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SEC-001 | high | security | sample-app/spice_lite/spice_lite/api/fhir.py:177-182 | `rows = frappe.get_all("SL Observation", filters=filters, ..., fields=["*"])`: `get_all` is `get_list` with `ignore_permissions=True`, so User Permissions and `permission_query_conditions` on `SL Observation` do not apply; CHG-5103 now sends about 4,000 subject reads a minute through it (`changes.md:7`) | authz-permissions: the set-based `lastn-set-based.patch` reads through `frappe.get_list` and closes this (same finding as SEC-001 in `skills/security-review/tests/expected/sample-app-report.json`). Ticket with the bug-fix, not an incident action. |
| SEC-002 | medium | security | changes.md:7 | "authenticated with one integration user's API token" for 20 vendor tablets: the token cannot be revoked for one tablet, and the audit log (`spice_lite.audit.log_access`) records one user for every ward read | whitelisting-authn: one API user per integration client with its own role and User Permissions for its clinic; rotate the shared key after the fix. Ticket. |
| SEC-003 | info | security | nginx-access.log:8 | the exporter shows `search_patients?family=[elided]`; the raw access log on `ke-web-1` holds the real search term (D-12 in `sample-app/docs/KNOWN_DEFECTS.md`) | phi-exposure: treat the unredacted `ke.spice.example_access.log` as PHI; never paste it into this run. |

## Decisions
- whitelisting-authn: SEC-002
- authz-permissions: SEC-001
- injection: no findings (no request parameter reaches `frappe.db.sql` on the affected path)
- phi-exposure: SEC-003; no PHI in the pasted evidence (`build-timeline.mjs` guard exit 0 in 02); requests killed by `WORKER TIMEOUT` never reach `frappe.app.handle_exception`, so the D-11 path (request values in Error Log) was not triggered (`error-log.txt:8`)
- secrets: no findings in the evidence; the shared token itself is not in the pack
- enumeration-exhaustion: the 100-subject cap (`MAX_LASTN_SUBJECTS`) bounds subjects, not cost (see 02-sre SRE-001)

## Open questions
None.

## Artifacts
- none (read-only agent)
