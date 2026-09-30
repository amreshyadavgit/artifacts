# API standards (FHIR-lite)

- Base path `/fhir`. Resource paths are `/{ResourceType}` and `/{ResourceType}/{id}`.
- Content type `application/json` (real FHIR uses `application/fhir+json`; noted, not enforced).
- Create: `POST` → `201 Created` with `Location: /fhir/{Type}/{id}` and the created resource.
- Update: `PUT /{Type}/{id}` → `200`. Body `id` must match path id, else `400`.
- Search: `GET /{Type}?param=value` → `200` with a `Bundle` (`type: searchset`).
- Errors: always `OperationOutcome`. `400` malformed, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict, `422` validation.
- Search parameters are case-insensitive for names; identifiers are exact match.
- Pagination (planned): `_count` (default 20, max 100).
- Operations use the `$` prefix, e.g. `/fhir/Observation/$lastn`.
