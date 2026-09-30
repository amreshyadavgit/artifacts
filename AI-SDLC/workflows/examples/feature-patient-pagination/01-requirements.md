---
run_id: 2026-09-30-feat-patient-pagination
step: 01
agent: orchestrator
status: complete
inputs: [ticket:PAT-142]
next: architect
---
## Summary
PAT-142 asks for paging on `GET /fhir/Patient` search. Today `PatientController.search` returns every match in one `Bundle` (`Bundle.searchset(List)` sets `total` to the list size), and `context/architecture/overview.md` lists "No pagination yet on searches (risk: unbounded results)". `context/standards/api-standards.md` already reserves `_count` (default 20, max 100). Produced with the `requirements` skill.

### User story
As a clinical client developer, I want Patient search results in pages of a size I choose, so that a common family name does not return thousands of PHI records in one response.

### Acceptance criteria
| id | Given | When | Then |
|---|---|---|---|
| AC-1 | 25 patients with family `Paging` | `GET /fhir/Patient?family=paging` | 200, `Bundle.entry` has 20 items, `Bundle.total` is 25 |
| AC-2 | the same data | `GET /fhir/Patient?family=paging&_count=10&_offset=20` | 200, 5 entries, `total` 25, no `next` link |
| AC-3 | the same data | `GET /fhir/Patient?family=paging&_count=10` | `Bundle.link` has `self` and `next`; `next` URL carries `_offset=10&_count=10` |
| AC-4 | any data | `_count=0`, `_count=101`, `_count=abc` or `_offset=-1` | 400 `OperationOutcome`, `issue[0].code` `invalid` |
| AC-5 | a patient with MRN `MRN-000123` | `GET /fhir/Patient?identifier=MRN-000123&_count=5` | 200, 1 entry, `total` 1 (identifier search still exact, paging ignored beyond one page) |
| AC-6 | no credentials | any paged search | 401 `OperationOutcome` (unchanged filter chain) |

### Non-functional
- PHI: `AuditLogger.recordSearch` keeps logging counts only; paging parameters may be logged, names may not.
- Performance: one `SELECT ... LIMIT/OFFSET` plus one `COUNT` per request; no per-row queries.
- Compatibility: existing clients that send no `_count` get the first 20 results instead of all results. This is a behaviour change and needs a release note.

## Findings
No findings.

## Decisions
- `_count` default 20, max 100, as already stated in `context/standards/api-standards.md`.
- Offset-based paging (`_offset`) is in scope; cursor tokens are out of scope for PAT-142.
- Observation search paging is out of scope (follow-up ticket PAT-143).

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-30-feat-patient-pagination/01-requirements.md
