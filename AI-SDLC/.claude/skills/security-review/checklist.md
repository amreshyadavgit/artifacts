# Security review checklist (FHIR-lite sample app)

Paths are relative to `AI-SDLC/`. Run the Grep patterns with the Grep tool; open every hit before you decide.

## 1. phi: PHI and PII exposure
PHI fields (from `context/domain/fhir-lite-glossary.md`): MRN, family and given names, birthDate, gender, observation values linked to a patient. The surrogate `id` is not PHI.

- Logging calls that take entity getters: Grep `log\.(info|warn|error|debug)\(.*get(FamilyName|GivenNames|Mrn|BirthDate|Gender|ValueQuantity)` in `sample-app/src`.
- Any `toString()` on `Patient` or `Observation` (both entities deliberately have none): Grep `toString\(\)` in `sample-app/src/main/java/org/example/fhir/domain`.
- Exceptions whose message can carry request values. Open `error/GlobalExceptionHandler.java`: `handleUnexpected` logs the full exception. Ask what reaches it:
  - DTO fields without `@Size` whose DB column is bounded (compare `api/PatientResource.java` and `api/ObservationResource.java` with `db/migration/V1__init.sql`). An over-long value becomes a `DataIntegrityViolationException`; Hibernate's `SqlExceptionHelper` and the handler log the driver message. On H2 that message contains the rejected value.
  - Unique-constraint races (check-then-insert in `service/PatientService.java`). PostgreSQL's driver includes `Detail: Key (mrn)=(...)` in the message by default.
- `OperationOutcome.diagnostics` built from request input: Grep `FhirApiException\.(badRequest|unprocessable|conflict)\(` and check nothing but ids and field names is concatenated.
- Test fixtures and docs: only synthetic values (`MRN-000123`, "Test Patient"). Grep `MRN-[0-9]` and check each hit.

## 2. logging-audit
- Every service read or write calls `AuditLogger` (`audit/AuditLogger.java`). Grep `audit\.record` in `sample-app/src/main/java/org/example/fhir/service`.
- Can an auditor answer "which patients did user X access?" `recordSearch` logs only a type and a count. Check each search path (`ObservationService.searchBySubject`, `ObservationService.lastN`, `PatientService.search`).
- Failed authentication (401) and authorization (403) events: are they recorded anywhere? Look at the entry point and access-denied handler in `config/SecurityConfig.java`.
- Shared accounts (`clinician`) defeat attribution. Note it if a change adds a client that will share one.

## 3. authn
- `config/SecurityConfig.java`: HTTP Basic, stateless, in-memory users; passwords from `SecurityProperties` (`@NotBlank`, no defaults outside `local`/`test`).
- Brute force: is there lockout, rate limiting, or an upstream control? HTTP Basic sends credentials on every request: is TLS guaranteed (see `k8s/service.yaml`)?
- New `permitAll()` matchers: Grep `permitAll|anonymous\(\)|web\.ignoring`.

## 4. authz
- Matcher order in `securityFilterChain`: the DELETE rule (`HttpMethod.DELETE, "/fhir/**"`) must come before the generic `/fhir/**` rule. First match wins.
- Every new write endpoint (`@PostMapping|@PutMapping|@DeleteMapping|@PatchMapping`) is covered by a matcher and a `SecurityTest` case for 401 and 403.
- Object-level access: ids are sequential `BIGINT` identities (`V1__init.sql`). Any CLINICIAN can read any `Patient/{id}`. Flag new endpoints that widen this (bulk or cross-patient operations such as `$lastn`).

## 5. input-validation
- Every `@RequestBody` has `@Valid`. Grep `@RequestBody` and check.
- String fields have `@Size` matching the column length; lists have a maximum size.
- `@RequestParam` collections (`List<Long> subjects`) have an upper bound.
- Path and query parsing (`ObservationMapper.parseSubject`, `identifier.substring(...)`) handles malformed input with a 400 `OperationOutcome`, not a 500.

## 6. injection
- Grep `@Query|createQuery|createNativeQuery|nativeQuery|JdbcTemplate|\+ *"\s*(select|where|and|or)\b` (case-insensitive) in `sample-app/src/main`.
- Any query text built with `+` or `String.format` from input is `critical`.
- Native queries must bind parameters (`:name`), never concatenate.
- Log injection: user input logged without encoding (CR/LF). Audit lines contain ids and usernames only.

## 7. api-security
- Unbounded requests or responses: searches without pagination, `$lastn` without a subject cap (`CWE-770`).
- Enumeration: sequential ids plus 404 vs 403 differences.
- Error shape: every error is an `OperationOutcome` without stack traces or SQL (`GlobalExceptionHandler`, `SecurityConfig.write`).
- Actuator exposure: `management.endpoints.web.exposure.include` in `application.yml` must stay `health,info`; `show-details: never`.
- CSRF is disabled on purpose (stateless, no cookies). Flag it only if a change adds sessions or cookies.

## 8. secrets
- Grep `(password|secret|token|apikey|api_key)\s*[:=]` across `sample-app/` (yml, yaml, properties, java, Dockerfile, compose).
- `k8s/deployment.yaml` must use `secretKeyRef` for `DB_PASSWORD`, `FHIR_CLINICIAN_PASSWORD`, `FHIR_ADMIN_PASSWORD`.
- `application-local.yml`, `application-test.yml` and `docker-compose.yml` contain documented dev-only values. Report them as `low` unless a change makes them reachable outside local development.

## 9. dependencies
- `pom.xml`: Spring Boot parent version; any dependency with an explicit version that overrides the BOM.
- Is there an SCA step (OWASP dependency-check, CycloneDX SBOM, Dependabot/Renovate)? If not, report `low`.
- You cannot check CVE feeds offline. Say so in `limitations`; do not guess CVE ids.

## 10. infrastructure
- `k8s/deployment.yaml`: `runAsNonRoot`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem`, dropped capabilities, `seccompProfile`, `automountServiceAccountToken`, image tag vs digest, resource limits.
- NetworkPolicy present? (There is none in `k8s/`.)
- `Dockerfile`: non-root `USER`, no secrets in `ENV` or build args.
