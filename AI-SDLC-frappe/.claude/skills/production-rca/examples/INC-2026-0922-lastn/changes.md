# Change calendar excerpt, 2026-09-22 (UTC)

| Change | Window (UTC) | System | Description | Owner |
|---|---|---|---|---|
| CHG-5102 | 2026-09-22T05:10:00Z to 2026-09-22T06:41:00Z | spice-ke site | Historical import for Clinic KE-C-017 onboarding: 100 patients, 42,300 SL Observations (average 423 per patient, maximum 1,904; almost all `8867-4` heart-rate readings from the previous system's bedside monitors), run as `spice_ke.onboarding.import_clinic_history` on the `long` queue | Country data team |
| CHG-5104 | 2026-09-22T07:40:00Z | spice-ke bench | `spice_telephony` 1.7.3 to 1.8.0 (SMS reminder template wording only), `bench --site ke.spice.example migrate`, web restart at 07:41 | Telephony integration team |
| CHG-5103 | 2026-09-22T08:00:00Z | Clinic KE-C-017 ward board (`c017-ward-board/1.0.0`, vendor tablet app) | Go-live on 20 ward tablets. Each tablet refreshes a "latest heart rate" panel for the whole ward census every 30 s with `GET /api/method/spice_lite.api.fhir.lastn?subjects=<100 patient names>&code=8867-4`, authenticated with one integration user's API token | Clinic KE-C-017 IT |

Notes from the onboarding ticket:
- The ward board was load-tested on the staging site with 5 patients and 2 observations each.
- The vendor guide says the tablet sends "all patients on the ward, up to the API maximum" in one call. The API maximum is 100.
