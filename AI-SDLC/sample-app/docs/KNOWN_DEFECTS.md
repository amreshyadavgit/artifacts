# Known (intentional) defects

This reference app is used for curriculum exercises. Exactly **one** defect is planted on purpose (section 1). Section 2 lists real,
unplanned bugs that the course's own agents found while the curriculum was being written. They are
deliberately left unfixed because exercises use them as realistic findings. Do not fix any of them
unless an exercise tells you to.

## 1. `perf-n+1` — N+1 queries in `$lastn`

| | |
|---|---|
| Marker | `// TEACHING-DEFECT(perf-n+1)` |
| Location | `src/main/java/org/example/fhir/service/ObservationService.java`, method `lastN` (marker at line 64, loop at line 69) |
| Endpoint | `GET /fhir/Observation/$lastn?subjects=1,2,3[&code=...]` |
| Symptom | Latency grows linearly with the number of subjects; 2 SQL statements per subject. |
| Why | The loop calls `patientRepository.findById` and then `findByPatientIdOrderByEffectiveDateTimeDesc` for each id, loading each patient's full observation history just to keep the first row. |
| Expected fix | Replace the loop with one set-based query (e.g. `WHERE patient_id IN (:ids)` plus a window function or a `max(effective_date_time)` subquery per patient), and cap the number of `subjects` per request. |
| How to verify | Turn on `spring.jpa.show-sql=true` (or Hibernate statistics) and count statements for 1 vs. 50 subjects; the existing `lastnReturnsMostRecentObservationPerSubject` test must keep passing. |

## 2. Discovered defects (real bugs found by the course agents, left in place for exercises)

| Id | Location | Defect | Found by / used in |
|---|---|---|---|
| D-01 | `ObservationService.create` | Does not check that the subject Patient is `active` (glossary business rule 3): observations can be recorded against inactive patients. | reviewer agent; exercise `05-roster-smoke-test` |
| D-02 | `ObservationService.lastN` | An Observation with no `effectiveDateTime` can be returned as the "latest" one (null ordering). | code-review / test-strategy skills; module 03 (recorded as an `@Disabled` test in the exercise material) |
| D-03 | `ObservationService.lastN` | Duplicate subject ids (`subjects=1,1`) return the same Observation twice. | code-review / test-strategy skills; module 03 |
| D-04 | `GlobalExceptionHandler` (+ Hibernate `SqlExceptionHelper` logging) | An over-long `given` name (e.g. 280 characters) causes a 500, and the DB error logged at ERROR level contains the submitted name: PHI in logs. | security-review skill (finding SEC-001); module 04 |
