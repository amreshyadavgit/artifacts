# Known (intentional) defects

This reference app is used for curriculum exercises. Exactly **one** defect is planted on purpose.
Everything else is intended to be clean; if you find another problem, it is a real bug.

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
