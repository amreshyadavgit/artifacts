# ADR-0002: Add the national health ID through an integration app with a core identifier extension point

- Status: proposed
- Date: 2026-09-30
- Deciders: tech lead (approver), architect agent (draft)
- Agent run: `.ai-sdlc/runs/2026-09-30-feat-national-health-id/`

## Context
The Kenya deployment must record each patient's national health ID (NHID), find patients by it, return it in the Patient resource, and verify it against the national client registry, an external HTTP API that is slow and has planned outages. The Uganda deployment does not use an NHID yet, but a second country is expected to adopt the same registry pattern. The NHID is an identifier, so it is PHI.

### Requirement
- Functional: `GET /api/method/spice_lite.api.fhir.search_patients?identifier=urn:spice:nhid|12345678` returns that patient; `get_patient` lists the MRN and the NHID in `identifier[]`; clinicians see a verification status on the patient form.
- Non-functional: NHID unique per deployment and optional at registration (walk-in patients); patient registration keeps working when the registry is down; no NHID in logs, Error Log, `frappe.throw` messages or RQ job arguments; works on Postgres 16 and MariaDB; installing it on another country's site needs no change in `spice_lite`.
- Acceptance criteria:
  1. Search by `urn:spice:nhid|<id>` finds the patient; by `urn:spice-lite:mrn|<mrn>` still finds by MRN; an unknown system gives 400 `invalid`.
  2. A duplicate NHID fails validation; two patients without an NHID can coexist.
  3. Saving a patient with a new or changed NHID enqueues exactly one verification job whose arguments contain only the document name.
  4. A registry timeout sets status `unreachable`; the save itself succeeds.
  5. `norole@spice-lite.test` gets 403 from the search, as today.
  6. All existing spice_lite tests pass unchanged on a site without the integration app.
- Assumptions and open questions:
  - Assumption: NHID is 8 to 12 digits; format validation lives in the integration app.
  - Assumption: registry credentials are set per site with `bench --site <site> set-config spice_nhid_api_key ...` (a secret; agents never read site config).
  - Open: whether the NHID becomes mandatory later. Not decided here; it would need a backfill patch.

