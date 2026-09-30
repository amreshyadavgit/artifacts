# fhir-lite-api

A small but real Java 21 / Spring Boot 3 reference service exposing a **FHIR-lite** JSON API
(Patient, Observation). It is the reference project for the *AI agents in the SDLC* curriculum.

"FHIR-lite" means the JSON follows FHIR R4 shapes (`resourceType`, `identifier`, `name`,
`code.coding`, `subject.reference`, `valueQuantity`, `Bundle`, `OperationOutcome`) without
depending on HAPI FHIR.

> One defect (`perf-n+1`) is planted on purpose for exercises, and four real defects found by the course agents (D-01..D-04) are left in place. See [docs/KNOWN_DEFECTS.md](docs/KNOWN_DEFECTS.md).

## Layout

```
src/main/java/org/example/fhir
  api/         controllers, wire records (PatientResource, ObservationResource, Bundle) and mappers
  domain/      JPA entities
  repository/  Spring Data repositories
  service/     transactional business logic
  config/      security (HTTP Basic, in-memory users)
  error/       OperationOutcome and the global exception handler
  audit/       AuditLogger (logs ids only, never PII)
src/main/resources/db/migration   Flyway (portable across PostgreSQL and H2 in PostgreSQL mode)
```

## Run

Requires Java 21 and Maven 3.9+.

```bash
# In-memory H2, no database needed
mvn spring-boot:run -Dspring-boot.run.profiles=local

# Tests (H2 in PostgreSQL mode, Flyway applied)
mvn -q test

# With PostgreSQL
docker compose up --build
```

Outside the `local` profile, these environment variables are required: `DB_URL`, `DB_USERNAME`,
`DB_PASSWORD`, `FHIR_CLINICIAN_PASSWORD` and `FHIR_ADMIN_PASSWORD`.

## Users (local profile / tests)

| user | password | roles |
|---|---|---|
| `clinician` | `clinician-pass` | CLINICIAN |
| `admin` | `admin-pass` | ADMIN, CLINICIAN |

Every `/fhir/**` call requires authentication. `DELETE` needs ADMIN.
`/actuator/health/**` is public.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/fhir/Patient/{id}` | |
| GET | `/fhir/Patient?family=&identifier=` | searchset Bundle; at least one param; `identifier` = `value` or `system\|value` |
| POST | `/fhir/Patient` | 201 + `Location` |
| PUT | `/fhir/Patient/{id}` | |
| DELETE | `/fhir/Patient/{id}` | ADMIN only; cascades observations |
| GET | `/fhir/Observation/{id}` | |
| GET | `/fhir/Observation?subject=Patient/{id}&code=` | searchset Bundle |
| POST | `/fhir/Observation` | subject must exist (422 otherwise) |
| GET | `/fhir/Observation/$lastn?subjects=1,2,3&code=` | latest per subject (contains the teaching defect) |

Errors are always an `OperationOutcome`: 400 (bad request or params), 401, 403, 404,
409 (duplicate MRN), 422 (validation or unknown reference).

## curl examples

```bash
BASE=http://localhost:8080

curl -u clinician:clinician-pass -H 'Content-Type: application/json' -X POST $BASE/fhir/Patient -d '{
  "resourceType":"Patient",
  "identifier":[{"system":"urn:oid:1.2.36.146.595.217.0.1","value":"MRN-1001"}],
  "name":[{"family":"Doe","given":["Jane"]}],
  "gender":"female","birthDate":"1985-02-17","active":true}'

curl -u clinician:clinician-pass "$BASE/fhir/Patient/1"
curl -u clinician:clinician-pass "$BASE/fhir/Patient?family=doe"
curl -u clinician:clinician-pass "$BASE/fhir/Patient?identifier=MRN-1001"

curl -u clinician:clinician-pass -H 'Content-Type: application/json' -X POST $BASE/fhir/Observation -d '{
  "resourceType":"Observation","status":"final",
  "code":{"coding":[{"system":"http://loinc.org","code":"8867-4","display":"Heart rate"}]},
  "subject":{"reference":"Patient/1"},
  "effectiveDateTime":"2026-03-01T09:30:00Z",
  "valueQuantity":{"value":72,"unit":"beats/min"}}'

curl -u clinician:clinician-pass "$BASE/fhir/Observation?subject=Patient/1&code=http://loinc.org|8867-4"
curl -u clinician:clinician-pass "$BASE/fhir/Observation/\$lastn?subjects=1,2"

curl -u admin:admin-pass -X DELETE "$BASE/fhir/Patient/1"     # 204
curl -u clinician:clinician-pass -X DELETE "$BASE/fhir/Patient/1"  # 403 OperationOutcome
```

## Audit logging

`AuditLogger` writes to the `AUDIT` logger, for example
`action=READ resource=Patient/42 user=clinician`. It records only resource ids, counts and the staff
username, never names, MRNs, birth dates or observation values. Validation messages
also leave out submitted values.

## Deploy

- `Dockerfile`: a multi-stage build that runs as a non-root user.
- `k8s/deployment.yaml`: readiness and liveness probes on `/actuator/health/{readiness,liveness}`,
  resource requests and limits, and credentials from the `fhir-lite-secrets` Secret.
- `k8s/service.yaml`: a ClusterIP service.

Note: H2 is a runtime dependency so that the `local` profile works with `spring-boot:run`.
Production uses PostgreSQL through `DB_URL`.
