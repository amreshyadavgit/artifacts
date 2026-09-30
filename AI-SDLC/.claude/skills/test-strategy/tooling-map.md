# Test categories mapped to this repo's tooling

Every plan uses these eight categories. The "tool" column of a test case must name the tooling below. All of it is already on the test classpath through `spring-boot-starter-test` and `spring-security-test` in `sample-app/pom.xml`; do not plan tests that need a new dependency without saying so.

| Category | Tooling | Where | Pattern in this repo |
|---|---|---|---|
| unit | JUnit 5, AssertJ, Mockito (no Spring context) | `sample-app/src/test/java/org/example/fhir/service/` | `new ObservationService(mock(ObservationRepository.class), mock(PatientRepository.class), mock(AuditLogger.class))`; verify `audit.recordSearch(...)` |
| integration | `@SpringBootTest` with H2 in PostgreSQL mode and Flyway (`ApiTestSupport`), calling a repository or service bean directly | `sample-app/src/test/java/org/example/fhir/` | `@Autowired ObservationRepository`; proves query semantics such as ordering and null handling on the real schema |
| api | MockMvc through `ApiTestSupport` (`mvc`, `CLINICIAN`, `ADMIN`) | same | `mvc.perform(get(url).with(CLINICIAN)).andExpect(jsonPath("$.total").value(1))` |
| negative | MockMvc | same | 400 `required` / `invalid`, 404 `not-found`, 409 `duplicate`, 422 `invalid` or `processing`, always an `OperationOutcome` |
| edge | MockMvc or unit | same | empty lists, duplicates, nulls (`effectiveDateTime`), boundaries (`_count` 0/1/100/101), case and whitespace in parameters |
| performance | Hibernate statistics query-count assertion | same, with `@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")` | `emf.unwrap(SessionFactory.class).getStatistics().getPrepareStatementCount()`; see `LastnQueryCountTest` in the performance-review skill (module 04) |
| security | MockMvc with no credentials, wrong password, wrong role | same (`SecurityTest` for shared cases) | 401 with `WWW-Authenticate` and `issue[0].code = login`; 403 with `issue[0].code = forbidden`; no PHI in `diagnostics` |
| regression | Existing test that must keep passing, or a new one named after the bug id | same | `bug42_searchByFamilyIsCaseInsensitive` (`testing-standards.md` naming) |

## Facts about the test harness that change test design
- `ApiTestSupport` starts one Spring context with one in-memory H2 database (`jdbc:h2:mem:fhirtest`, `sample-app/src/test/resources/application-test.yml`) shared by every test class that extends it, and never cleans it. Assert on rows your test created (unique family name per test), never on global counts.
- H2 runs with `MODE=PostgreSQL;DEFAULT_NULL_ORDERING=HIGH`: `NULL` sorts as the largest value, so it comes first in `DESC` order, as in PostgreSQL's default.
- `ApiTestSupport.observationJson` always sets `effectiveDateTime`; to test an undated Observation, post the JSON body directly.
- Test names state behaviour (`returns404WhenPatientMissing`). Test status in a plan is `existing` (method already in `sample-app/src/test`), `new` (passes against current code once written), or `new-failing` (fails today because of a defect the plan found; ship it `@Disabled("<ticket>: reason")` until the fix).