### Current architecture (evidence)
| Fact | Evidence |
|---|---|
| Country behaviour belongs outside the core | `context/architecture/overview.md:40` `Country-specific behaviour belongs in a country app (Custom Fields, Property Setters,` |
| A national ID service is an integration app | `context/domain/spice-lite-glossary.md:15` `Integration app` ... `required_apps = ["spice_lite"]` ... `a national ID service` |
| Customisation and background-work standards | `context/standards/frappe-coding-standards.md:14` `**Customisation**` and `:9` `**Background work**` |
| The core has no required apps and no `doc_events` | `sample-app/spice_lite/spice_lite/hooks.py:11` `required_apps = []`, `:27` `# doc_events = {` |
| The API reads a fixed field list, so a Custom Field is invisible | `sample-app/spice_lite/spice_lite/api/fhir.py:33` `PATIENT_FIELDS = ["name", "mrn", "first_name", "last_name", "gender", "birth_date", "active", "country"]` |
| The identifier token's system is thrown away | `sample-app/spice_lite/spice_lite/api/mappers.py:113` `return str(value).split("\|")[-1].strip() or None`; run: `parse_token('urn:spice:ke:nhid\|12345678')` returns `'12345678'` |
| Any identifier value is searched as an MRN | `sample-app/spice_lite/spice_lite/api/fhir.py:80-81` `if mrn:` / `filters.append(["mrn", "=", mrn])` |
| The Patient resource carries one identifier | `sample-app/spice_lite/spice_lite/api/mappers.py:52` `"identifier": [{"system": MRN_SYSTEM, "value": row.get("mrn")}] if row.get("mrn") else [],` |
| Uniqueness pattern used for MRN | `sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.py:32` `clash = frappe.db.exists("SL Patient", {"mrn": self.mrn, "name": ("!=", self.name)})` |
| A new `hooks.py` key needs an ADR | `.claude/rules/doctype-json.md:14` `is an architecture decision: record it in an ADR` |
| Custom Fields support `unique` and `search_index` | `apps/frappe/frappe/custom/doctype/custom_field/custom_field.json:249` `"fieldname": "unique",` and `:352` `"fieldname": "search_index",` |
| A blank unique value is stored as NULL | `apps/frappe/frappe/model/base_document.py:409-412` `getattr(df, "unique", False) and cstr(value).strip() == ""` / `value = None` |
| Required apps are installed first | `apps/frappe/frappe/installer.py:287-290` `if app_hooks.required_apps:` / `install_app(required_app, verbose=verbose)` |
| Fixtures overwrite on install and migrate | `apps/frappe/frappe/utils/fixtures.py:13` `"""Import, overwrite fixtures from` |
| Dict-valued Frappe hooks from all apps are merged | `apps/frappe/frappe/__init__.py:1654-1658` `if isinstance(value, dict):` / `append_hook(target[key], inkey, value[inkey])` |
| Job arguments are visible in desk | `apps/frappe/frappe/core/doctype/rq_job/rq_job.py:170` `arguments=frappe.as_json(job.kwargs),` |
| A job can wait for the commit | `apps/frappe/frappe/utils/background_jobs.py:168-169` `if enqueue_after_commit:` / `frappe.db.after_commit.add(enqueue_call)` |

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| A. Core field `national_health_id` in the `SL Patient` JSON, registry call in `SLPatient.validate` | Smallest change; search and mapper edited in one app | Every country gets a Kenya field (standard 12); each save holds a gunicorn worker for the registry round trip | A registry outage stops patient registration in Kenya |
| B. Country app `spice_ke` with a Custom Field fixture and its own `doc_events` | Follows standard 12; no schema change in the core | The next country copies the registry client; the core API still cannot search or return the field (`sample-app/spice_lite/spice_lite/api/fhir.py:33`, `sample-app/spice_lite/spice_lite/api/mappers.py:52`) | Several copies of a PHI-handling HTTP client drift apart |
| C. Integration app `spice_nhid` (`required_apps = ["spice_lite"]`) with Custom Field fixtures, `doc_events` and an enqueued verification job; the core gains a generic identifier extension point (chosen) | Reusable by any country site; the core stays country-free; registration never waits for the registry | A new `hooks.py` key becomes a contract; verification status is eventually consistent | Job arguments or logs leak the NHID; fixtures overwrite desk edits |
| D. Core child table `SL Patient Identifier` (`system`, `value`) | Any number of identifier systems, closest to FHIR | Uniqueness of (system, value) needs a composite index created by a patch; MRN would exist twice; largest change | Two sources of truth for the MRN during migration |

## Decision
Option C.
- **Core (`spice_lite`)**: a new app-defined `hooks.py` key `spice_lite_identifier_systems`, a dict of system URI to `SL Patient` fieldname, read with `frappe.get_hooks("spice_lite_identifier_systems")`. `mappers.parse_token` gets a sibling `parse_token_system(value) -> (system, value)`; `search_patients` maps no system or `urn:spice-lite:mrn` to `mrn`, a registered system to its field, and anything else to 400 `invalid`. Registered fields are appended to `PATIENT_FIELDS` and passed to `patient_to_fhir` as extra identifiers, so `mappers.py` stays frappe-free. Reads stay on `frappe.get_list`.
- **Integration app `spice_nhid`**: `required_apps = ["spice_lite"]`; `spice_lite_identifier_systems = {"urn:spice:nhid": "national_health_id"}`; fixtures for Custom Fields `SL Patient-national_health_id` (Data, `unique: 1`, `search_index: 1`, not `reqd`) and `SL Patient-nhid_status` (Select `unverified`/`verified`/`mismatch`/`unreachable`, read only); `doc_events = {"SL Patient": {"on_update": "spice_nhid.verify.on_patient_update"}}`.
- **Verification**: when `doc.has_value_changed("national_health_id")`, `frappe.enqueue("spice_nhid.verify.verify_patient", queue="short", timeout=60, job_id=f"nhid-verify-{doc.name}", deduplicate=True, enqueue_after_commit=True, patient=doc.name)`. The job reads the NHID from the database, calls the registry with the key from `frappe.conf`, writes the status with `frappe.db.set_value` (no second `on_update`), and audits with `log_access` (names only). `scheduler_events = {"hourly": ["spice_nhid.verify.retry_unreachable"]}` retries `unreachable` rows.
- **Sites**: the Kenya site installs `spice_nhid`; Uganda does not. No `spice_ke` change is needed.
- Why C: it keeps the core free of country fields (beats A), writes the registry client once (beats B), and changes no MRN semantics (beats D). `override_doctype_class` was rejected because only one app can override `SL Patient`.

