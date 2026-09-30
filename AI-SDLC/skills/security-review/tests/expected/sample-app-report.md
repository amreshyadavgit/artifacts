# Security review: sample-app/

- Mode: path
- Verdict: **block**
- Findings: critical 0, high 1, medium 5, low 3, info 1

## Findings

| id | severity | category | location | title | PHI |
|---|---|---|---|---|---|
| SEC-001 | high | phi | `sample-app/src/main/java/org/example/fhir/error/GlobalExceptionHandler.java:71` | Unhandled database errors write submitted patient names to the application log | yes |
| SEC-002 | medium | logging-audit | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:76` | Audit trail cannot tell which patients a search or $lastn call exposed | no |
| SEC-003 | medium | api-security | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43` | $lastn accepts an unbounded list of subject ids | no |
| SEC-004 | medium | authz | `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:44` | No object-level authorization: any clinician can read every patient by sequential id | no |
| SEC-005 | medium | authn | `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:46` | HTTP Basic without brute-force protection, and no TLS in the manifests | no |
| SEC-006 | medium | phi | `sample-app/src/main/java/org/example/fhir/service/PatientService.java:52-55` | Duplicate-MRN check is check-then-insert; the race returns 500 and on PostgreSQL logs the MRN | yes |
| SEC-007 | low | infrastructure | `sample-app/k8s/deployment.yaml:22-26` | Pod hardening gaps in the Deployment | no |
| SEC-008 | low | dependencies | `sample-app/pom.xml:78-85` | No dependency scanning or SBOM in the build | no |
| SEC-009 | low | secrets | `sample-app/docker-compose.yml:7` | Dev-only credentials committed in compose and the local profile | no |
| SEC-010 | info | api-security | `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:39` | CSRF disabled and default security headers: appropriate for a stateless API | no |

### SEC-001 (high): Unhandled database errors write submitted patient names to the application log

- Category: phi (CWE-532); confidence high
- Location: `sample-app/src/main/java/org/example/fhir/error/GlobalExceptionHandler.java:71`
- Related: SEC-006

Evidence:

```text
GlobalExceptionHandler.java:69-71:
    @ExceptionHandler(Exception.class)
    ResponseEntity<OperationOutcome> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);

PatientResource.java:24 (no @Size on the list or its items):
    public record HumanName(@NotBlank @Size(max = 255) String family, List<@NotBlank String> given) {}
V1__init.sql:8:
    given_names  VARCHAR(255),

Reproduced on H2 (test profile): POST /fhir/Patient with a 280-character given name returns 500 OperationOutcome "Internal server error" and logs at ERROR from o.h.engine.jdbc.spi.SqlExceptionHelper and GlobalExceptionHandler:
    Value too long for column "given_names CHARACTER VARYING(255)": "'[REDACTED given name]... (280)"
The same path exists for Identifier.system (PatientResource.java:22, column mrn_system VARCHAR(255)).
```

Recommendation: 1) Add @Size to every bounded DTO field: HumanName.given as List<@NotBlank @Size(max = 100) String> with @Size(max = 5) on the list (joined value must fit 255), Identifier.system @Size(max = 255), and the Coding/Quantity fields in ObservationResource. 2) Add an @ExceptionHandler(DataIntegrityViolationException.class) that returns 409/422 OperationOutcome without the driver message. 3) In handleUnexpected log ex.getClass().getName() plus a correlation id, not the exception message chain. 4) Set logging.level.org.hibernate.engine.jdbc.spi.SqlExceptionHelper=OFF outside local, and add logServerErrorDetail=false to DB_URL for PostgreSQL. 5) Add a MockMvc test posting a 256-character given name that expects 422.

### SEC-002 (medium): Audit trail cannot tell which patients a search or $lastn call exposed

- Category: logging-audit; confidence high
- Location: `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:76`

Evidence:

