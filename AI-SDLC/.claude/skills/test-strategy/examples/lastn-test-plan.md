# Test plan: GET /fhir/Observation/$lastn

- Change: harden and cover `$lastn` before the set-based rewrite of the planted N+1 (module 04 performance-review)
- Standards: `context/standards/testing-standards.md`
- Author: test-strategy skill (draft) for the tester agent
- Date: 2026-09-30

## Scope
In scope: request binding, filtering by code, per-subject selection of the latest Observation, error paths, authentication, statement count, and audit. Out of scope: fixing `TEACHING-DEFECT(perf-n+1)` (only detected here) and Observation create/read, which have their own tests in `ObservationApiTest`.

### Change surface (evidence)
| Element | Evidence |
|---|---|
| Binding: comma-separated ids into `List<Long>`, optional code | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43` `public Bundle lastN(@RequestParam List<Long> subjects, @RequestParam(required = false) String code) {` |
| Code token: system part discarded | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:44` `code.substring(code.indexOf('\|') + 1)` |
| Per-subject loop (planted N+1) | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69-71` `for (Long subjectId : subjectIds) {` / `patients.findById(subjectId).ifPresent(patient ->` |
| Latest = first row of a DESC ordering | `sample-app/src/main/java/org/example/fhir/repository/ObservationRepository.java:9` `List<Observation> findByPatientIdOrderByEffectiveDateTimeDesc(Long patientId);` |
| Code filter with trim | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:72` `.filter(o -> code == null \|\| code.isBlank() \|\| o.getCode().equals(code.trim()))` |
| Audit records a count only | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:76` `audit.recordSearch("Observation", result.size());` |
| `effectiveDateTime` is optional on the wire | `sample-app/src/main/java/org/example/fhir/api/ObservationResource.java:20` `OffsetDateTime effectiveDateTime,` |
| Test DB sorts NULL as largest | `sample-app/src/test/resources/application-test.yml:3` `DEFAULT_NULL_ORDERING=HIGH` |
| Auth: any authenticated CLINICIAN or ADMIN | `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:44` `.requestMatchers("/fhir/**").hasAnyRole(CLINICIAN, ADMIN)` |
| Missing / malformed parameter handling | `sample-app/src/main/java/org/example/fhir/error/GlobalExceptionHandler.java:44-52` `handleMissingParam` → `required`, `handleTypeMismatch` → `invalid` |

### Existing coverage
| Test | What it proves |
|---|---|
| `ObservationApiTest#lastnReturnsMostRecentObservationPerSubject` | Two subjects with dated observations: latest value per subject (61, 80). Nothing else about `$lastn` is tested. |

## Risks and defects found while planning
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TS-001 | medium | correctness | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:71` | Observed on a scratch copy: patient with an undated value 99 and a dated value 80 (2026-02-03) → `$lastn` returns `"valueQuantity":{"value":99` | NULL sorts first in DESC on H2 (`DEFAULT_NULL_ORDERING=HIGH`) and by default on PostgreSQL. Exclude undated rows or order `NULLS LAST`; ticket FHIR-130, proven by TC-10. |
| TS-002 | low | correctness | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43` | Observed: `subjects=1,1` → `"total":2` with the same Observation twice | De-duplicate ids before the lookup; ticket FHIR-131, proven by TC-11. |
| TS-003 | high | performance | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69` | Measured with Hibernate statistics: 1 subject → 2 statements, 10 → 20, 50 → 100 | Pre-existing planted defect `TEACHING-DEFECT(perf-n+1)`; detect with TC-13, fix in module 04. |
| TS-004 | medium | security | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43` | `@RequestParam List<Long> subjects` has no size limit | Cap at 100 subjects with 400 `OperationOutcome` (threat-model.md "Unbounded search" row); ticket FHIR-132, proven by TC-14. |
| TS-005 | low | correctness | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:44` | `code=http://snomed.info/sct\|8867-4` matches LOINC `8867-4` (reasoned from code, confirmed by TC-12) | Decide whether the system must match; until then TC-12 pins current behaviour. |
| TS-006 | low | testing | `sample-app/src/test/java/org/example/fhir/ObservationApiTest.java:80` | `void lastnReturnsMostRecentObservationPerSubject()` is the only `$lastn` test | Add the cases below; no 401, 400, empty or code-filter case exists today. |

## Test cases
| id | category | tool | test | scenario | expected | status |
|---|---|---|---|---|---|---|
| TC-01 | unit | JUnit 5 + Mockito | `ObservationServiceLastnTest#lastNFiltersByTrimmedCodeAndKeepsFirstMatch` | Repository returns BP 8480-6, HR 8867-4 (newer), HR (older); call with code `" 8867-4 "` | Only the newer HR observation | new |
| TC-02 | unit | JUnit 5 + Mockito | `ObservationServiceLastnTest#lastNSkipsUnknownSubjectsAndAuditsOnlyTheCount` | `patients.findById` empty for ids 41, 42 | Empty result, no observation query, `audit.recordSearch("Observation", 0)` | new |
| TC-03 | integration | SpringBootTest + H2 (Flyway) | `ObservationLastnTest#repositoryOrdersUndatedObservationsFirstOnH2` | One dated and one undated observation; call `findByPatientIdOrderByEffectiveDateTimeDesc` | First row has `effectiveDateTime` null (explains TS-001) | new |
| TC-04 | api | MockMvc + H2 | `ObservationLastnTest#lastnFiltersByLoincCodeWithSystemPipe` | HR 64 and BP 120 for one subject; `code=http://loinc.org\|8867-4` | 200, `total` 1, code 8867-4, value 64 | new |
| TC-05 | api | MockMvc + H2 | `ObservationLastnTest#lastnReturnsEmptySearchsetWhenNoObservationHasTheCode` | HR only; `code=8480-6` | 200 `searchset`, `total` 0, `entry` empty | new |
| TC-06 | negative | MockMvc | `ObservationLastnTest#lastnWithoutSubjectsParameterIs400` | No `subjects` | 400 `OperationOutcome`, `issue[0].code` = `required` | new |
| TC-07 | negative | MockMvc | `ObservationLastnTest#lastnWithNonNumericSubjectIs400` | `subjects=abc` | 400, `invalid`, diagnostics `Invalid value for parameter: subjects` | new |
| TC-08 | edge | MockMvc + H2 | `ObservationLastnTest#lastnSkipsUnknownSubjects` | One known id plus 987654321 | 200, `total` 1 (unknown ids are skipped, not 404) | new |
| TC-09 | edge | MockMvc | `ObservationLastnTest#lastnWithEmptySubjectsReturnsEmptyBundle` | `subjects=` | 200, `total` 0 (characterization; open question whether 400 is better) | new |
| TC-10 | edge | MockMvc + H2 | `ObservationLastnTest#lastnPrefersDatedObservationOverUndated` | Undated 99 and dated 80 for one subject | Value 80 (fails today with 99: TS-001) | new-failing |
| TC-11 | edge | MockMvc + H2 | `ObservationLastnTest#lastnReturnsOneEntryPerDistinctSubject` | Same id twice in `subjects` | `total` 1 (fails today with 2: TS-002) | new-failing |
| TC-12 | edge | MockMvc + H2 | `ObservationLastnTest#lastnIgnoresTheCodeSystemPart` | `code=http://snomed.info/sct\|8867-4` | 200, `total` 1 (pins TS-005) | new |
| TC-13 | performance | Hibernate statistics | `LastnQueryCountTest#lastnIssuesAConstantNumberOfStatementsRegardlessOfSubjectCount` | 20 subjects, 2 observations each (test from the performance-review skill, module 04) | Constant statement count (fails today with 40: TS-003) | new-failing |
| TC-14 | performance | MockMvc | `ObservationLastnTest#lastnRejectsMoreThanHundredSubjects` | 101 ids | 400 `OperationOutcome` (fails today with 200: TS-004) | new-failing |
| TC-15 | security | MockMvc | `ObservationLastnTest#lastnWithoutCredentialsIs401` | No credentials | 401, `issue[0].code` = `login` | new |
| TC-16 | security | MockMvc | `ObservationLastnTest#lastnWithWrongPasswordIs401` | `clinician` with a wrong password | 401 | new |
| TC-17 | security | MockMvc + H2 | `ObservationLastnTest#adminCanCallLastn` | ADMIN user | 200, subject reference `Patient/{id}` | new |
| TC-18 | regression | MockMvc + H2 | `ObservationApiTest#lastnReturnsMostRecentObservationPerSubject` | Existing guard named in `KNOWN_DEFECTS.md` "How to verify" | Keeps passing before and after the N+1 fix | existing |

## Coverage matrix
| category | cases | note |
|---|---|---|
| unit | TC-01, TC-02 | Service rules without Spring |
| integration | TC-03 | Repository ordering on the real schema |
| api | TC-04, TC-05 | Happy paths with code filter |
| negative | TC-06, TC-07 | Missing and malformed parameters |
| edge | TC-08, TC-09, TC-10, TC-11, TC-12 | Unknown, empty, undated, duplicate, foreign system |
| performance | TC-13, TC-14 | Statement count and request size |
| security | TC-15, TC-16, TC-17 | 401 paths and role matrix; no 403 case because every authenticated role may read |
| regression | TC-18 | Guard for the module 04 fix |

## Test data
All data is created per test through `ApiTestSupport.createPatient(family)` and `createObservation(patientId, code, when, value)` with a family name unique to the test (`Lastnundated`, `Lastnpipe`), because the H2 database is shared across test classes and never cleaned. Undated observations are posted as raw JSON since `observationJson` always sets `effectiveDateTime`. LOINC `8867-4` and `8480-6` only; no names or MRNs appear in assertions.

## Exit criteria
- All `existing` and `new` cases pass; `new-failing` cases fail for the stated finding and ship `@Disabled("FHIR-13x: ...")` until the bug-fix workflow enables them.
- `cd sample-app && mvn -q -B test` exits 0 (measured with the example files added: 41 tests run, 3 skipped, 0 failures).
- Implementation files: `sample-app/src/test/java/org/example/fhir/ObservationLastnTest.java`, `sample-app/src/test/java/org/example/fhir/service/ObservationServiceLastnTest.java` (examples in `.claude/skills/test-strategy/examples/`).
