---
run_id: 2026-09-22-inc-lastn-ward-board
step: 04
agent: sre
status: needs-human
inputs: [02-sre.md, 03-security.md]
next: human
---
## Summary
Verification of G-M round 1. Human outcome reported in the session: "08:20 UTC, the telephony team rolled `spice_telephony` back from 1.8.0 to 1.7.3 on ke.spice.example (M3); KE-C-017 IT not reachable yet." Read-only evidence 08:20 to 08:27 UTC: the symptom is **not resolved**. `get_patient` from `ehr-bridge` still hits the 120 s timeout at 08:21:10 (`nginx-access.log:18`), gunicorn kills stuck workers at 08:21:10 (`web.error.log:26-27`), the 5xx ratio is 36.2% at 08:20 and 35.7% at 08:25 with 9 of 9 workers busy (`metrics.md`), and the `default` backlog keeps growing, 51 at 08:20 to 68 at 08:26 (`redis-queue.txt:14-17`). The `lastn` per-subject shape is still the only slow statement (`postgres-slow.log:16-17`, 2.4 s). H2 (bad deploy) is rejected; H1 stands.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SRE-005 | high | performance | sample-app/spice_lite/spice_lite/api/fhir.py:155 | rollback done at 08:20, yet `c017-ward-board/1.0.0` calls continue at about 40 per minute (`metrics.md` 08:20, 08:25) and the web tier stays saturated | M3 is ineffective. Run M1 (or M2) now. Keep `spice_telephony` at 1.7.3 until the incident is closed; re-deploying 1.8.0 is a planned change afterwards. |

## Decisions
- H2 rejected: the only deploy of the day was rolled back and nothing changed.
- This is G-M round 2 of 2 allowed by `workflows/incident-response.md`. If round 2 fails, the run stops with `needs-human` for escalation to the on-call lead for Kenya.

## Open questions
- G-M round 2: run M1 (KE-C-017 IT switches off the ward board auto-refresh) or M2 (nginx 429 for `c017-ward-board/1.0.0` on `lastn`), and report the time in UTC.

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
