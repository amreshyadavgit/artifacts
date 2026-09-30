---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 02
agent: architect
status: complete
inputs: [01-requirements.md]
next: orchestrator
---
## Summary
The vocabulary belongs in the clinical core, not in a country app: every deployment reports on the same screening codes, and `SL Observation` itself must validate against it. Recommended option: a new master DocType `SL Observation Code` (named by the code, `autoname: field:code`), shipped records as fixtures, `SL Observation.code` changed from `Data` to `Link`, display filled with `fetch_from`, unit and disabled checks in the `SL Observation` controller, and a `[post_model_sync]` patch that backfills the vocabulary from codes already in use. Skill `architecture-review`. ADR draft below (to be filed as `docs/adr/0002-observation-code-vocabulary.md` after gate G1).

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| ARC-1 | medium | design | apps/frappe/frappe/core/doctype/data_import/data_import.py:305 | `import_file_by_path(f, data_import=True, force=True, pre_process=pre_process, reset_permissions=True)` (called by `sync_fixtures` on install and on every `bench migrate`) | Fixture records are re-imported with `force=True` on every migrate, so a country System Manager's edit to a shipped code is reverted at the next release. Ship only core codes in `spice_lite/fixtures/`; country codes go in the country app's own fixtures. The `hooks.py` `fixtures` key only drives `bench export-fixtures`; import reads every file in the folder. |
| ARC-2 | medium | design | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.json:37 | `"fieldname": "code", "fieldtype": "Data"` | `Data` to `Link` needs no DDL (both are `varchar(140)`: `apps/frappe/frappe/database/postgres/database.py:148-149`), but rows whose code is not in the vocabulary would fail link validation on their next save, which breaks the amend flow. Add a `[post_model_sync]` patch that creates a vocabulary entry for every code in use; it runs after the new table exists and before fixtures are synced (`frappe/migrate.py`). |
| ARC-3 | low | design | apps/frappe/frappe/model/base_document.py:824 | `if not _df.get("fetch_if_empty") or (_df.get("fetch_if_empty") and not self.get(_df.fieldname))` | Fill `code_display` with `fetch_from: code.display` plus `fetch_if_empty: 1` instead of controller code: it keeps a client-supplied display and runs inside link validation. |
| ARC-4 | info | performance | sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.py:27 | `def validate(self):` | One `frappe.db.get_value` on the vocabulary per save is acceptable; `lastn` is read-only and unaffected. |

## Decisions
ADR-0002 (proposed): Observation code vocabulary in the clinical core
- Options: (A) core master DocType plus shipped fixtures; (B) `Select` options on `code` (no display or unit, and every new code is a schema change); (C) each country app keeps its own list (no shared validation, reports diverge).
- Decision: A. Shipped codes are owned by `spice_lite`; country apps add codes through their own fixtures.
- Permissions: System Manager maintains the vocabulary; Clinician reads it (needed to pick a code in desk). This `permissions` array is a security-reviewed change.
- Consequence: clients sending unknown codes get 422; release note and a heads-up to integration apps that post Observations.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-30-feat-observation-code-vocabulary/02-architect.md (ADR-0002 draft inline; filed after G1)
