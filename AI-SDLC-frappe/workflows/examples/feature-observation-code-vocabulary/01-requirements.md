---
run_id: 2026-09-30-feat-observation-code-vocabulary
step: 01
agent: orchestrator
status: complete
inputs: [ticket:OBS-51]
next: architect
---
## Summary
OBS-51 asks for a controlled vocabulary for Observation codes. Today `SL Observation.code` is a free `Data` field (`sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.json:37`), so `create_observation` accepts any string as a LOINC code, `code_display` is whatever the client sends, and a final systolic blood pressure can be stored in any unit. Screening programmes in every country deployment report on a small, fixed code set (blood pressure, heart rate, glucose, weight, height). Produced with the `requirements` skill.

### User story
As a programme lead for a country deployment, I want Observations to use only codes from a maintained vocabulary with a fixed display and unit, so that screening reports do not silently drop or mis-convert measurements.

### Acceptance criteria
| id | Given | When | Then |
|---|---|---|---|
| AC-1 | a site after `bench migrate` | a System Manager lists the vocabulary | the six shipped LOINC codes exist with display and UCUM unit: 8480-6 mm[Hg], 8462-4 mm[Hg], 8867-4 /min, 2339-0 mg/dL, 29463-7 kg, 8302-2 cm |
| AC-2 | a Clinician | `call(fhir.create_observation, patient=<SLP>, code="8867-4", value=64, unit="/min")` with no `code_display` | 201, `code.coding[0].display` is `Heart rate` |
| AC-3 | a Clinician | `create_observation` with `code="0000-0"` | 422 `OperationOutcome`, `issue[0].code` `invalid`; nothing inserted |
| AC-4 | a Clinician | a `final` Observation with code 8480-6 and unit `kPa` | rejected with a `ValidationError` (422 through the API); a `preliminary` Observation without unit is still accepted (unchanged rule) |
| AC-5 | users `clinician@spice-lite.test` and `norole@spice-lite.test` | they check permissions on the vocabulary | Clinician can read but not create, write or delete; the user without a role cannot read; only System Manager maintains codes |
| AC-6 | an existing site with Observations whose code is not in the vocabulary | `bench migrate` runs, and runs again | every code in use gets a vocabulary entry, those Observations stay saveable (amend flow), and a second run changes nothing |
| AC-7 | a code marked disabled | a new Observation uses it | rejected; existing Observations with that code are unchanged |

### Non-functional
- PHI: LOINC codes, displays and units are not PHI (`context/domain/spice-lite-glossary.md`). Error messages may name the code and unit, never the value or the patient.
- Performance: at most one extra query per Observation save; no change to `lastn` (its `TEACHING-DEFECT(perf-n+1)` stays, CLAUDE.md rule 8).
- Migration: existing sites need a data patch in `patches.txt`; it must be idempotent (`context/standards/frappe-coding-standards.md` rule 6).
- Compatibility: clients that send unknown codes now get 422 instead of 201. Release note required; country apps that use extra codes must ship them.

## Findings
No findings.

## Decisions
- Scope: the six codes above ship with `spice_lite`. Country-specific codes are out of scope (follow-up OBS-52, country app fixtures).
- FHIR `valueQuantity` unit conversion is out of scope: a wrong unit is rejected, not converted.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-30-feat-observation-code-vocabulary/01-requirements.md