```text
ObservationService.java:43 (searchBySubject) and :76 (lastN):
        audit.recordSearch("Observation", result.size());
AuditLogger.java:25-26:
    public void recordSearch(String resourceType, int resultCount) {
        AUDIT.info("action={} resource={} results={} user={}", Action.SEARCH, resourceType, resultCount, currentUser());
A $lastn call for 100 patients is recorded as one line 'action=SEARCH resource=Observation results=100 user=clinician'. Failed logins (401) and denied requests (403) in SecurityConfig.java:34-37 and :49-50 are not audited at all.
```

Recommendation: Record the subject ids (opaque, not PHI per context/domain/fhir-lite-glossary.md): add AuditLogger.recordSearch(String resourceType, Collection<Long> subjectIds, int resultCount) and call it from searchBySubject, lastN and PatientService.search (ids of returned patients). Audit 401/403 from the entry point and access-denied handler with the username and path only. This is what an access report under HIPAA 45 CFR 164.312(b) audit controls needs.

### SEC-003 (medium): $lastn accepts an unbounded list of subject ids

- Category: api-security (CWE-770); confidence high
- Location: `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43`
- Related: PERF-001

Evidence:

```text
ObservationController.java:43:
    public Bundle lastN(@RequestParam List<Long> subjects, @RequestParam(required = false) String code) {
No size check in ObservationService.lastN (lines 62-78); each id costs two queries (TEACHING-DEFECT(perf-n+1)). Any authenticated clinician can tie up a DB connection and a request thread with one long URL.
```

Recommendation: Reject more than 100 subjects with 400 OperationOutcome (matches the planned _count maximum in context/standards/api-standards.md) and add a MockMvc test. The query cost itself is covered by the performance-review skill (PERF-001).

### SEC-004 (medium): No object-level authorization: any clinician can read every patient by sequential id

- Category: authz (CWE-639); confidence medium
- Location: `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:44`

Evidence:

```text
SecurityConfig.java:44:
                .requestMatchers("/fhir/**").hasAnyRole(CLINICIAN, ADMIN)
V1__init.sql:3:
    id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
PatientService.get(Long id) (PatientService.java:24-28) checks existence only. context/architecture/overview.md lists 'switch to UUIDs to avoid enumeration' as an ADR candidate.
```

Recommendation: Decide explicitly (ADR): either accept role-only access for this service and document it in context/security/threat-model.md, or scope reads to the caller's organization or care team (SMART-on-FHIR patient/*.read scopes) and move to non-sequential ids. Until then, flag every new cross-patient or bulk endpoint as high.

### SEC-005 (medium): HTTP Basic without brute-force protection, and no TLS in the manifests

- Category: authn; confidence medium
- Location: `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:46`

Evidence:

```text
SecurityConfig.java:46:
            .httpBasic(basic -> basic.authenticationEntryPoint(unauthorized))
k8s/service.yaml:12-14:
    - name: http
      port: 80
      targetPort: http
No lockout, rate limit or ingress with TLS is defined in sample-app/k8s/. Credentials are sent on every request.
```

Recommendation: Terminate TLS in front of the Service (ingress or mesh) and record where in the manifests or platform docs. Add rate limiting at the ingress for 401 responses. The class comment already names the target: OAuth2 / SMART-on-FHIR bearer tokens instead of shared Basic credentials.

### SEC-006 (medium): Duplicate-MRN check is check-then-insert; the race returns 500 and on PostgreSQL logs the MRN

- Category: phi (CWE-532); confidence medium
- Location: `sample-app/src/main/java/org/example/fhir/service/PatientService.java:52-55`
- Related: SEC-001

Evidence:

```text
PatientService.java:52-55:
        if (patients.existsByMrn(patient.getMrn())) {
            throw FhirApiException.conflict("A Patient with this identifier already exists");
        }
        Patient saved = patients.save(patient);
Two concurrent POSTs with the same MRN both pass existsByMrn; the second hits uq_patient_mrn (V1__init.sql:11) and falls through to handleUnexpected (500). The PostgreSQL JDBC driver includes the server detail 'Key (mrn)=([REDACTED])' in the exception message by default.
```

Recommendation: Map DataIntegrityViolationException on uq_patient_mrn to 409 OperationOutcome (same handler as SEC-001) and keep the existsByMrn pre-check for the common case. Add a test that saves a duplicate through the repository and expects 409 without the MRN in the body or logs.

