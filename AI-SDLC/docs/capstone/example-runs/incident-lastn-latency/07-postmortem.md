---
run_id: 2026-09-22-inc-lastn-latency
step: 07
agent: sre
status: needs-human
inputs: [01-incident-brief.md, 02-sre.md, 03-security.md, 04-sre.md, 05-sre.md, 06-bug-fix-handover.md]
next: human
---
## Summary
Postmortem draft for INC-2026-0922-01 (SEV2, blameless), written with the `production-rca` skill and its `rca-template.md` sections condensed into the handoff format. The full-length RCA for this evidence pack is the skill's golden reference, `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`; this draft agrees with it on trigger, root cause, impact numbers and action items.

What happened: from 08:01 to 08:34 UTC every client of fhir-lite-api saw slow responses and 500/503/504 errors, with two short full outages (no ready pods about 08:05 to 08:07 and about 08:11). 9,847 of 29,412 requests between 08:04 and 08:36 failed (33.5%, `metrics.md`). Clinicians could not open charts or record observations for about 30 minutes; clinical-safety review is required. No PHI exposure (03-security.md). No partial writes: failed `POST /fhir/Observation` calls failed before a transaction opened (`app-logs.log:11-12`).

### Timeline (UTC)
| time | kind | event | evidence |
|---|---|---|---|
| 06:30 to 07:41 | trigger (precondition) | CHG-4471 imports 208,896 observations for 512 C-017 patients | `changes.md` |
| 08:00 | trigger | CHG-4472: C-017 dashboard live on 24 workstations, one 512-subject `$lastn` every 30 s each | `changes.md` |
| 08:00:42 | symptom | first 512-subject request takes 36.4 s | `ingress-access.log:3` |
| 08:03:40 | symptom | pool exhausted (`active=10, idle=0, waiting=37`); other endpoints fail | `app-logs.log:15`, `ingress-access.log:8` |
| 08:04:10 to 08:06:21 | symptom | readiness then liveness timeouts; both pods killed | `k8s-events.txt:4-10` |
| 08:09 | detection | `FhirLiteApi5xxRatioHigh` fires | brief |
| 08:12 | action | `/incident` run starts (01-incident-brief.md) | this run |
| 08:17 | action | G-M round 1: human scales to 4 replicas (M3); ineffective | `k8s-events.txt:16`, 04-sre.md |
| 08:31 | action | G-M round 2: C-017 IT disables dashboard auto-refresh (M1) | 05-sre.md |
| 08:34 | recovery | `$lastn` p95 0.21 s, error ratio 0.002 | `metrics.md` |

### Root cause
- **Trigger**: CHG-4472 (dashboard go-live) on top of CHG-4471 (deep histories).
- **Root cause**: `ObservationService.lastN` issues two statements per subject and hydrates every subject's full history (`sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69-74`), and `ObservationController.lastN` accepts an unbounded `subjects` list (`sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43`). Confirmed by `pg_stat_statements`: 431,616 calls = 843 requests x 512 subjects, 408 rows per call (05-sre.md).
- **Contributing factors**: probes on the traffic port with the 1 s default timeout; HikariCP 30 s connection timeout and no statement timeout; no application metrics; onboarding load test with 20 patients x 2 observations; the vendor client shares the `clinician` account.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| PM-1 | critical | performance | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69 | SRE-1; 431,616 per-patient queries in 31 minutes | PA-1: set-based `$lastn` via `/bug-fix FHIR-311` (06-bug-fix-handover.md) with a query-count test in CI. Prevents. Owner: developer. |
| PM-2 | high | availability | sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43 | SRE-2 | PA-2: 100-subject cap, documented in `context/standards/api-standards.md`. Prevents. Owner: architect. |
| PM-3 | high | reliability | sample-app/k8s/deployment.yaml | SRE-3, SRE-4 | PA-3: probes on the management port, `timeoutSeconds: 3`, liveness `failureThreshold: 6`. Mitigates. Owner: sre (human applies). |
| PM-4 | medium | observability | sample-app/src/main/resources/application.yml | SRE-5 | PA-4: Prometheus registry on the management port; alert on `$lastn` p95 above 2 s and pending pool connections above 0 for 2 minutes. Detects. Owner: sre. |
| PM-5 | medium | process | changes.md (CHG-4472 notes) | load test used 20 patients x 2 observations | PA-5: onboarding gate: load test with production-shaped synthetic history before client go-live. Prevents. Owner: tester. |
| PM-6 | medium | authz | sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:63 | SEC-1 | PA-6: one credential and one ingress rate limit per integration client. Mitigates. Owner: security. |
| PM-7 | medium | logging-audit | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:76 | SEC-2 | PA-8: audit subject ids for searches and `$lastn`. Detects. Owner: security. |

## Decisions
- Action item ids PA-1..PA-8 match `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md` section 9 (PA-7, HikariCP `connection-timeout` 5 s and a 10 s statement timeout, is carried over unchanged; owner developer).
- Status stays `needs-human`: an RCA is a draft until the incident commander and the clinical safety officer sign it off.

## Open questions
- Did `ehr-portal` resubmit observations whose `POST` failed between 08:03 and 08:34? Needs the client's retry log or a per-clinic observation count reconciliation.
- Which C-017 workstation still refreshed at 08:33:20? Not answerable while the dashboard shares the `clinician` account (PA-6).
- Clinical safety officer: were any care decisions delayed by the 30-minute chart outage?

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
