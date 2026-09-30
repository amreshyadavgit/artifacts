---
run_id: <YYYY-MM-DD>-<feat|bug>-<ticket-key-lowercase>
step: 00
agent: orchestrator
status: <complete | blocked | needs-human>
inputs: [jira:<TICKET-KEY>]
next: architect
---
## Summary
<one paragraph: what the ticket asks for, in engineering terms, no PHI>

## Requirements
| id | requirement | source |
|---|---|---|
| R1 | <requirement> | <description / comment by role> |

## Acceptance criteria
| id | given / when / then | verifiable by |
|---|---|---|
| AC1 | <given, when, then with request and expected status> | <MockMvc test name or curl + expected status> |

## Constraints
- <constraint and its source>

## Code touch points
- `<path under sample-app/ found with Grep or Glob>`

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
