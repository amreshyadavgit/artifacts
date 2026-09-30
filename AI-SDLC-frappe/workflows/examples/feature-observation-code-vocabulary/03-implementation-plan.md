---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 03
agent: orchestrator
status: needs-human
inputs: [01-requirements.md, 02-architect.md]
next: developer
---
## Summary
Eight steps, one Frappe surface each, verified by `bench --site test.localhost run-tests --app spice_lite` after a migrate. Produced with the `implementation-plan` skill from AC-1..AC-7 and ARC-1..ARC-4.

Security scope: YES (rule 1: new `permissions` array; rule 3: `hooks.py` gains a `fixtures` key; rule 4: the patch uses `ignore_permissions`). The security step will run after the developer.

| step | file | change | verifies |
|---|---|---|---|
| P1 | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.json (new) | DocType `SL Observation Code`, module Clinical, `autoname: field:code`; fields `code` (Data, reqd, unique), `display` (Data, reqd), `unit` (Data), `disabled` (Check); permissions: System Manager full, **Clinician read only** | AC-5, ADR-0002 |
| P2 | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.py (new) | `SLObservationCode.validate`: strip `code`, reject whitespace, normalise empty `unit` to None | AC-1 |
| P3 | sample-app/spice_lite/spice_lite/fixtures/sl_observation_code.json (new) and sample-app/spice_lite/spice_lite/hooks.py | six shipped codes; `fixtures = [{"dt": "SL Observation Code"}]` so `bench export-fixtures` reproduces the file | AC-1, ARC-1 |
| P4 | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.json | `code` becomes `Link` to `SL Observation Code`; `code_display` gets `fetch_from: code.display`, `fetch_if_empty: 1` | AC-2, AC-3, ARC-2, ARC-3 |
| P5 | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.py | `validate_code()` after `validate_patient()`: unknown code raises `LinkValidationError`; disabled code rejected for new docs; final/amended unit must equal the code's unit | AC-3, AC-4, AC-7 |
| P6 | sample-app/spice_lite/spice_lite/patches/v0_2/backfill_observation_codes.py (new) and `patches.txt` `[post_model_sync]` | create a vocabulary entry for every distinct code in use; idempotent | AC-6, ARC-2 |
| P7 | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/test_sl_observation_code.py (new), sample-app/spice_lite/spice_lite/tests/test_fhir_api.py | FrappeTestCase tests for AC-1..AC-4, AC-7 and the patch (tester adds permission and idempotency cases) | AC-1..AC-7 |
| P8 | verification | `bench --site test.localhost migrate` (G1b prompt), then `bench --site test.localhost run-tests --app spice_lite`: 46 existing tests plus the new ones, `OK` | all |

Rollback: revert the commit. The `tabSL Observation Code` table and its rows stay on migrated sites (harmless); `code` becomes `Data` again at the next migrate. The patch is recorded in Patch Log and will not re-run.

## Findings
No findings.

## Decisions
- No `[pre_model_sync]` patch: the column type does not change (ARC-2).
- Existing test data uses only 8480-6 and 8867-4, both shipped, so no existing test changes.

## Open questions
- G1: approve this plan before the developer starts. Approval = accepting the `Agent(developer)` permission prompt (ask rule from `workflows/gates.settings.json`). The developer will then ask to run `bench --site test.localhost migrate` (G1b).
- Confirm the behaviour change (unknown codes now 422) with the integration-app owners (release note owner).

## Artifacts
- .ai-sdlc/runs/2026-09-30-feat-observation-code-vocabulary/03-implementation-plan.md
