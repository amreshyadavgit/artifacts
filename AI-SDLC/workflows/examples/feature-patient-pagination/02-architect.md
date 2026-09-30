---
run_id: 2026-09-30-feat-patient-pagination
step: 02
agent: architect
status: complete
inputs: [01-requirements.md]
next: orchestrator
---
## Summary
Paging fits the existing layering (`api` -> `service` -> `repository`) without a schema change. The existing index `ix_patient_family_name` (`db/migration/V1__init.sql`) supports `ORDER BY id` within a family filter well enough for offsets up to a few thousand. Recommended option: offset paging via Spring Data `Pageable`, with the total from a count query, and `Bundle.link` for `self`/`next`. ADR draft below (to be filed as `docs/adr/0002-offset-pagination-for-patient-search.md` after gate G1).

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| ARC-1 | medium | design | sample-app/src/main/java/org/example/fhir/api/Bundle.java:9 | `return new Bundle("Bundle", "searchset", resources.size(),` | `total` must become the number of matches, not the page size. Add an overload `searchset(List<?> page, long total, List<Link> links)`; keep the old one for Observation search. |
| ARC-2 | medium | performance | sample-app/src/main/java/org/example/fhir/repository/PatientRepository.java:15 | `List<Patient> findByFamilyNameIgnoreCaseOrderByIdAsc(String familyName);` | Add a `Pageable` variant returning `Page<Patient>`. Deep offsets degrade linearly; cap `_offset` (ADR decision 3). |
| ARC-3 | low | design | sample-app/src/main/java/org/example/fhir/api/PatientController.java:37 | `public Bundle search(@RequestParam(required = false) String family,` | Validate `_count`/`_offset` in the service (business rule), not with ad-hoc checks in the controller, so the 400 comes from `FhirApiException.badRequest`. |

## Decisions
ADR-0002 (proposed): Offset pagination for Patient search
- Options: (A) offset `_offset` + `_count`; (B) keyset cursor on `id`; (C) return everything and let the client page.
- Decision: A. It matches FHIR client expectations (`Bundle.link[next]`), is a small change, and our data volume is modest. B is recorded as the follow-up if p95 on deep pages exceeds 300 ms.
- Decision 3: `_offset` is capped at 10000 so a client cannot force arbitrarily deep scans.
- Consequence: clients that relied on unbounded search results now receive 20 by default.

## Open questions
None.

## Artifacts
- ADR-0002 draft inline above (filed after gate G1)
