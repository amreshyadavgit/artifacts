---
run_id: 2026-09-30-feat-patient-pagination
step: 06
agent: security
status: complete
inputs: [04-developer.md]
next: orchestrator
---
## Summary
Security review (skill `security-review`) of the files listed in 04-developer.md. Ran in parallel with 05-tester. AuthN/AuthZ unchanged and correct; one medium defence-in-depth gap.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SEC-1 | medium | security | sample-app/src/main/java/org/example/fhir/service/PatientService.java:38 | `if (count < 1 \|\| count > 100)` validates `_count` but `offset` is only checked for `< 0` | Enforce ADR-0002 decision 3: reject `_offset > 10000` with `FhirApiException.badRequest("_offset must be between 0 and 10000")`. Unbounded offsets let an authenticated client force deep scans (threat model row "Availability"). |
| SEC-2 | info | security | sample-app/src/main/java/org/example/fhir/audit/AuditLogger.java:26 | `AUDIT.info("action={} resource={} results={} user={}", Action.SEARCH, ...` | No PHI added to audit output; counts only. No change needed. |

Checked and clean: authentication (`/fhir/**` still `hasAnyRole(CLINICIAN, ADMIN)` in `SecurityConfig`), injection (derived query + bound `Pageable`, no string-built JPQL), error bodies (diagnostics name parameters only), secrets (none in diff).

## Decisions
- SEC-1 is medium: per `context/standards/review-standards.md` it needs an explicit fix-or-ticket decision at gate G2.

## Open questions
None.

## Artifacts
- none (read-only review; handoff persisted by the orchestrator)
