---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 04
agent: developer
status: complete
inputs: [03-implementation-plan.md]
next: tester
---
## Summary
Implemented P1-P8 of the approved plan (diff: `patches/04-developer.patch` in the example folder). Surfaces changed: new DocType JSON and controller (`SL Observation Code`), `SL Observation` JSON (`code` is now a Link, `code_display` fetched) and controller (`validate_code`), fixture file, `hooks.py` `fixtures` key, patch `v0_2.backfill_observation_codes` in `[post_model_sync]`, 7 new tests.

Migrate (G1b prompt accepted; run on the scratch site `f7.localhost`, see the example README):

```text
Migrating f7.localhost
Executing spice_lite.patches.v0_2.backfill_observation_codes in f7.localhost (_250b3ecd2647115d)
Success: Done in 0.103s
Executing `after_migrate` hooks...
```

`bench --site f7.localhost run-tests --app spice_lite`:

```text
Ran 53 tests in 3.304s

OK
```

(46 existing + 7 new; the `Error in query: invalid input syntax for type timestamp` line from the D-2 pinning test is expected.)

## Findings
No findings.

## Decisions
- `validate_code()` raises `frappe.LinkValidationError` with the code only, so `create_observation` already maps it to 422 (`frappe.ValidationError` branch); no change to `spice_lite/api/fhir.py`.
- Unit check applies only to `final`/`amended` Observations and only when the code has a unit, so `preliminary` Observations without a unit keep working (existing `test_final_requires_value_and_unit`).
- Patch test seeds a legacy row with `db_insert()` (no validation), the way pre-v0.2 rows exist on country sites.

## Open questions
None.

## Artifacts
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/__init__.py
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.json
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.py
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/test_sl_observation_code.py (tests `test_shipped_codes_are_installed_from_fixtures`, `test_unknown_code_rejected`, `test_display_fetched_when_empty`, `test_final_unit_must_match_code_unit`, `test_disabled_code_rejected_for_new_observations`, `test_backfill_creates_codes_for_legacy_rows`)
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.json
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.py
- sample-app/spice_lite/spice_lite/fixtures/sl_observation_code.json
- sample-app/spice_lite/spice_lite/hooks.py
- sample-app/spice_lite/spice_lite/patches.txt
- sample-app/spice_lite/spice_lite/patches/v0_2/__init__.py
- sample-app/spice_lite/spice_lite/patches/v0_2/backfill_observation_codes.py
- sample-app/spice_lite/spice_lite/tests/test_fhir_api.py (test `test_create_observation_unknown_code_is_422`)
