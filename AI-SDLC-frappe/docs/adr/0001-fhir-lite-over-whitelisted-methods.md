# ADR-0001: Expose FHIR-lite resources through whitelisted methods instead of a FHIR server app

- Status: accepted
- Date: 2026-09-30
- Deciders: course maintainers

## Context
`spice_lite` exists to teach agent workflows on a Frappe clinical core. Integrations need patient and observation data in FHIR-like shapes. Frappe already gives every DocType a REST endpoint (`/api/resource/<DocType>`), but those return Frappe document JSON, not FHIR shapes, and do not add audit logging.

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| Raw `/api/resource/SL Patient` | Zero code, permission-aware | Frappe JSON shape, no audit trail, exposes every field | Integrations couple to DocType internals |
| Full FHIR server (separate app or HAPI in front) | Conformant | Large, slow to teach, second data model to sync | Learners study FHIR, not agents |
| FHIR-lite whitelisted methods (chosen) | Small, explicit, permission-aware via `frappe.get_list`, one place for audit logging | Not conformant; method names instead of FHIR URLs | Mistaken for real FHIR |

## Decision
FHIR-lite JSON over `spice_lite.api.fhir.*` whitelisted methods, with pure mappers in `api/mappers.py`.

## Consequences
Every doc says "not a conformant FHIR server". `/api/resource/` remains for desk and admin use only. A conformant FHIR facade is a documented extension exercise.

## Verification
`bench --site test.localhost run-tests --app spice_lite` covers the shapes and permission checks; the unit tests pin the mapper output.
