---
run_id: 2026-09-22-inc-lastn-latency
step: 04
agent: sre
status: needs-human
inputs: [02-sre.md, 03-security.md]
next: human
---
## Summary
Verification of G-M round 1. Human outcome reported in the session: "08:17 UTC, scaled fhir-lite-api to 4 replicas (M3) from my terminal; C-017 IT not reachable yet." Read-only evidence 08:17 to 08:26 UTC: the symptom is **not resolved**. The scale-up happened (`k8s-events.txt:16`, `Scaled up replica set fhir-lite-api-6d8f7c9b5 to 4 from 2`), ready pods reached 4 at 08:19, then the new pods were killed by liveness failures at 08:21:36 and 08:21:58 and the original pods again at 08:22:41 and 08:24:05 (`k8s-events.txt:22-25`). `$lastn` p95 stayed at 60 s, error ratio 0.463 at 08:22, DB connections rose from 20 to 40 (`metrics.md`). H1 is strengthened: doubling capacity did not change the cost per request.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SRE-4 | high | availability | sample-app/k8s/deployment.yaml | new pods `t5r8w` and `w3n6j` failed readiness 3 minutes after start (`k8s-events.txt:21`), restarts 4 to 8 by 08:25 (`metrics.md`) | M3 is ineffective. Run M1 now; keep 4 replicas until recovery is confirmed, then scale back in a planned change. |

## Decisions
- Hypothesis H1 (N+1 amplified by 512-subject requests) kept, confidence raised: the 512-subject requests from `c017-ward-dashboard/2.3.0` continue (`ingress-access.log:15`, 504 after 60 s on new pod `10.42.3.9`).
- This is G-M round 2 of 2 allowed by `workflows/incident-response.md`. If round 2 fails, the run stops with `needs-human` for escalation to the on-call lead.

## Open questions
- G-M round 2: run M1 (C-017 IT disables the dashboard auto-refresh) or M2 (ingress limit for `c017-ward-dashboard/2.3.0`), and report the time in UTC.

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
