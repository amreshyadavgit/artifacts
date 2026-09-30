# ADR-0002: Paginate Patient search with _count and next links

- Status: proposed
- Date: 2026-09-30
- Deciders: tech lead (approver), architect agent (draft)
- Agent run: `.ai-sdlc/runs/2026-09-30-feat-patient-search-paging/`

## Context
`GET /fhir/Patient?family=` returns every matching patient in one response. A common family name returns thousands of rows, all PHI, in a single Bundle. The API standard already promises `_count` (default 20, max 100) and the threat model lists "unbounded search" as an availability threat with the control still "planned".

### Requirement
- Functional: `GET /fhir/Patient?family=Test&_count=50` returns at most 50 Patients in a `searchset` Bundle, `total` is the number of matches across all pages, and a `next` link fetches the following page.
- Non-functional: `_count` default 20, maximum 100 (`context/standards/api-standards.md:10`); at most 2 SQL statements per page request; runs on PostgreSQL 14+ and on H2 2.x in PostgreSQL mode; no PHI added to logs or links beyond the search parameters the client already sent.
- Acceptance criteria:
  1. No `_count`: at most 20 entries, `total` equals the full match count.
  2. `_count=100` honoured; `_count=101` served as 100 (the `self` link shows `_count=100`).
  3. `_count=0`, negative, or non-numeric: 400 `OperationOutcome` with code `invalid`.
  4. `link` contains `self`, and `next` only when more results exist; following `next` returns the next page with no overlap and no gap.
  5. Search without criteria still returns 400.
  6. Existing search tests keep passing unchanged.
- Assumptions and open questions:
  - Assumption: ordering stays `id` ascending (current behaviour), which makes pages stable under inserts at the end.
  - Open: `_count=0` as FHIR "count only" mode. Out of scope; returns 400 for now (acceptance criterion 3).

