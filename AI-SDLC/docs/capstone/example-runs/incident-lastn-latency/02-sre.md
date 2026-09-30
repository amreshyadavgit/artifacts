---
run_id: 2026-09-22-inc-lastn-latency
step: 02
agent: sre
status: needs-human
inputs: [01-incident-brief.md]
next: human
---
## Summary
Evidence up to 08:15 UTC points to one cause with high confidence: Clinic C-017's new ward dashboard sends `$lastn` for 512 subjects (user agent `c017-ward-dashboard/2.3.0`, `ingress-access.log:3-6`), and `ObservationService.lastN` runs two SQL statements per subject and loads each subject's full history (`sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69-74`, `TEACHING-DEFECT(perf-n+1)`). One request is therefore about 1,024 statements and, after CHG-4471 (average 408 observations per C-017 patient), about 209,000 hydrated rows. That saturates the 1-CPU, 768Mi pods, holds pool connections for 36 to 60 s, starves every other endpoint, and makes the 1 s probes fail, so Kubernetes restarts the pods into the same load. Skills used: `production-rca` (guard and timeline), `performance-review` (statement count from code). `build-timeline.mjs` over the 8 evidence files: exit 0, 86 events, no PHI-like content.

### Hypotheses, ranked by evidence
| # | hypothesis | for | against | verdict |
|---|---|---|---|---|
| H1 | N+1 in `$lastn` amplified by 512-subject requests over deep histories | dashboard requests start 08:00:42 and are the slowest lines (36.4 s, 50.2 s, then 504 at 60 s); AUDIT `results=512` (`app-logs.log:4-7`); code does 2 queries per subject | none so far | leading, high confidence |
| H2 | bad deploy | none | `rollout-history.txt`: last rollout revision 7 on 2026-09-18, ReplicaSet `fhir-lite-api-6d8f7c9b5` age 3d18h | rejected |
| H3 | database degradation | 20 DB connections busy from 08:01 (`metrics.md`) | baseline mean 0.40 ms for the per-patient observation query; the pool is exhausted by slow requests, not slow SQL (`app-logs.log:15` `active=10, idle=0, waiting=37`) | unlikely; confirm with a `pg_stat_statements` snapshot |
| H4 | memory leak / OOM | working set 749 to 757Mi of 768Mi | `pod-describe.txt` shows `Reason: Error`, `Exit Code: 137` after liveness kills, not `OOMKilled`; memory drops to 402Mi after restart (`metrics.md` 08:06) | contributing mechanism (GC stalls, `housekeeper delta=41s512ms` at `app-logs.log:8`), not the cause |
| H5 | probes misconfigured | readiness and liveness time out at 1 s (`k8s-events.txt:4-8`); no `timeoutSeconds` in `sample-app/k8s/deployment.yaml` | the probes passed for months before 08:00 | contributing: turns slowness into restarts and outage |

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SRE-1 | critical | performance | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69 | `for (Long subjectId : subjectIds) { patients.findById(subjectId)... observations.findByPatientIdOrderByEffectiveDateTimeDesc(...)` with 512 subjects per request from `c017-ward-dashboard/2.3.0` (`ingress-access.log:3-6`) | Mitigate now by stopping the 512-subject traffic (M1 below). Permanent fix: one set-based query plus a subject cap, via `/bug-fix` after mitigation. |
| SRE-2 | high | availability | sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43 | `public Bundle lastN(@RequestParam List<Long> subjects, ...)` accepts any number of ids | Cap `subjects` (100) and return 400 `OperationOutcome` above it; the performance-review example patch already does this. |
| SRE-3 | high | reliability | sample-app/k8s/deployment.yaml | readiness/liveness on the traffic port with the default `timeoutSeconds: 1`; `Liveness probe failed ... context deadline exceeded` then `Killing` (`k8s-events.txt:6-7`) | After the incident: probes on the management port, `timeoutSeconds: 3`, liveness `failureThreshold: 6`. Do not change probes during the incident. |

## Decisions
Mitigate now (G-M: a human chooses and executes; no agent runs these):
- **M1 (recommended)**: ask Clinic C-017 IT to disable the dashboard auto-refresh. Removes the trigger; expected recovery within one or two minutes of the last in-flight request.
- **M2**: ingress-level limit for `c017-ward-dashboard/2.3.0` on `/fhir/Observation/$lastn` (for example an nginx snippet returning 429). Needs `kubectl apply` of an ingress change, an `ask` rule in `.claude/settings.json`; a human applies it from their own terminal.
- **M3 (low confidence)**: scale `fhir-lite-api` from 2 to 4 replicas. Adds 20 pool connections, but every 512-subject request still costs about 1,024 statements, and DB connections double. Expect partial relief at best.
Fix: set-based `$lastn` with a 100-subject cap (hand over to `/bug-fix` in step 06). Prevent: a query-count test in CI, probe changes, application metrics (postmortem).

## Open questions
- G-M: which mitigation will you run (M1, M2 or M3)? Tell the orchestrator what you executed and when, in UTC.
- H3 would be settled by a `pg_stat_statements` snapshot now (calls and rows of the per-patient observation query since 08:00). Can the DBA on call capture one?

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
