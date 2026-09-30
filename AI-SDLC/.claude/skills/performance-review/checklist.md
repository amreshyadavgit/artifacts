# Performance review checklist (FHIR-lite sample app)

Paths are relative to `AI-SDLC/`. Defaults quoted here are Spring Boot 3.5 defaults; check `application.yml` for overrides before relying on them.

## queries
- List every repository call on the request path. Derived queries: read the method name; `@Query`: read the text.
- Does the query load more rows than the response needs? Example: `findByPatientIdOrderByEffectiveDateTimeDesc` loads a patient's whole history; `$lastn` keeps one row.
- Does it load columns it does not need? `patients.findById` loads every `patient` column (including PHI columns) when only existence is needed; `existsById` is cheaper.
- Turn on `-Dspring.jpa.show-sql=true` in a test run and read the generated SQL. Derived queries on `patient.id` generate `join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=?`, an unnecessary join.

## indexes
- Indexes in `db/migration/V1__init.sql`: `uq_patient_mrn (mrn)`, `ix_patient_family_name (family_name)`, `ix_observation_patient_code (patient_id, code)`.
- For each `WHERE` and `ORDER BY`, name the index that serves it, or report that none does:
  - `ORDER BY effective_date_time DESC` per patient: not covered; propose `(patient_id, effective_date_time DESC)` and `(patient_id, code, effective_date_time DESC)` in a new `V2__` migration.
  - `findByFamilyNameIgnoreCaseOrderByIdAsc` generates `upper(p1_0.family_name)=upper(?)`, which cannot use `ix_patient_family_name` on PostgreSQL. Options: an expression index on `upper(family_name)` (check that H2 accepts the DDL, since migrations must stay portable) or a normalised column.
- On PostgreSQL, confirm with `EXPLAIN (ANALYZE, BUFFERS)` on a synthetic dataset, never on production data.

## n+1
- Any repository call inside `for`, `forEach`, `stream().map(...)` over ids or entities. Grep `for \(|forEach\(|\.map\(` in `sample-app/src/main/java/org/example/fhir/service`.
- Lazy associations touched in a loop. `Observation.patient` is `LAZY`; `ObservationMapper.toResource` calls `o.getPatient().getId()`, which reads the id from the proxy without a query. Calling any other getter on it would load the patient per row.
- Measure: statements for 1 subject vs 20 subjects. Constant = fine. Linear = N+1.

## caching
- Is the data cacheable at all? Observations change on every POST; per-patient latest values are a poor fit for a shared cache without invalidation.
- Hibernate second-level cache is not configured. Do not propose it for PHI entities without a data-classification decision (cached PHI is PHI at rest in another store).
- HTTP caching: responses carry no `ETag`/`Cache-Control`. For PHI, `Cache-Control: no-store` is the safer default; do not propose public caching.

## latency
- Is there a per-request bound on work? `@RequestParam List<Long> subjects` on `$lastn` has none; searches have no pagination (`_count` is planned in `context/standards/api-standards.md`).
- Timeouts: no `spring.datasource.hikari.connection-timeout` override (default 30 s), no statement timeout (`spring.jpa.properties.jakarta.persistence.query.timeout` or a PostgreSQL `statement_timeout`). A slow query holds a Tomcat thread and a pool connection for its full duration.
- Probes: `k8s/deployment.yaml` readiness and liveness probes set no `timeoutSeconds` (Kubernetes default 1 s) and hit the same Tomcat connector as traffic. Under load they time out before the app is actually broken.

## concurrency
- HikariCP default `maximumPoolSize` is 10 per pod; Tomcat default max threads 200. With 2 replicas that is 20 DB connections for up to 400 in-flight requests.
- Long read transactions (`@Transactional(readOnly = true)` around a loop) hold a connection for the whole loop.
- Check-then-act sequences (`existsByMrn` then `save` in `PatientService.create`) are races, not locks; report them to security-review as well.

## memory
- Rows hydrated per request times entity size. `$lastn` with deep histories hydrates every observation of every subject.
- Container limit 768Mi with `-XX:MaxRAMPercentage=75` (`Dockerfile`) gives about 576Mi heap. Large per-request allocations under concurrency push the JVM into back-to-back GCs; HikariCP then logs `Thread starvation or clock leap detected`.

## cpu
- Limit `cpu: "1"` in `k8s/deployment.yaml`. Entity hydration, JSON serialisation and GC share that one core; CFS throttling shows up as latency, not as errors.
- Per-row work in Java that the database could do (`.filter(o -> ... o.getCode().equals(code.trim()))` after loading the history).

## network
- Round trips per request: each statement is one round trip to PostgreSQL. 1,000 statements at 1 ms each is 1 s before any work is done.
- Payload size: `Bundle` responses without pagination grow with history length.
- URL length: `subjects=1,2,...` with hundreds of ids approaches proxy limits (many ingresses default to 4-8 KiB request lines). Prefer a cap, and `POST` with a body for larger batches.
