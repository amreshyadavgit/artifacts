---
run_id: 2026-09-30-feat-patient-pagination
step: 07
agent: developer
status: complete
inputs: [05-tester.md, 06-security.md]
next: reviewer
---
## Summary
Rework after gate G2 (human decision: fix TST-1 and SEC-1 now). `PatientController.search` now calls `Bundle.searchset(resources, page.total(), links)`; `PatientService.search` rejects `_offset > 10000`. Added `searchOffsetAbove10000Is400`. `mvn -q -B test`: `Tests run: 32, Failures: 0, Errors: 0, Skipped: 0`.

## Findings
No findings.

## Decisions
- Kept the one-argument `Bundle.searchset(List)` for `ObservationController`; Observation paging is PAT-143.

## Open questions
None.

## Artifacts
- sample-app/src/main/java/org/example/fhir/api/PatientController.java
- sample-app/src/main/java/org/example/fhir/service/PatientService.java
- sample-app/src/test/java/org/example/fhir/PatientApiTest.java (test `searchOffsetAbove10000Is400`)
