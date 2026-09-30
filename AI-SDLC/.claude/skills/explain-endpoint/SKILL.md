---
name: explain-endpoint
description: Explain one sample-app HTTP endpoint end to end (security rule, controller, mapper, service, repository, SQL, error paths, audit logging, covering tests) with file:line citations. Read-only.
when_to_use: When someone asks how an endpoint works, what SQL it runs, who may call it, what errors it returns, or where to change it, for any /fhir/Patient or /fhir/Observation route.
argument-hint: "<METHOD> <path>, e.g. GET /fhir/Patient/{id}"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(grep *)
---

# Explain a sample-app endpoint

Endpoint to explain: **$ARGUMENTS**

If no endpoint was given, list the routes below and ask which one to explain. Do not guess.

Current route map (generated from the controllers when this skill was invoked):

!`grep -rnE "@(Get|Post|Put|Delete|Request)Mapping" sample-app/src/main/java/org/example/fhir/api`

A class-level `@RequestMapping` is the path prefix for every method mapping in the same file. Match the requested method and path against this map. If nothing matches, say so and show the closest routes.

## Procedure

Read [reference.md](reference.md) first: it says where each concern lives in this repository and how Spring Data method names become SQL. Then trace the request in this order, reading each file rather than assuming:

1. **Security**: the matching `requestMatchers` rule in `SecurityConfig.securityFilterChain` (roles required, what an anonymous or wrong-role caller receives).
2. **Controller**: the handler method, its parameters (`@PathVariable`, `@RequestParam`, `@Valid @RequestBody`) and any parsing it does itself.
3. **Mapper**: the `PatientMapper` / `ObservationMapper` calls that convert between the DTO record and the JPA entity.
4. **Service**: the method called, its `@Transactional` setting, business-rule checks and every `FhirApiException` it can throw.
5. **Repository**: each repository method used and the SQL it produces (derived query rules in reference.md; tables and indexes from `sample-app/src/main/resources/db/migration/V1__init.sql`). Count the statements per request; say whether the count depends on input size.
6. **Errors**: each HTTP status the endpoint can return, and the exact line that produces it (service exception, Bean Validation via `GlobalExceptionHandler`, or the security entry point).
7. **Audit and PHI**: which `AuditLogger` call records the access, and confirm that no PHI field (see `context/domain/fhir-lite-glossary.md`) reaches a log line or an `OperationOutcome` diagnostic.
8. **Tests**: the test methods in `sample-app/src/test/java/org/example/fhir/` that call this endpoint, and which of success, 4xx, 401 and 403 are not covered.

## Output format

```markdown
## <METHOD> <path>
One-paragraph summary: what it does and for whom.

### Request flow
| Step | Layer | Location (path:line) | What happens |
|---|---|---|---|

### SQL
Numbered list of statements with the table and index each one uses, and the statement count per request.

### Responses
| Status | When | Produced at (path:line) |
|---|---|---|

### Audit and PHI
### Test coverage
### Notes and risks
```

Rules:
- Every row cites a real `path:line` you read in this session.
- Quote code only as short fragments; never paste whole files.
- Mention a marked `TEACHING-DEFECT` if the path runs through one, but do not propose a fix unless asked.
- Do not edit files. Do not run the application or the tests.
