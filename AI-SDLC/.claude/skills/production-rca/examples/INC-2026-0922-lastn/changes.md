# Change calendar excerpt, 2026-09-22 (UTC)

| Change | Window | System | Description | Owner |
|---|---|---|---|---|
| CHG-4471 | 2026-09-22T06:30:00Z to 2026-09-22T07:41:00Z | clinical data platform | Historical import for Clinic C-017 onboarding: 512 patients, 208,896 observations (average 408 per patient, up to 1,950) loaded into the `observation` table through the batch importer | Data onboarding team |
| CHG-4472 | 2026-09-22T08:00:00Z | Clinic C-017 ward dashboard (`c017-ward-dashboard/2.3.0`, vendor client) | Go-live on 24 ward workstations. Each workstation refreshes a "latest heart rate" panel for the whole clinic census every 30 s using `GET /fhir/Observation/$lastn?subjects=<all 512 patient ids>&code=http://loinc.org\|8867-4`, authenticated as the shared `clinician` account | Clinic C-017 IT |
| none | | fhir-lite-api | No deployment, config change or secret rotation | Platform team |

Notes from the onboarding ticket:
- Load testing for CHG-4472 was done against staging with 20 test patients and 2 observations each.
- The vendor's integration guide says the client batches "all patients in the unit" into one `$lastn` call.
