---
run_id: 2026-09-22-inc-lastn-ward-board
step: 05
agent: sre
status: complete
inputs: [02-sre.md, 04-sre.md]
next: orchestrator
---
## Summary
Verification of G-M round 2. Human outcome reported in the session: "08:31 UTC, KE-C-017 IT switched off the ward board auto-refresh at the incident commander's request (M1)." Read-only evidence 08:31 to 09:00 UTC: the symptom is **resolved** and H1 is **confirmed**. The last in-flight tablet call completed at 08:31:40 in 58.9 s (`nginx-access.log:20`) and Postgres logged no statement over 500 ms afterwards (`postgres-slow.log:21`). Desk `get_patient` took 0.9 s at 08:33:05 and a 7-subject `lastn` from `ehr-bridge` 0.091 s at 08:34:20 (`nginx-access.log:21-22`). At 08:34 `lastn` p95 is 0.10 s, other p95 0.07 s, 5xx 0.0%, 2 of 9 workers busy (`metrics.md`). The `default` queue drained without any action on Redis or the workers: 81 at 08:32, 0 at 08:48 (`redis-queue.txt:20-25`); the 08:30 reminder run completed at 08:31:52 (`worker.log:23`).

The DBA's `pg_stat_statements` snapshots (requested in 02) settle H3: the `lastn` per-subject shape ran 118,400 times from 08:00 to 08:31 against 1,212 in the previous hour, returning 50,080,000 rows, 423 per call, which is the CHG-5102 average; `frappe.get_doc`'s `select * from "tabSL Patient" where "name" = $1` ran 118,410 times (`metrics.md`). 118,400 calls in 31 minutes is about 3,800 a minute against the 4,000 the tablets asked for (40 calls x 100 subjects); timed-out calls stopped early. From 08:31 to 09:00 the same shape ran 1,190 times at 2.1 ms. The database answered each statement; it was asked 100 times per call. H3 rejected. The kernel log for 07:30 to 08:45 has no `Out of memory` or `oom-kill` line and memory peaked at 58% (`metrics.md`): H4 rejected.

## Findings
No findings.

## Decisions
- Mitigation M1 holds. The ward board stays off until the set-based `lastn` is deployed on the Kenya site and a per-client limit exists (02-sre SRE-001, SRE-002).
- A code fix is needed: the orchestrator writes the `/bug-fix` handover next.

## Open questions
None.

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
