# Test plan: <change or endpoint, e.g. "GET /fhir/Observation/$lastn">

- Change: <one sentence, or the ADR / ticket id>
- Standards: `context/standards/testing-standards.md`
- Author: test-strategy skill (draft) for <agent or person>
- Date: <YYYY-MM-DD>

## Scope
<What is in scope and what is explicitly out of scope.>

### Change surface (evidence)
| Element | Evidence |
|---|---|
| <controller method / service rule / query / config> | `<path:line>` `<verbatim quote>` |

### Existing coverage
| Test | What it proves |
|---|---|
| `<TestClass#method>` | <behaviour> |

## Risks and defects found while planning
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TS-001 | <critical/high/medium/low/info> | <correctness/testing/security/performance/...> | `<path:line>` | `<quote or observed output>` | <fix or decision, and the test that proves it> |

## Test cases
| id | category | tool | test | scenario | expected | status |
|---|---|---|---|---|---|---|
| TC-01 | <unit/integration/api/negative/edge/performance/security/regression> | <JUnit 5 + Mockito / MockMvc + H2 / Hibernate statistics> | `<TestClass#behaviourName>` | <given / when> | <then: status, body, count> | <existing / new / new-failing> |

## Coverage matrix
| category | cases | note |
|---|---|---|
| unit | <TC ids> | |
| integration | <TC ids> | |
| api | <TC ids> | |
| negative | <TC ids> | |
| edge | <TC ids> | |
| performance | <TC ids> | |
| security | <TC ids> | |
| regression | <TC ids> | |

A category with no case must say `N/A: <reason>` in the cases column.

## Test data
<Which ApiTestSupport helpers, unique family names, synthetic values only.>

## Exit criteria
- <e.g. all existing and new cases pass; new-failing cases fail for the documented reason and are @Disabled with a ticket id>
- `cd sample-app && mvn -q -B test` exits 0.
