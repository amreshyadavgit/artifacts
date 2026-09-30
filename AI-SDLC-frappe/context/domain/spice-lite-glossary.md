# spice_lite domain glossary

`spice_lite` implements a small FHIR-lite subset over Frappe DocTypes. It is **not** a conformant FHIR server. Agents must use these terms exactly.

| Term | Meaning in this repo |
|---|---|
| SL Patient | DocType for a person receiving care. Fields: `mrn`, `first_name`, `last_name`, `gender` (`male`, `female`, `other`, `unknown`), `birth_date`, `active`, `country`. Document name is a series (`SLP-00001`), never PHI. |
| SL Encounter | A visit: `patient`, `encounter_date`, `encounter_type` (`screening`, `assessment`, `follow-up`), `status` (`planned`, `in-progress`, `finished`), `practitioner`. |
| SL Observation | A measurement: `patient`, `encounter`, `code` (LOINC), `code_display`, `status` (`registered`, `preliminary`, `final`, `amended`), `effective_datetime`, `value`, `unit`, `replaces`. |
| SL Country | The country of a deployment (one deployment per country). |
| MRN | Medical Record Number, unique per patient. Synthetic values only: `MRN-` + 6 digits. |
| LOINC | Observation code system `http://loinc.org`. Test codes: `8867-4` heart rate, `8480-6` systolic BP, `29463-7` body weight, `2339-0` glucose. |
| FHIR-lite resource | JSON with `resourceType`: `Patient`, `Observation`, `Bundle` (`type: searchset`, `total`, `entry[]`), `OperationOutcome` (`issue[]` with `severity`, `code`, `diagnostics`). Frappe wraps whitelisted-method return values in `{"message": ...}`. |
| Country app | A Frappe app installed only in one country's deployment that customises the core through Custom Fields, Property Setters and `doc_events`. |
| Integration app | A Frappe app with `required_apps = ["spice_lite"]` that connects an external system (telephony, ERPNext, a national ID service). |

## Business rules
1. MRN is required and unique; a duplicate MRN fails validation.
2. `birth_date` cannot be in the future.
3. An Observation must reference an existing SL Patient; a `final` Observation needs `value` and `unit`.
4. `final` Observations are immutable. Corrections create a new `amended` Observation with `replaces` set.
5. `Clinician` cannot delete clinical documents. Only `System Manager` can.
6. `search_patients` requires `family` or `identifier`; with neither it returns a 400 `OperationOutcome`. Wildcards (`%`, `_`) in `family` are rejected.

## PHI classification
| Field | PHI? | May appear in logs, Error Log, prompts? |
|---|---|---|
| Document name (`SLP-00001`, `SLO-00001`) | No (opaque series) | Yes |
| `mrn` | **Yes** | No |
| `first_name`, `last_name`, `birth_date`, `gender` | **Yes** | No |
| Search terms (`family`, `identifier`) | **Yes** | No |
| Observation `value`/`unit` linked to a patient | **Yes** | No (log the observation name only) |
| LOINC `code`, `status`, counts | No | Yes |
| `country` | No on its own | Yes |
