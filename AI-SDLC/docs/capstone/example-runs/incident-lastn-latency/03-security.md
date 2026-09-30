---
run_id: 2026-09-22-inc-lastn-latency
step: 03
agent: security
status: complete
inputs: [01-incident-brief.md]
next: orchestrator
---
## Summary
Exposure triage (skill `security-review`, read-only) of the evidence pack up to 08:16 UTC, run in parallel with 02-sre. No PHI was logged or returned to the wrong party: every `Unhandled exception` line is a connection-pool timeout (`CannotCreateTransactionException`, `SQLTransientConnectionException ... request timed out after 30000ms`) that carries no request data. No 401 or 403 in the sampled ingress log; every request is authenticated. One access-pattern concern: an integration client uses the shared staff account.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SEC-1 | medium | authz | sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:63 | vendor client `c017-ward-dashboard/2.3.0` authenticates as the in-memory user `clinician` (`ingress-access.log:3`: `- clinician [...] "GET /fhir/Observation/$lastn?subjects=[512 ids elided]`) and reads the latest heart rate of 512 patients every 30 s | Issue one credential per integration client with its own role and rate limit; until then the dashboard cannot be throttled or revoked without locking out clinicians. Ticket, not an incident action. |
| SEC-2 | medium | logging-audit | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:76 | `audit.recordSearch("Observation", result.size());` records `results=512 user=clinician` (`app-logs.log:4`) but not which subjects were read | Record subject ids (opaque, not PHI per `context/domain/fhir-lite-glossary.md`); same recommendation as security-review SEC-002 in `skills/security-review/tests/expected/sample-app-report.json`. |
| SEC-3 | info | phi | sample-app/src/main/java/org/example/fhir/error/GlobalExceptionHandler.java:71 | `log.error("Unhandled exception", ex);` logged 5 pool timeouts between 08:03:40 and 08:15:58 (`app-logs.log:11-37`); none contains request values | Not triggered in this incident. The latent PHI-in-logs path (D-04 in `sample-app/docs/KNOWN_DEFECTS.md`) stays open; track it separately. |

## Decisions
- No privacy-incident escalation: `build-timeline.mjs` PHI guard exit 0, and the logged exceptions contain class names, pool counters and stack frames only.
- SEC-1 and SEC-2 are follow-up tickets; neither changes the mitigation choice.

## Open questions
None.

## Artifacts
- none (read-only review; handoff persisted by the orchestrator)
