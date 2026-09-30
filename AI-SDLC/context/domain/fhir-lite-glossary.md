# FHIR-lite domain glossary

The sample app (`sample-app/`) implements a deliberately small subset of HL7 FHIR R4 shapes. It is **not** a conformant FHIR server. Agents must use these terms exactly.

| Term | Meaning in this repo |
|---|---|
| Resource | A JSON document with a `resourceType` field. Only `Patient`, `Observation`, `Bundle`, `OperationOutcome` exist. |
| Patient | A person receiving care. Fields: `id`, `identifier[]` (MRN, system `urn:example:mrn`), `name[]` (`family`, `given[]`), `gender` (`male`, `female`, `other`, `unknown`), `birthDate` (ISO date), `active` (boolean). |
| MRN | Medical Record Number. Unique per patient. Synthetic values only, format `MRN-` + 6 digits. |
| Observation | A measurement about a patient. Fields: `id`, `status` (`registered`, `preliminary`, `final`, `amended`), `code` (LOINC `system`, `code`, `display`), `subject.reference` (`Patient/{id}`), `effectiveDateTime`, `valueQuantity` (`value`, `unit`). |
| LOINC | Code system for observations, `http://loinc.org`. Common codes used in tests: `8867-4` heart rate, `8480-6` systolic BP, `29463-7` body weight. |
| Bundle | Search result wrapper: `{ "resourceType": "Bundle", "type": "searchset", "total": n, "entry": [{ "resource": {...} }] }`. |
| OperationOutcome | Error body: `{ "resourceType": "OperationOutcome", "issue": [{ "severity", "code", "diagnostics" }] }`. Returned for every 4xx/5xx. |
| Subject reference | The string `Patient/{id}`. Observations must reference an existing Patient. |

## Business rules

1. A Patient must have exactly one MRN identifier; MRN is unique (409/422 on duplicate).
2. `birthDate` cannot be in the future.
3. An Observation's `subject` must resolve to an existing, `active` Patient.
4. `status = final` Observations are immutable; corrections create an `amended` Observation.
5. Delete is ADMIN-only and is a soft concern in real systems; here it is a hard delete used only in tests.
6. Search results are always a `Bundle`, even when empty (`total: 0`).

## PHI classification

| Field | PHI? | May appear in logs? |
|---|---|---|
| Patient `id` (surrogate key) | No (opaque) | Yes |
| MRN | **Yes** | No |
| name, birthDate, gender | **Yes** | No |
| Observation values linked to a patient | **Yes** | No (log observation id only) |
| LOINC code | No | Yes |
