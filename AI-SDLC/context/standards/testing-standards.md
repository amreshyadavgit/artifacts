# Testing standards

| Layer | Tooling | Required for |
|---|---|---|
| Unit | JUnit 5, AssertJ, Mockito | service business rules, mappers |
| API / integration | `@SpringBootTest` + MockMvc, H2 in PostgreSQL mode | every endpoint: happy path, 4xx paths, auth (401/403) |
| Negative | MockMvc | invalid payloads → 422 OperationOutcome; unknown ids → 404 |
| Security | MockMvc with/without credentials, wrong role | every write endpoint |
| Performance smoke | query-count assertion (Hibernate statistics) | any endpoint returning collections |
| Regression | a test named after the bug id, e.g. `bug42_searchByFamilyIsCaseInsensitive` | every bug fix |

Rules
- Every bug fix starts with a failing test.
- Test names state behaviour: `returns404WhenPatientMissing`.
- No real PHI in fixtures. Synthetic MRNs `MRN-0000xx`.
- `mvn -q -B test` must pass before a handoff is marked `complete`.