### Current architecture (evidence)
| Fact | Evidence |
|---|---|
| Controller maps the whole list into a Bundle | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:40` `return Bundle.searchset(service.search(family, mrn).stream().map(PatientMapper::toResource).toList());` |
| Service loads all matches by family name | `sample-app/src/main/java/org/example/fhir/service/PatientService.java:44` `result = patients.findByFamilyNameIgnoreCaseOrderByIdAsc(family.trim());` |
| Service rejects criterion-less searches | `sample-app/src/main/java/org/example/fhir/service/PatientService.java:35-37` `if (!hasFamily && !hasMrn) {` |
| Repository returns an unbounded List | `sample-app/src/main/java/org/example/fhir/repository/PatientRepository.java:14` `List<Patient> findByFamilyNameIgnoreCaseOrderByIdAsc(String familyName);` |
| `total` is the size of the list, not the match count | `sample-app/src/main/java/org/example/fhir/api/Bundle.java:11` `return new Bundle("Bundle", "searchset", resources.size(),` |
| Bundle has no `link` element | `sample-app/src/main/java/org/example/fhir/api/Bundle.java:6` `public record Bundle(String resourceType, String type, int total, List<Entry> entry) {` |
| Null fields are omitted from JSON | `sample-app/src/main/resources/application.yml:15` `default-property-inclusion: non_null` |
| Family index exists on the raw column | `sample-app/src/main/resources/db/migration/V1__init.sql:14` `CREATE INDEX ix_patient_family_name ON patient (family_name);` |
| Hibernate wraps both sides in `upper()` (observed with `spring.jpa.show-sql=true`) | `where upper(p1_0.family_name)=upper(?) order by p1_0.id` |
| Existing test asserts `total` | `sample-app/src/test/java/org/example/fhir/PatientApiTest.java:58` `.andExpect(jsonPath("$.total").value(2))` |
| Pagination is a known gap | `context/architecture/overview.md:34` `No pagination yet on searches (risk: unbounded results).` |

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| A. Hard cap only: `_count` limits the list, no paging | Smallest change (repository `Limit`, controller param) | Clients cannot reach result 101+; `total` becomes misleading unless a count query is added anyway | Clinicians silently miss patients beyond the cap |
| B. Page-number paging via Spring Data `Pageable`, `link.next` carries `_count` and `_page` (chosen) | Native to Spring Data (`Page<Patient>` gives content and total); `next` URL is opaque to clients so the paging key can change later | One extra `count` query per request; deep pages cost `OFFSET` scans | `total` count on `upper(family_name)` is a full scan on PostgreSQL |
| C. Keyset paging on `id` (`_cursor=<last id>`) | Constant cost per page at any depth; stable under concurrent inserts | Custom repository query; no cheap `total`; previous-page links need extra work | More code to review for a table that is small today |
| D. Return Spring's `Page` JSON | No mapping code | Breaks the FHIR-lite `Bundle` shape for every client | Violates `api-standards.md` Search rule |

## Decision
Option B.
- Contract: `_count` (optional, integer): default 20, values above 100 served as 100, values below 1 or non-numeric rejected with 400 `invalid` via `FhirApiException.badRequest`. `_page` (optional, integer, 0-based, default 0) is server-defined; clients must follow `link` URLs rather than build them.
- `Bundle` gains `List<Link> link` with `record Link(String relation, String url)`. Paged searches set `self` and, when `page.hasNext()`, `next`. `Bundle.searchset(List<?>)` keeps its signature for Observation searches; with `non_null` inclusion their JSON is unchanged.
- `PatientRepository` gains `Page<Patient> findByFamilyNameIgnoreCase(String familyName, Pageable pageable)`; the service builds `PageRequest.of(page, count, Sort.by("id"))` and keeps the criterion guard and `audit.recordSearch("Patient", <entries returned>)`.
- The MRN path (at most one row) returns a single page with `total` 0 or 1 and no `next`.
- Why B over C: it meets every acceptance criterion with framework code, keeps `total` (asserted by existing tests and used by clients), and the opaque `next` link lets us move to keyset paging (C) later without a client change. A is rejected because it hides patients.

## Consequences
- Positive: bounded responses and PHI exposure per request; the threat-model "page size cap" control becomes real; the same pattern applies to Observation search.
- Negative: two statements per request (page + count); deep pages get slower with `OFFSET`; `Bundle` changes shape for Patient search (additive field).
- Follow-up work:
  - FHIR-120: implement this ADR (`PatientController`, `PatientService`, `PatientRepository`, `Bundle`) with the tests listed under Verification.
  - FHIR-121: apply the same paging to `GET /fhir/Observation` (`ObservationController.search`).
  - FHIR-122: spike a case-insensitive index that works on both databases (H2 2.3.232 rejects `CREATE INDEX ... (lower(family_name))`; candidates: a generated lower-case column, or a PostgreSQL-only migration).
  - FHIR-123: update `context/architecture/overview.md` and `sample-app/README.md` once implemented.

### Risks
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| AR-001 | medium | performance | `sample-app/src/main/resources/db/migration/V1__init.sql:14` | `CREATE INDEX ix_patient_family_name ON patient (family_name);` versus `where upper(p1_0.family_name)=upper(?)` | The index cannot serve the case-insensitive predicate, so both the page query and the new count query scan the table on PostgreSQL. Track in FHIR-122; measure with `EXPLAIN` before and after. |
| AR-002 | medium | correctness | `sample-app/src/main/java/org/example/fhir/api/Bundle.java:11` | `resources.size()` | Paged searches must pass `page.getTotalElements()`; add a `searchset(List<?>, long total, List<Link>)` factory and a test where `total` exceeds `_count`. |
| AR-003 | medium | testing | `sample-app/src/test/java/org/example/fhir/ApiTestSupport.java:19-21` | `@SpringBootTest` `@AutoConfigureMockMvc` `@ActiveProfiles("test")` (one shared H2 database, never cleaned) | Paging tests must create patients under a family name unique to the test and assert on that name only. |
| AR-004 | low | security | `sample-app/src/main/java/org/example/fhir/service/PatientService.java:35-37` | `if (!hasFamily && !hasMrn) {` | Keep the criterion guard ahead of paging so `_count` alone cannot list the table; test `searchWithOnlyCountIs400`. |
| AR-005 | low | security | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:40` | `service.search(family, mrn)` | `next` links repeat the client's own `family` value (PHI) in a URL. Build links relative to the request, and confirm ingress access logs do not record query strings (sre check). |

## Verification
- Tests (MockMvc, `PatientApiTest`): `searchDefaultsToTwentyEntriesWithFullTotal`, `searchHonoursCountUpToHundred`, `searchCapsCountAtHundred`, `searchWithZeroCountIs400`, `searchWithNonNumericCountIs400`, `nextLinkReturnsFollowingPageWithoutOverlap`, `lastPageHasNoNextLink`, `searchWithOnlyCountIs400`.
- Regression: `searchByFamilyReturnsSearchsetBundle` and `searchByIdentifierAcceptsSystemPipeValue` pass unchanged.
- Performance smoke: Hibernate statistics assertion of at most 2 prepared statements for one page request (`context/standards/testing-standards.md:9`).
- Security: `SecurityTest` gains `anonymousPagedSearchIs401`.
- Review: the reviewer agent checks `Bundle` JSON for Observation searches is byte-identical before and after (no `link` key).