### SEC-007 (low): Pod hardening gaps in the Deployment

- Category: infrastructure; confidence high
- Location: `sample-app/k8s/deployment.yaml:22-26`

Evidence:

```text
deployment.yaml:22-26:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: api
          image: fhir-lite-api:0.1.0
No seccompProfile, no automountServiceAccountToken: false, image referenced by mutable tag, no NetworkPolicy in sample-app/k8s/.
```

Recommendation: Add seccompProfile: {type: RuntimeDefault} to the pod securityContext, automountServiceAccountToken: false (the app does not call the Kubernetes API), pin the image by digest in the release pipeline, and add a NetworkPolicy that allows ingress only from the ingress controller and egress only to postgres:5432.

### SEC-008 (low): No dependency scanning or SBOM in the build

- Category: dependencies; confidence high
- Location: `sample-app/pom.xml:78-85`

Evidence:

```text
pom.xml:78-85 declares only spring-boot-maven-plugin. There is no OWASP dependency-check, CycloneDX or equivalent step, so CVEs in the Spring Boot 3.5.6 BOM or the PostgreSQL/H2 drivers would go unnoticed.
```

Recommendation: Add the CycloneDX Maven plugin to produce an SBOM and run an SCA scan in CI (OWASP dependency-check or the platform's scanner). Fail the build on high-severity CVEs in runtime-scoped dependencies.

### SEC-009 (low): Dev-only credentials committed in compose and the local profile

- Category: secrets; confidence high
- Location: `sample-app/docker-compose.yml:7`

Evidence:

```text
docker-compose.yml:7:
      POSTGRES_PASSWORD: fhir-dev-password
docker-compose.yml:26-28 and application-local.yml:10-11 set the demo user passwords documented in sample-app/README.md. The committed Kubernetes Deployment correctly uses secretKeyRef (deployment.yaml:37-50).
```

Recommendation: Acceptable for local development only. Keep them out of any shared environment: read them from an untracked .env in compose (POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}) and add a check that the local profile is never active when DB_URL points at a non-local host.

### SEC-010 (info): CSRF disabled and default security headers: appropriate for a stateless API

- Category: api-security; confidence high
- Location: `sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:39`

Evidence:

```text
SecurityConfig.java:39-40:
            .csrf(csrf -> csrf.disable()) // stateless API, no cookies/sessions
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
```

Recommendation: No change. Re-check if a change introduces cookies, sessions or a browser client.

## Checked and clean

- **injection**: Only Spring Data derived queries in PatientRepository.java and ObservationRepository.java; Grep for @Query|createQuery|createNativeQuery|JdbcTemplate in sample-app/src/main returns nothing.
- **input-validation**: Every @RequestBody has @Valid (PatientController.java:44 and :51, ObservationController.java:49); malformed JSON, missing params and type mismatches map to 400 OperationOutcome in GlobalExceptionHandler.java:39-52. Size gaps are reported in SEC-001.
- **phi**: Validation errors echo field names and constraint messages only (GlobalExceptionHandler.java:32-35); Patient has no toString() (Patient.java:11-14); AuditLogger logs type, id, count and username only.
- **secrets**: k8s/deployment.yaml:37-50 reads DB_PASSWORD, FHIR_CLINICIAN_PASSWORD and FHIR_ADMIN_PASSWORD from secretKeyRef fhir-lite-secrets; application.yml:7 and :25-26 have no defaults outside local/test.
- **api-security**: application.yml:28-37 exposes only health,info with show-details: never; SecurityConfig.java:45 denies any request outside /fhir/** and the health endpoints.
- **authz**: SecurityConfig.java:43 places the DELETE /fhir/** ADMIN rule before the generic /fhir/** rule; SecurityTest.clinicianCannotDelete covers it.

## Limitations

- No network access: CVE status of Spring Boot 3.5.6 and the JDBC drivers was not checked.
- No running cluster: TLS termination and ingress configuration outside sample-app/k8s/ were not inspected.
- The PostgreSQL message format in SEC-006 is from driver documentation, not reproduced here (tests run on H2).
