# API standards (FHIR-lite over Frappe)

- Endpoints are whitelisted methods under `/api/method/spice_lite.api.fhir.<name>`. Frappe wraps the return value as `{"message": <resource>}`.
- Auth: session cookie (desk) or `Authorization: token <api_key>:<api_secret>` for integration users. Guests are never allowed.
- Methods: reads are `methods=["GET"]`, writes are `methods=["POST"]`.
- Success returns a FHIR-lite resource (`Patient`, `Observation`) or a `Bundle` (`type: "searchset"`, `total`, `entry[].resource`).
- Errors set `frappe.local.response.http_status_code` and return an `OperationOutcome`: `400` bad or missing parameters, `403` permission denied, `404` unknown document, `409` conflict, `422` validation.
- Search parameters: `family` matches `last_name` case-insensitively without wildcards; `identifier` is an exact MRN match.
- Operations use a plain name (`lastn`) instead of FHIR's `$lastn`, because method names are Python identifiers. `lastn` accepts at most 100 subjects.
- `/api/resource/<DocType>` exists for desk and admin use; integrations must use the FHIR-lite methods so permissions and audit logging apply uniformly.
