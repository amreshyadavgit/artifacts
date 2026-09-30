---
paths:
  - "sample-app/src/**/*.java"
---

# Java rules for sample-app

- Java 21, Spring Boot 3.5, package `org.example.fhir`.
- DTOs are Java records in `api/`; never return JPA entities from controllers.
- Throw `FhirApiException` subclasses or use its factory methods; `GlobalExceptionHandler` turns them into `OperationOutcome`.
- Log through `AuditLogger` for patient access. Log ids only.
- New endpoints need MockMvc tests for success, 4xx, 401, and 403 (see `SecurityTest`).
- No queries inside loops over entities (the one exception is the marked teaching defect).
