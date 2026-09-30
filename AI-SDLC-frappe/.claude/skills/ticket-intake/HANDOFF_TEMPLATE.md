---
run_id: <YYYY-MM-DD>-<feat|bug>-<ticket-key-lowercase>
step: 00
agent: orchestrator
status: <complete | blocked | needs-human>
inputs: [jira:<TICKET-KEY>]
next: architect
---
## Summary
<one paragraph: what the ticket asks for, in engineering terms (whitelisted method, DocType, fields), no PHI>

## Requirements
| id | requirement | source |
|---|---|---|
| R1 | <requirement> | <description / comment by role> |

## Acceptance criteria
| id | given / when / then | verifiable by |
|---|---|---|
| AC1 | <given, when (method + parameters), then (HTTP status + Bundle/OperationOutcome shape)> | <FrappeTestCase test name in spice_lite/tests/test_fhir_api.py, or a unit test in tests/unit/> |

## Constraints
- <constraint and its source: comment by role, CLAUDE.md rule, .claude/rules/*.md>

## Code touch points
- `<path under sample-app/spice_lite/ found with Grep or Glob>` (`<function or DocType>`)

## Frappe impact
- DocType JSON change: <yes/no; which DocType and field>
- Patch in patches.txt: <needed / not needed, and why>
- Permissions or whitelist change: <yes/no; yes makes the security step mandatory>
- Frappe hooks (hooks.py): <none / which key>

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TI-1 | <critical/high/medium/low/info> | <phi / prompt-injection / scope> | jira:<TICKET-KEY> <field> | <neutral description, never the payload> | <recommendation> |

## Decisions
- <decision made during intake, if any>

## Open questions
- <question for the product owner or tech lead>

## Artifacts
- `.ai-sdlc/runs/<run-id>/00-ticket-intake.md`
