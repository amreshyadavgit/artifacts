---
run_id: 2026-09-30-feat-patient-pagination
step: 03
agent: orchestrator
status: needs-human
inputs: [01-requirements.md, 02-architect.md]
next: developer
---
## Summary
Six small steps, each verified by `cd sample-app && mvn -q -B test`. Produced with the `implementation-plan` skill from AC-1..AC-6 and ARC-1..ARC-3. Security scope: YES (touches `api/`), so the security step will run after the developer.

| step | file | change | verifies |
|---|---|---|---|
| P1 | sample-app/src/main/java/org/example/fhir/api/Bundle.java | add `record Link(String relation, String url)`, a `link` component, and `searchset(List<?> page, long total, List<Link> links)` | ARC-1 |
| P2 | sample-app/src/main/java/org/example/fhir/repository/PatientRepository.java | add `Page<Patient> findByFamilyNameIgnoreCaseOrderByIdAsc(String familyName, Pageable pageable)` | ARC-2 |
| P3 | sample-app/src/main/java/org/example/fhir/service/OffsetPageRequest.java (new) | `Pageable` whose `getOffset()` returns `_offset` (Spring `PageRequest` only supports page numbers) | AC-2 |
| P4 | sample-app/src/main/java/org/example/fhir/service/PatientService.java | `search(family, mrn, count, offset)` validates `1 <= count <= 100`, `0 <= offset <= 10000`, returns `SearchPage<Patient>(items, total)` | AC-4, ADR decision 3 |
| P5 | sample-app/src/main/java/org/example/fhir/api/PatientController.java | read `_count` (default 20) and `_offset` (default 0), build `self`/`next` links with `ServletUriComponentsBuilder.fromCurrentRequest()` | AC-1, AC-3 |
| P6 | sample-app/src/test/java/org/example/fhir/PatientApiTest.java | MockMvc tests for AC-1 and AC-4 (tester adds the rest) | AC-1, AC-4 |

Rollback: revert the commit; no migration involved.

## Findings
No findings.

## Decisions
- No Flyway migration: the existing index is sufficient (ARC-2).
- `SearchPage` is a service-layer record so controllers never see Spring `Page` (coding standard 2).

## Open questions
- G1: approve this plan before the developer starts. Approval = accepting the `Agent(developer)` permission prompt (ask rule from `workflows/gates.settings.json`).
- Confirm the behaviour change for clients that send no `_count` (release note owner).

## Artifacts
- .ai-sdlc/runs/2026-09-30-feat-patient-pagination/03-implementation-plan.md
