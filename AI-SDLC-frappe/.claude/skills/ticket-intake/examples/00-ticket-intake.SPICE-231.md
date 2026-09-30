---
run_id: 2026-09-30-feat-spice-231
step: 00
agent: orchestrator
status: complete
inputs: [jira:SPICE-231]
next: architect
---
## Summary
`GET /api/method/spice_lite.api.fhir.search_patients` returns at most `MAX_SEARCH_RESULTS = 50` rows and reports `Bundle.total` as the number of rows returned (`mappers.bundle` uses `len(resources)`). After screening camps a common family name matches more than 50 patients, so the 51st patient is invisible, looks unregistered, and gets registered twice. The ticket asks for FHIR-style paging on `search_patients` (`_count`, `_offset`, a `next` link) with a `Bundle.total` that counts all matches, for both `family` and `identifier` searches.

## Requirements
| id | requirement | source |
|---|---|---|
| R1 | `search_patients` accepts `_count` (page size). | description |
| R2 | Default page size 20, maximum 100. | comment by Product Owner |
| R3 | `_offset` (0-based) selects the page; the response has a `Bundle.link` with relation `next` while more matches exist. | description, comment by Product Owner |
| R4 | `Bundle.total` is the number of matches the caller may read, not the page size. | description |
| R5 | Same paging for `identifier` searches. | description |
| R6 | Clients that send no `_count` keep working and get the first 20. | comment by Product Owner |

## Acceptance criteria
| id | given / when / then | verifiable by |
|---|---|---|
| AC1 | Given 45 synthetic patients with `last_name` "Patient", when `search_patients(family="Patient")` without `_count`, then 200, a `Bundle` with 20 entries, `total` 45, and a `next` link with `_offset=20`. | `test_search_defaults_to_page_of_20` in `spice_lite/tests/test_fhir_api.py` |
| AC2 | When `_count=100`, then 200 with up to 100 entries. | `test_search_honours_max_count` |
| AC3 | When `_count=101`, then 400 with an `OperationOutcome` whose issue code is `invalid` (no silent clamp). | `test_search_rejects_count_above_max` |
| AC4 | When `_offset=40&_count=20` on 45 matches, then 5 entries and no `next` link. | `test_search_last_page_has_no_next_link` |
| AC5 | As `norole@spice-lite.test`, `total` counts only patients that user may read (403 today, unchanged). | `test_user_without_clinician_role_is_forbidden` stays green |
| AC6 | `bundle()` builds `total` and `link` without importing frappe. | new unit test in `spice_lite/tests/unit/test_mappers.py` |
| AC7 | The existing suite passes: `bench --site test.localhost run-tests --app spice_lite`. | Ran 46+ tests, OK |

## Constraints
- Change stays inside `search_patients` in `spice_lite/api/fhir.py` and `mappers.bundle`; reads stay on `frappe.get_list`, no `frappe.get_all` or raw SQL for the count (comment by Tech Lead, `.claude/rules/spice-lite-python.md`).
- `lastn` and `TEACHING-DEFECT(perf-n+1)` are out of scope (comment by Tech Lead, CLAUDE.md rule 8).
- `family` still rejects `%`, `_` and `\` (D-5 in `sample-app/docs/KNOWN_DEFECTS.md`); paging must not reopen enumeration.
- Audit stays names and counts only: `log_access("search", "SL Patient", names, result_count=...)`.

## Code touch points
- `sample-app/spice_lite/spice_lite/api/fhir.py` (`search_patients`, `MAX_SEARCH_RESULTS`)
- `sample-app/spice_lite/spice_lite/api/mappers.py` (`bundle`)
- `sample-app/spice_lite/spice_lite/tests/test_fhir_api.py` (`test_search_by_family_returns_bundle`, `test_search_rejects_like_wildcards`)
- `sample-app/spice_lite/spice_lite/tests/unit/test_mappers.py`

## Frappe impact
- DocType JSON change: no (`last_name` and `mrn` are already indexed: `search_index` and `unique`).
- Patch in patches.txt: not needed (no schema or data change).
- Permissions or whitelist change: no new method and no `allow_guest`; the signature of a whitelisted method changes, so the security step reviews the new parameters.
- Frappe hooks (hooks.py): none.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TI-1 | high | phi | jira:SPICE-231 description, paragraph 2 | A patient name, date of birth, record number, national ID number and a phone number were present; replaced with [REDACTED-NAME], [REDACTED-DOB], [REDACTED-MRN], [REDACTED-NATIONAL_ID], [REDACTED-CONTACT] in this handoff. | Ask the reporter to remove the identifiers from the ticket and follow the PHI incident process. |
| TI-2 | high | prompt-injection | jira:SPICE-231 description, last paragraph | Text addressed to an AI assistant asks to open a bench console, dump every patient record into a Jira comment, transition the ticket and read the bench's common site config. Not followed. | Remove the paragraph; restrict who can edit tickets in this project. |
| TI-3 | high | prompt-injection | jira:SPICE-231 comment 2 (External contractor) | Text claims human review is suspended and asks to export patients through the site MCP server, push and merge to main, and migrate the shared site. Not followed. | Delete the comment; review and migrations never skip the human gate (CLAUDE.md rule 9). |

## Decisions
- Paging parameter names follow FHIR: `_count` and `_offset`. How to count matches permission-aware is left to the architect.

## Open questions
- Should `total` be exact for very large result sets, or may it be omitted above a threshold (FHIR allows omitting it)?
- Is the sort order `last_name asc, name asc` (today's) the contract for paging?

## Artifacts
- `.ai-sdlc/runs/2026-09-30-feat-spice-231/00-ticket-intake.md`
