## Summary
The change adds `GET /fhir/Patient/_by-name?name=` to `PatientController`, backed by a new `PatientNameSearch` repository class that builds JPQL by string concatenation. It introduces a JPQL injection that lists every patient, a 500 on legitimate names such as `O'Brien`, PHI in application logs, a JPA entity returned on the wire, and no tests. Findings: 1 critical, 5 high, 2 medium, 2 low. Verdict: BLOCK.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-001 | critical | security | `sample-app/src/main/java/org/example/fhir/repository/PatientNameSearch.java:19-20` | `String jpql = "select p from Patient p where lower(p.familyName) like '%" + fragment.toLowerCase() + "%' order by p.id";` | Bind the value: `@Query("select p from Patient p where lower(p.familyName) like lower(concat('%', :fragment, '%')) order by p.id")` on `PatientRepository`, and escape `%` and `_` in the fragment (`coding-standards.md#6`, threat-model.md "SQL injection" row). |
| CR-002 | high | correctness | `sample-app/src/main/java/org/example/fhir/repository/PatientNameSearch.java:21` | `em.createQuery(jpql, Patient.class).getResultList();` with `name=O'Brien` fails with `org.hibernate.query.SyntaxException: At 1:59 and token 'brien'` and returns HTTP 500 | Fixed by the bound parameter in CR-001; add a test for an apostrophe name (`coding-standards.md#4`: failures must map to an `OperationOutcome` 4xx, not fall through to `handleUnexpected`). |
| CR-003 | high | security | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:54` | `log.info("Patient name search: {}", name);` | Remove the log line; record the search with `audit.recordSearch("Patient", result.size())` in the service. Family name is PHI (fhir-lite-glossary.md PHI table; phi-and-secrets-policy.md "Never log PHI"). |
| CR-004 | high | design | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:53` | `public List<Patient> byName(@RequestParam String name) {` | Return `Bundle.searchset(...map(PatientMapper::toResource)...)` like `search` at line 48. The entity serialises as `{"id":1,"mrnSystem":...,"mrn":...,"familyName":...}`, which is not the FHIR-lite shape (`coding-standards.md#2`, api-standards.md "Search"). |
| CR-005 | high | security | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:53-55` | `@RequestParam String name` accepts `name=` (empty), which becomes `like '%%'` and returns every patient | Reject blank fragments with `FhirApiException.badRequest(...)` and require a minimum length, matching the rule in `PatientService.search` (`"At least one search parameter (family, identifier) is required"`) and overview.md "Patient search without parameters returns 400". Cap the result size (api-standards.md `_count`, max 100). |
| CR-006 | high | testing | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:52` | `git diff --stat HEAD` lists only `PatientController.java` and `PatientNameSearch.java`; nothing under `sample-app/src/test/` | Add MockMvc tests in `PatientApiTest`: partial match, case-insensitive match, apostrophe name, blank `name` → 400, and in `SecurityTest` anonymous → 401 (testing-standards.md "API / integration" and "Negative" rows). |
| CR-007 | medium | design | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:31` | `private final PatientNameSearch nameSearch;` (controller calls the persistence layer directly; no `@Transactional(readOnly = true)`) | Move the query to `PatientRepository` and call it from a `PatientService.searchByFamilyFragment` method annotated `@Transactional(readOnly = true)` (`coding-standards.md#1`, `coding-standards.md#5`). |
| CR-008 | medium | standards | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:55` | `return nameSearch.byFamilyFragment(name);` (no `AuditLogger` call; compare `audit.recordSearch("Patient", result.size());` in `PatientService.search`) | Record the search through `AuditLogger.recordSearch` in the service (`coding-standards.md#7`). |
| CR-009 | low | performance | `sample-app/src/main/java/org/example/fhir/repository/PatientNameSearch.java:19` | `lower(p.familyName) like '%"` (leading wildcard on a function-wrapped column) | Leading-wildcard `LIKE` on `lower(family_name)` cannot use `ix_patient_family_name` from `V1__init.sql`; prefer prefix match (`like :fragment%`) and bound the result (`coding-standards.md#6`). |
| CR-010 | low | docs | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:52` | `@GetMapping("/_by-name")` is not in the endpoint table of `sample-app/README.md` or `context/architecture/overview.md` | Prefer extending the existing search (`GET /fhir/Patient?family=...`) over a new non-FHIR path; if the path stays, document it (api-standards.md "Search"). |

## Details
### CR-001
Reproduced on a scratch copy with the patch applied: `GET /fhir/Patient/_by-name?name=zzz%25' or p.id > 0 or '1' like '1` returns HTTP 200 with every patient in the database. Any authenticated `CLINICIAN` can dump all demographics, which is PHI exposure (phi-and-secrets-policy.md, severity `critical`). Spring Data derived queries such as `findByFamilyNameContainingIgnoreCaseOrderByIdAsc(String fragment)` bind the value and remove the concatenation entirely.

### CR-002
The same concatenation breaks on legitimate input. `GlobalExceptionHandler.handleUnexpected` logs the exception, and the Hibernate message contains the full JPQL including the submitted name (`[select p from Patient p where lower(p.familyName) like '%o'brien%' order by p.id]`), so this is also a second PHI-in-logs path (see CR-003).

### CR-003
`log.info` on the `org.example.fhir.api.PatientController` logger writes the raw search term to stdout, which the cluster ships to the log store. Names may never appear in logs. Patient access belongs in the `AUDIT` logger, with counts only.

### CR-004
Returning `List<Patient>` bypasses `PatientMapper` and the `searchset` `Bundle`. Clients get a different JSON shape from every other search, and any future entity field (for example an internal flag) leaks automatically.

### CR-005
Every other Patient search refuses a request without criteria so that no caller can list the whole table. An empty or one-character fragment defeats that rule. Combine with CR-001's fix and a minimum fragment length of 2.

### CR-006
The existing 25 tests still pass with this patch applied (`mvn -q -B test` exits 0), so CI is green while CR-001 to CR-005 ship. Each of those findings needs a test that fails before the fix.

### CR-007
`PatientNameSearch` is a second persistence entry point next to `PatientRepository`. Keeping one repository per aggregate keeps queries reviewable and lets the service own the transaction.

### CR-008
The audit trail is how the organisation answers "who searched for which records". A search that skips `AuditLogger` is invisible to it.

### CR-009
With the leading `%`, PostgreSQL scans the whole `patient` table on every keystroke of a front-desk lookup.

### CR-010
FHIR string search already has a `:contains` modifier (`family:contains=smi`). Using it keeps one search endpoint and one test matrix.

## Categories checked
- correctness: CR-002
- design: CR-004, CR-007
- readability: no findings
- testing: CR-006
- security: CR-001, CR-003, CR-005
- performance: CR-009
- standards: CR-008
- docs: CR-010

## Verdict
BLOCK
