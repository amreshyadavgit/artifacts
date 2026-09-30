# Coding standards (sample-app, Java 21 / Spring Boot 3)

1. **Layers**: `api` (controllers, DTO mappers) → `service` (business rules, transactions) → `repository` (Spring Data) → `domain` (JPA entities). Controllers never call repositories directly.
2. **DTOs at the edge**: controllers accept and return FHIR-lite DTOs, never JPA entities.
3. **Validation**: Bean Validation on DTOs (`@NotBlank`, `@Past`, …) plus business-rule checks in services. Validation failures → `422` with `OperationOutcome` (`code: "invalid"`).
4. **Errors**: throw domain exceptions (`ResourceNotFoundException`, …); the global handler maps them to `OperationOutcome`. No `try/catch` returning ad-hoc JSON in controllers.
5. **Transactions**: `@Transactional(readOnly = true)` on read service methods; writes are transactional at the service layer.
6. **Queries**: derived queries or `@Query` with bound parameters. No string concatenation into JPQL/SQL. Fetch collections with `JOIN FETCH` or batch queries; never query inside a loop over entities.
7. **Logging**: SLF4J, parameterised messages, ids only (see PHI policy). Audit events go through `AuditLogger`.
8. **Naming**: `PatientController`, `PatientService`, `PatientRepository`, `PatientEntity`, `PatientDto`, `PatientMapper`.
9. **Immutability**: prefer Java `record` for DTOs.
10. **Migrations**: Flyway `V<n>__<description>.sql`, never edit an applied migration.
