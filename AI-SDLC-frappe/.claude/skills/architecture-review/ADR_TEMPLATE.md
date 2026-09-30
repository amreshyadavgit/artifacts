# ADR-NNNN: <Title in imperative form, e.g. "Add the national health ID through an integration app">

- Status: proposed
- Date: <YYYY-MM-DD>
- Deciders: <roles, e.g. "tech lead, architect agent (draft)">
- Agent run: `.ai-sdlc/runs/<run-id>/` (omit the line if not drafted inside a workflow run)

## Context
<Two to four sentences: the requirement, which country deployments it affects, and why it matters now.>

### Requirement
- Functional: <what the whitelisted method or DocType must do, with one example request>
- Non-functional: <limits, latency, PHI, permissions, Postgres 16 and MariaDB, which sites and apps>
- Acceptance criteria: <numbered, each testable with FrappeTestCase, unittest or a query counter>
- Assumptions and open questions: <each marked "assumption" or "open">

### Current architecture (evidence)
| Fact | Evidence |
|---|---|
| <what the code or Frappe does today> | `<path:line>` `<verbatim quote>` |

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| A. <core change / country app / integration app / extension point / sync / enqueue> | <pros> | <cons> | <main risk> |
| B. <name> | <pros> | <cons> | <main risk> |

## Decision
<The chosen option; the concrete contract (parameters, fields with `unique`/`search_index`/`reqd`, `hooks.py` keys, queue, timeout, job_id, error codes); which apps and files change; which sites install what; and why this option beats the others against the forces above.>

## Consequences
- Positive: <...>
- Negative: <...>
- Follow-up work: <ticket id + one line each>

### Risks
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| AR-001 | <severity> | <category> | `<path:line>` | `<quote>` | <mitigation> |

## Verification
- Tests: <TestClass#test_method, one per acceptance criterion>
- Metrics or checks: <query count, queue backlog, review check>
- Review: <which agent or human checks what>
