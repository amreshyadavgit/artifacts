# ADR-NNNN: <Title in imperative form, e.g. "Paginate Patient search">

- Status: proposed
- Date: <YYYY-MM-DD>
- Deciders: <roles, e.g. "tech lead, architect agent (draft)">
- Agent run: `.ai-sdlc/runs/<run-id>/` (omit the line if not drafted inside a workflow run)

## Context
<Two to four sentences: the requirement and why it matters now.>

### Requirement
- Functional: <what the API must do, with one example request>
- Non-functional: <limits, performance, PHI, security, PostgreSQL/H2 portability>
- Acceptance criteria: <numbered, each testable with MockMvc>
- Assumptions and open questions: <each marked "assumption" or "open">

### Current architecture (evidence)
| Fact | Evidence |
|---|---|
| <what the code does today> | `<path:line>` `<verbatim quote>` |

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| A. <name> | <pros> | <cons> | <main risk> |
| B. <name> | <pros> | <cons> | <main risk> |

## Decision
<The chosen option, the concrete contract (parameters, defaults, limits, error codes), which classes change, and why this option beats the others against the forces above.>

## Consequences
- Positive: <...>
- Negative: <...>
- Follow-up work: <ticket id + one line each>

### Risks
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| AR-001 | <severity> | <category> | `<path:line>` | `<quote>` | <mitigation> |

## Verification
- Tests: <TestClass#methodName, one per acceptance criterion>
- Metrics or checks: <query count, latency, review check>
- Review: <which agent or human checks what>
