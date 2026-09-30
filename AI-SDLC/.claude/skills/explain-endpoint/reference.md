# explain-endpoint reference: where things live in sample-app

All Java paths are under `sample-app/src/main/java/org/example/fhir/`.

## Map of concerns

| Concern | File | What to look for |
|---|---|---|
| Who may call it | `config/SecurityConfig.java` | `authorizeHttpRequests` rules are evaluated top to bottom; the first matching `requestMatchers` wins. `DELETE /fhir/**` needs `ADMIN`; other `/fhir/**` need `CLINICIAN` or `ADMIN`; `/actuator/health/**` is public; everything else is `denyAll`. |
| 401 and 403 bodies | `config/SecurityConfig.java` | The `unauthorized` entry point (401, issue code `login`) and the `accessDeniedHandler` (403, issue code `forbidden`) both write an `OperationOutcome`. |
| Routes and parameters | `api/PatientController.java`, `api/ObservationController.java` | Class-level `@RequestMapping` prefix plus the method mapping. Note any string parsing done in the controller (for example FHIR token syntax `system\|value`). |
| DTO and entity conversion | `api/PatientMapper.java`, `api/ObservationMapper.java` | `toResource`, `toEntity`, and `ObservationMapper.parseSubject` (accepts `Patient/{id}` or a bare id, 400 otherwise). |
| Request validation | `api/PatientResource.java`, `api/ObservationResource.java` | Bean Validation annotations on the records. Failures become 422 in `GlobalExceptionHandler.handleValidation`. |
| Business rules, transactions | `service/PatientService.java`, `service/ObservationService.java` | `@Transactional(readOnly = true)` on reads; `FhirApiException.notFound / badRequest / unprocessable / conflict`. |
| Error mapping | `error/GlobalExceptionHandler.java`, `error/FhirApiException.java` | Status and issue code per exception type. |
| Data access | `repository/PatientRepository.java`, `repository/ObservationRepository.java` | Spring Data derived queries; the inherited `JpaRepository` methods (`findById`, `existsById`, `save`, `deleteById`, `findAll`). |
| Schema and indexes | `src/main/resources/db/migration/V1__init.sql` (under `sample-app/`) | Tables `patient`, `observation`; `uq_patient_mrn`, `ix_patient_family_name`, `ix_observation_patient_code (patient_id, code)`; `ON DELETE CASCADE` from observation to patient. |
| Audit | `audit/AuditLogger.java` | `record(Action, type, id)` and `recordSearch(type, count)`; ids and counts only. |
| Tests | `sample-app/src/test/java/org/example/fhir/` | `PatientApiTest`, `ObservationApiTest`, `SecurityTest`; helpers in `ApiTestSupport`. |
| Known defect | `sample-app/docs/KNOWN_DEFECTS.md` | `TEACHING-DEFECT(perf-n+1)` in `ObservationService.lastN`. |

## From Spring Data method names to SQL

Hibernate 6 generates the SQL. These are the statements observed with `-Dspring.jpa.show-sql=true` on the test profile (H2 in PostgreSQL mode); PostgreSQL gets the same shape.

| Repository call | SQL shape |
|---|---|
| `findById(id)` | `select <all patient columns> from patient p1_0 where p1_0.id=?` |
| `existsById(id)` | `select count(*) from patient p1_0 where p1_0.id=?` |
| `existsByMrn(mrn)` | `select p1_0.id from patient p1_0 where p1_0.mrn=? fetch first ? rows only` (uses `uq_patient_mrn`) |
| `findByMrn(mrn)` | `select <all patient columns> from patient p1_0 where p1_0.mrn=?` |
| `findByFamilyNameIgnoreCaseOrderByIdAsc(f)` | `select <all patient columns> from patient p1_0 where upper(p1_0.family_name)=upper(?) order by p1_0.id` (the `upper()` call means a plain index on `family_name` is not used) |
| `findByPatientIdOrderByEffectiveDateTimeDesc(id)` | `select <observation columns> from observation o1_0 join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=? order by o1_0.effective_date_time desc` |
| `findByPatientIdAndCodeOrderByEffectiveDateTimeDesc(id, code)` | same join, plus `and o1_0.code=?` (can use `ix_observation_patient_code`) |
| `save(entity)` new | `insert into patient (...) values (?,...,default)` (identity column) |
| dirty entity at commit (`PatientService.update`) | `update patient set active=?,birth_date=?,... where id=?` (no explicit `save` call) |
| `deleteById(id)` | `select <all patient columns> ... where p1_0.id=?`, then `delete from patient where id=?`; observations go through the database `ON DELETE CASCADE` |

A human can confirm the statements for one endpoint by running its test with SQL logging, for example:

```bash
cd sample-app
mvn -q -B test -Dtest='ObservationApiTest#lastnReturnsMostRecentObservationPerSubject' -Dspring.jpa.show-sql=true | grep '^Hibernate:'
```

## Counting statements

Count per request, not per test. Say explicitly when the count grows with input (a loop over ids that calls a repository), because that is an N+1 pattern and violates rule 6 of `context/standards/coding-standards.md`.
