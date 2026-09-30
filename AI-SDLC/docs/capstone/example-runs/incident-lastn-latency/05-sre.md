---
run_id: 2026-09-22-inc-lastn-latency
step: 05
agent: sre
status: complete
inputs: [02-sre.md, 04-sre.md]
next: orchestrator
---
## Summary
Verification of G-M round 2. Human outcome reported in the session: "08:31 UTC, C-017 IT disabled the dashboard auto-refresh at the incident commander's request (M1)." Read-only evidence 08:31 to 08:40 UTC: the symptom is **resolved** and H1 is **confirmed**. `$lastn` rate fell from 0.96 to 0.11 req/s by 08:33; `$lastn` p95 0.21 s, other p95 0.05 s and error ratio 0.002 at 08:34; 0.001 at 08:36 and 08:40 (`metrics.md`). At 08:40:30 all 4 pods are `1/1 Running` with restart counts unchanged since 08:24 (`pod-describe.txt`). A normal 7-subject `$lastn` from `ehr-portal/5.1.3` took 0.163 s at 08:36:44 (`ingress-access.log:20`).

The DBA's `pg_stat_statements` snapshot for 08:00 to 08:31 (requested in 02) settles H3: the per-patient observation query ran 431,616 times (843 requests x 512 subjects) and returned 176,099,328 rows, 408 per call, the CHG-4471 average; mean 1.62 ms per call. The database answered quickly; it was asked 1,024 times per request. H3 rejected.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SRE-5 | low | observability | sample-app/src/main/resources/application.yml | `management.endpoints.web.exposure.include: health,info`: no application metrics, so pool saturation and per-endpoint latency were only visible at the ingress | Add a Prometheus registry on the management port and alerts on `$lastn` p95 and pending pool connections (postmortem action). |

## Decisions
- Mitigation M1 holds. The dashboard stays disabled until the permanent fix is deployed. One AUDIT `results=512` at 08:33:20 (`app-logs.log:44`) shows at least one workstation still refreshed after 08:31; which one is not determinable from the shared `clinician` account (SEC-1) and goes to the postmortem as an open question.
- Scale back to 2 replicas is a planned human action after 30 minutes of stable metrics (not an agent action).
- A code fix is needed (SRE-1, SRE-2): the orchestrator writes the `/bug-fix` handover next.

## Open questions
None.

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
