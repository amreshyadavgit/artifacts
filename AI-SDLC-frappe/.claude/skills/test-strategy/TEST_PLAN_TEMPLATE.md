# Test plan: <change, whitelisted method or DocType, e.g. "spice_lite.api.fhir.lastn">

- Change: <one sentence, or the ADR / ticket id>
- Standards: `context/standards/testing-standards.md`
- Author: test-strategy skill (draft) for <agent or person>
- Date: <YYYY-MM-DD>

## Scope
<What is in scope and what is explicitly out of scope.>

### Change surface (evidence)
| Element | Evidence |
|---|---|
| <decorator / parameter / permission check / query / controller rule / DocType field / patch> | `<path:line>` `<verbatim quote>` |

### Existing coverage
| Test | What it proves |
|---|---|
| `<TestClass#test_method>` | <behaviour> |

## Risks and defects found while planning
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TS-001 | <critical/high/medium/low/info> | <correctness/testing/security/performance/...> | `<path:line>` | `<quote or observed output>` | <fix or decision, ticket, and the test that proves it> |

## Test cases
| id | category | tool | test | scenario | expected | status |
|---|---|---|---|---|---|---|
| TC-01 | <unit/integration/api/negative/edge/performance/security/regression> | <unittest / FrappeTestCase / FrappeTestCase + call() / query counter / frappe.set_user / unittest.mock> | `<TestClass#test_behaviour>` | <given / when> | <then: status, body field, count> | <existing / new / new-failing> |

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
<Which tests/utils.py helpers, which test users, unique values; synthetic only.>

## Exit criteria
- <e.g. existing and new cases pass; new-failing cases fail for the documented reason and ship with @unittest.skip("<ticket>: ...")>
- `bench --site test.localhost run-tests --app spice_lite` passes (run from the bench directory).
