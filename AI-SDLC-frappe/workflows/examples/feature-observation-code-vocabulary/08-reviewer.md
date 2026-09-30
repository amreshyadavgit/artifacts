---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 08
agent: reviewer
status: complete
inputs: [03-implementation-plan.md, 05-tester.md, 06-security.md, 07-developer.md]
next: human
---
## Summary
Reviewed `git diff main...HEAD` (12 files: Python, DocType JSON, `patches.txt`, `hooks.py` and the fixture together) with the `code-review` skill against the plan and `context/standards/`. TST-1 and SEC-1/TST-2 are resolved (verified by `test_backfill_is_idempotent_when_codes_exist` and `test_clinician_can_read_but_not_maintain_codes`, 56 tests OK in 07-developer.md). Schema change ships with a patch in `[post_model_sync]`; the `permissions` array was security-reviewed (06). Verdict: APPROVE (no critical or high findings; not a merge approval).

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-1 | low | standards | sample-app/spice_lite/spice_lite/hooks.py:28 | `fixtures = [{"dt": "SL Observation Code"}]` | `bench export-fixtures` exports every code on the site it runs on. Run it only on a clean development site, or add `"filters": [["name", "in", [...]]]` with the six shipped codes, so a country's local codes never leak into the core fixture. |
| CR-2 | low | performance | sample-app/spice_lite/spice_lite/patches/v0_2/backfill_observation_codes.py:20 | `display = frappe.db.get_value("SL Observation", {"code": code}, "code_display") or code` inside the loop | One query per distinct code. Acceptable for a one-off patch (coding standard 5 targets request paths); a single `frappe.get_all(..., fields=["code", "code_display"], group_by="code")` would remove it. Optional. |
| CR-3 | info | docs | sample-app/README.md | the data model table in section 4 lists four DocTypes | Add `SL Observation Code` (named by code, shipped as fixtures) and the 422 on unknown codes to the API table in the same PR. |

Checked and clean: correctness (Link plus `fetch_from`/`fetch_if_empty`, controller order `validate_immutable` first), design (vocabulary in core, country codes via country app fixtures per ADR-0002), testing (10 new tests, AC-1..AC-7 mapped in 05-tester.md), Frappe standards (patch idempotent, `ignore_permissions` commented, no `get_all` in a request path, tabs, `SL ` prefix; naming by LOINC code is fine because a code is not PHI).

## Decisions
- Verdict: APPROVE with three non-blocking findings (CR-1, CR-2, CR-3). `APPROVE` means no blocking findings from this review; only a human approves the PR.

## Open questions
None.

## Artifacts
- none (read-only review)
