---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 05
agent: tester
status: blocked
inputs: [01-requirements.md, 03-implementation-plan.md, 04-developer.md]
next: developer
---
## Summary
Test strategy (skill `test-strategy`) maps AC-1..AC-7 to FrappeTestCase tests. The developer's tests cover AC-1..AC-4 and AC-7 and the happy path of the patch. Added 3 tests (diff: `patches/05-tester.patch`): the API path of AC-2, the permission matrix of AC-5 (testing standard: a permission test for every DocType permission change), and patch idempotency for AC-6 (coding standard 6). Two fail. `bench --site f7.localhost run-tests --app spice_lite`:

```text
ERROR: test_backfill_is_idempotent_when_codes_exist (spice_lite.clinical.doctype.sl_observation_code.test_sl_observation_code.TestBackfillObservationCodes.test_backfill_is_idempotent_when_codes_exist)
  File ".../clinical/doctype/sl_observation_code/test_sl_observation_code.py", line 86, in test_backfill_is_idempotent_when_codes_exist
  File ".../patches/v0_2/backfill_observation_codes.py", line 19, in execute
psycopg2.errors.UniqueViolation: duplicate key value violates unique constraint "tabSL Observation Code_pkey"
DETAIL:  Key (name)=(8480-6) already exists.
frappe.exceptions.DuplicateEntryError: ('SL Observation Code', '8480-6', UniqueViolation(...))

FAIL: test_clinician_can_read_but_not_maintain_codes (spice_lite.clinical.doctype.sl_observation_code.test_sl_observation_code.TestSLObservationCode.test_clinician_can_read_but_not_maintain_codes)
  File ".../clinical/doctype/sl_observation_code/test_sl_observation_code.py", line 51, in test_clinician_can_read_but_not_maintain_codes
    self.assertFalse(frappe.has_permission("SL Observation Code", "create"))
AssertionError: True is not false

Ran 56 tests in 4.418s

FAILED (failures=1, errors=1)
```

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TST-1 | high | correctness | sample-app/spice_lite/spice_lite/patches/v0_2/backfill_observation_codes.py:19 | `frappe.get_doc({"doctype": "SL Observation Code", "code": code, "display": display}).insert(` runs for every distinct code, including 8480-6, which the shipped fixture already created: `DuplicateEntryError` on the first call | Skip codes that already exist (`frappe.db.exists("SL Observation Code", code)`). On an upgrade the first migrate only works because patches run before `sync_fixtures`; `bench --site <site> run-patch --force`, a code a System Manager already created, or any reordering aborts `bench migrate` for the whole country site. |
| TST-2 | high | testing | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.json:67 | the Clinician DocPerm row has `"create": 1` and `"write": 1` (lines 68 and 73); `test_clinician_can_read_but_not_maintain_codes` fails | Reduce the Clinician row to `read` only, as P1 and AC-5 require. Same root cause as any security finding on this array. |
| TST-3 | info | testing | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/test_sl_observation_code.py:84 | `frappe.db.savepoint("sl_backfill")` | The idempotency test rolls back to a savepoint on error because Postgres aborts the transaction after a unique violation (same pattern as the D-2 test). Keep it. |

## Decisions
- Coverage map: AC-1 `test_shipped_codes_are_installed_from_fixtures`; AC-2 `test_display_fetched_when_empty`, `test_create_observation_fills_display_from_code`; AC-3 `test_unknown_code_rejected`, `test_create_observation_unknown_code_is_422`; AC-4 `test_final_unit_must_match_code_unit`, existing `test_final_requires_value_and_unit`; AC-5 `test_clinician_can_read_but_not_maintain_codes`; AC-6 `test_backfill_creates_codes_for_legacy_rows`, `test_backfill_is_idempotent_when_codes_exist`; AC-7 `test_disabled_code_rejected_for_new_observations`.
- The user without a role (AC-5, second half) is covered by Frappe's own DocPerm check: no DocPerm row exists for a user without roles; no extra test added.

## Open questions
- TST-1 and TST-2 block the run: the developer must fix the patch and the Clinician DocPerm row before code review.

## Artifacts
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/test_sl_observation_code.py (tests `test_create_observation_fills_display_from_code`, `test_clinician_can_read_but_not_maintain_codes`, `test_backfill_is_idempotent_when_codes_exist`)