## Consequences
- Positive: registration is independent of registry uptime; a second country installs `spice_nhid` and sets its key; unknown identifier systems stop matching MRNs by accident.
- Negative: one more app to release and install in order; `spice_lite_identifier_systems` is now a public contract; verification lags by one job.
- Follow-up work:
  - SL-140: core extension point, `parse_token_system`, 400 for unknown systems (spice_lite).
  - SL-141: `spice_nhid` app with fixtures, `doc_events`, job, hourly retry, tests.
  - SL-142: registry API key per site via `bench set-config`; runbook entry.
  - SL-143: sre dashboard for `short` queue backlog and `unreachable` counts.
  - SL-144: update `context/architecture/overview.md` and the glossary PHI table (NHID is PHI).

### Risks
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| AR-001 | high | correctness | `sample-app/spice_lite/spice_lite/api/mappers.py:113` | `return str(value).split("\|")[-1].strip() or None` | Today `identifier=urn:spice:nhid\|12345678` silently searches MRN `12345678`. Dispatch by system and reject unknown systems with 400; test `test_search_with_unknown_identifier_system_is_400`. |
| AR-002 | high | security | `apps/frappe/frappe/core/doctype/rq_job/rq_job.py:170` | `arguments=frappe.as_json(job.kwargs),` | Pass `patient=doc.name` only; the job reads the NHID itself. Test that the enqueue kwargs equal `{"patient": name}` plus queue options. |
| AR-003 | medium | design | `sample-app/spice_lite/spice_lite/api/fhir.py:33` | `PATIENT_FIELDS = ["name", "mrn",` | Without the extension point a Custom Field never reaches `search_patients` or `patient_to_fhir`. Keep the hook read in one helper and cover it with a test that registers a system. |
| AR-004 | medium | correctness | `apps/frappe/frappe/model/base_document.py:409-412` | `getattr(df, "unique", False) and cstr(value).strip() == ""` | Blank NHIDs become NULL, so the unique index allows many patients without one on both databases. Test `test_two_patients_without_nhid_can_coexist`; do not add `reqd` without a backfill patch. |
| AR-005 | medium | performance | `context/standards/frappe-coding-standards.md:9` | `**Background work**` | A registry outage fills the `short` queue with retries. `deduplicate=True` with a stable `job_id`, `timeout=60`, hourly retry instead of immediate re-enqueue; sre watches the backlog (SL-143). |
| AR-006 | low | standards | `apps/frappe/frappe/utils/fixtures.py:13` | `Import, overwrite fixtures` | Desk edits to the two Custom Fields are lost on the next migrate. Change them only in `spice_nhid/fixtures/` through a PR. |
| AR-007 | low | testing | `context/standards/testing-standards.md:17` | `bench --site test.localhost run-tests --app spice_lite` | `run-tests` does not migrate, so `spice_nhid` tests need the app installed on the test site first (`bench --site test.localhost install-app spice_nhid`, an `ask` rule). spice_lite's own suite must still pass without it (criterion 6). |

## Verification
- Core tests: `TestMappers#test_parse_token_system_keeps_the_system`, `TestFhirApi#test_search_with_unknown_identifier_system_is_400`; `TestFhirApi#test_search_by_identifier_token` stays green unchanged.
- `spice_nhid` tests (`FrappeTestCase`): `TestNationalHealthId#test_search_by_nhid_token_finds_patient`, `test_patient_resource_lists_mrn_and_nhid`, `test_duplicate_nhid_rejected`, `test_two_patients_without_nhid_can_coexist`, `test_changed_nhid_enqueues_one_job_with_name_only` (mock `frappe.enqueue`), `test_registry_timeout_sets_unreachable` (`now=True`), `test_norole_user_cannot_search_by_nhid`.
- Checks: one `search_patients` call costs the same number of queries as today (5, measured with a query counter); `grep -rn national_health_id sites/*/logs` is empty after the test run.
- Review: the security agent reviews the job arguments and the fixture permissions; a human installs `spice_nhid` on the Kenya site after review.
