# Code review checklist (sample-app)

Each check names the rule it enforces. Cite that rule in the finding's recommendation (for example `coding-standards.md#6`). Categories are the eight from `context/standards/review-standards.md`.

## correctness
- [ ] Inputs that are legal for the domain still work: family names with apostrophes or hyphens (`O'Brien`, `Meitner-Frisch`), identifiers in `system|value` token form, empty optional params.
- [ ] Error paths throw `FhirApiException` factories (`notFound`, `badRequest`, `unprocessable`, `conflict`) so `GlobalExceptionHandler` returns the right status. An exception that falls through to `handleUnexpected` becomes a 500. (`coding-standards.md#4`, `api-standards.md` error list)
- [ ] Invariants enforced elsewhere still hold. Examples: `PatientService.search` rejects a search with no criteria; `PatientController.update` rejects a body id that differs from the path id; `ObservationService.create` rejects an unknown subject with 422.
- [ ] Null handling on optional fields (`effectiveDateTime`, `valueQuantity`, `given`).

## design
- [ ] Layering: controller → service → repository → domain. A controller must not inject a repository or `EntityManager`. (`coding-standards.md#1`)
- [ ] Controllers accept and return records from `org.example.fhir.api` (`PatientResource`, `ObservationResource`, `Bundle`), never entities from `org.example.fhir.domain`. (`coding-standards.md#2`, `.claude/rules/sample-app-java.md`)
- [ ] Read service methods are `@Transactional(readOnly = true)`; writes are transactional at the service layer. (`coding-standards.md#5`)
- [ ] New wire types are Java records. (`coding-standards.md#9`)

## readability
- [ ] Names state intent; no dead code or commented-out blocks; Javadoc on new public endpoints matches behaviour.

## testing
- [ ] Every new or changed endpoint has MockMvc tests: happy path, each 4xx path, 401 without credentials, 403 for a wrong role where roles apply. (`testing-standards.md` table, `.claude/rules/sample-app-java.md`)
- [ ] Invalid payloads → 422 `OperationOutcome`; unknown ids → 404. (`testing-standards.md` Negative row)
- [ ] Collection endpoints have a query-count assertion. (`testing-standards.md` Performance smoke row)
- [ ] A bug fix starts with a failing test named after the bug id. (`testing-standards.md` rules)
- [ ] Fixtures use synthetic data from `ApiTestSupport` helpers (`uniqueMrn()`, `patientJson`, `observationJson`).

## security
- [ ] No string concatenation into JPQL/SQL. Derived queries or `@Query` with bound parameters only. (`coding-standards.md#6`, `context/security/threat-model.md` "SQL injection" row)
- [ ] New `/fhir/**` paths are covered by the `SecurityConfig` filter chain; write paths have the right role matcher. (`phi-and-secrets-policy.md` "Authentication and authorization")
- [ ] No PHI (MRN, name, birthDate, gender, observation values) in logs, exception messages, or `OperationOutcome.diagnostics`. Only ids and counts. (`phi-and-secrets-policy.md` PHI section, glossary PHI table)
- [ ] Searches cannot list every patient: at least one criterion, bounded result size. (`context/architecture/overview.md` "Known constraints")
- [ ] No secrets or passwords in code or config outside `application-local.yml` / `application-test.yml`.

## performance
- [ ] No repository call inside a loop over entities. (`coding-standards.md#6`)
- [ ] Queries can use an index (`ix_patient_family_name`, `ix_observation_patient_code` in `V1__init.sql`); leading-wildcard `LIKE` and function-wrapped columns cannot.
- [ ] Result sets are bounded (planned `_count`, default 20, max 100 in `api-standards.md`).

## standards
- [ ] Patient and Observation access is recorded through `AuditLogger.record` / `AuditLogger.recordSearch`. (`coding-standards.md#7`)
- [ ] SLF4J parameterised messages; ids only. (`coding-standards.md#7`)
- [ ] URLs follow `api-standards.md`: `/{ResourceType}`, `/{ResourceType}/{id}`, search via query params returning a `searchset` `Bundle`, operations with a `$` prefix.
- [ ] Migrations are new `V<n>__*.sql` files; applied migrations are never edited. (`coding-standards.md#10`)

## docs
- [ ] `sample-app/README.md` endpoint table and curl examples match new or changed endpoints.
- [ ] `context/architecture/overview.md` endpoint list updated when an endpoint is added.
