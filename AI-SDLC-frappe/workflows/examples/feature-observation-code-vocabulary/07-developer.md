---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 07
agent: developer
status: complete
inputs: [05-tester.md, 06-security.md]
next: reviewer
---
## Summary
Rework after gate G2 (human decision: fix TST-1 and SEC-1/TST-2 now). Diff: `patches/07-developer.patch`. The patch skips codes that already exist, and the Clinician DocPerm row of `SL Observation Code` is read-only. The DocType JSON changed, so migrate ran again (G1b prompt accepted); it re-imported `SL Observation Code` and did not re-run the recorded patch.

`bench --site f7.localhost run-tests --app spice_lite`:

```text
Ran 56 tests in 4.361s

OK
```

## Findings
No findings.

## Decisions
- No new test: the tester's `test_backfill_is_idempotent_when_codes_exist` and `test_clinician_can_read_but_not_maintain_codes` now pass and pin both fixes.
- Kept one `frappe.db.get_value` per distinct code in the patch: it runs once per site and the number of distinct codes is small.

## Open questions
None.

## Artifacts
- sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation_code/sl_observation_code.json
- sample-app/spice_lite/spice_lite/patches/v0_2/backfill_observation_codes.py
