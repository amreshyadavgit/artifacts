# Test plan: spice_lite.api.fhir.lastn

- Change: cover `lastn` before the set-based rewrite of `TEACHING-DEFECT(perf-n+1)` (module 04 performance-review)
- Standards: `context/standards/testing-standards.md`
- Author: test-strategy skill (draft) for the tester agent
- Date: 2026-09-30

## Scope
In scope: parameter parsing, the 100-subject cap, permission checks, per-patient selection of the latest Observation, code filtering, ordering on Postgres and MariaDB, the query count, and the audit record. Out of scope: fixing the N+1 or any open defect (detected here only), and `create_observation`, which has its own tests.

### Change surface (evidence)
| Element | Evidence |
|---|---|
| GET only, `subjects` has no type hint (not validated by pydantic) | `sample-app/spice_lite/spice_lite/api/fhir.py:140-141` `@frappe.whitelist(methods=["GET"])` / `def lastn(subjects, code: str \| None = None):` |
| Malformed `subjects` becomes 400 `invalid` | `sample-app/spice_lite/spice_lite/api/fhir.py:144-146` `subject_list = parse_subjects(subjects)` / `return _error(400, "invalid", ...` |
| Empty and oversized requests | `sample-app/spice_lite/spice_lite/api/fhir.py:147-150` `return _error(400, "required", ...` / `if len(subject_list) > MAX_LASTN_SUBJECTS:` |
| DocType-level permission check | `sample-app/spice_lite/spice_lite/api/fhir.py:151` `if not frappe.has_permission("SL Observation", "read") or not frappe.has_permission("SL Patient", "read"):` |
| Per-subject loop (planted N+1) | `sample-app/spice_lite/spice_lite/api/fhir.py:155` `for s in subject_list:` and `:165` `patient = frappe.get_doc("SL Patient", s)` |
| Row-level check on the patient only | `sample-app/spice_lite/spice_lite/api/fhir.py:169` `if not frappe.has_permission("SL Patient", "read", doc=patient):` |
| Undated rows excluded (D-2 workaround) | `sample-app/spice_lite/spice_lite/api/fhir.py:174` `filters = {"patient": patient.name, "effective_datetime": (">", "1900-01-01 00:00:00")}` |
| `code` compared verbatim, no token parsing | `sample-app/spice_lite/spice_lite/api/fhir.py:175-176` `if code:` / `filters["code"] = code` |
| Permission-blind query, every column | `sample-app/spice_lite/spice_lite/api/fhir.py:177-181` `rows = frappe.get_all(` ... `fields=["*"],` |
| Latest = first row, any status | `sample-app/spice_lite/spice_lite/api/fhir.py:183-184` `if rows:` / `results.append(observation_to_fhir(rows[0]))` |
| Audit: names and a count | `sample-app/spice_lite/spice_lite/api/fhir.py:186` `log_access("lastn", "SL Observation", [r["id"] for r in results], result_count=len(results))` |
| Subjects are de-duplicated in the mapper | `sample-app/spice_lite/spice_lite/api/mappers.py:129` `if ref and ref not in out:` |
| A stored 0.0 with a unit is emitted as a quantity | `sample-app/spice_lite/spice_lite/api/mappers.py:66-67` `if value is not None and row.get("unit"):` |
| Only final/amended need a value; an amendment needs no date | `sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.py:46-47` `if self.status in LOCKED_STATUSES:` / `if self.value is None or not self.unit:` |

### Existing coverage
| Test | What it proves |
|---|---|
| `TestFhirApi#test_lastn_returns_latest_per_patient` | Latest wins, code filter, undated preliminary never wins, missing subject skipped |
| `TestFhirApi#test_lastn_requires_subjects` | `subjects=""` gives 400 `OperationOutcome` |
| `TestFhirApi#test_lastn_query_count_grows_with_subjects` | Pins the N+1: 5 subjects cost at least 8 more queries than 1 |
| `TestFhirApi#test_user_without_clinician_role_is_forbidden` | `norole@spice-lite.test` gets 403 `forbidden` from `lastn` |
| `TestFhirApi#test_whitelisted_methods_are_not_guest_accessible` | `lastn` is whitelisted and not in `frappe.guest_methods` |
| `TestFhirApi#test_framework_defect_is_set_filter_on_datetime` | Why line 174 uses `>` instead of `("is", "set")` (D-2) |
| `TestMappers#test_parse_subjects` | JSON list, comma list, `Patient/` prefix, de-duplication |
| `TestMappers#test_parse_subjects_bad_json_raises_value_error` | `"[not json"` raises `ValueError` |

## Risks and defects found while planning
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TS-001 | high | performance | `sample-app/spice_lite/spice_lite/api/fhir.py:155` | Measured with a query counter on Postgres: 1 subject `2` queries, 5 subjects `10`, 20 subjects `40` | Pre-existing `TEACHING-DEFECT(perf-n+1)` (KNOWN_DEFECTS T-1). Detect with TC-16 (SL-130); fix in module 04. |
| TS-002 | medium | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:175-176` | `code="http://loinc.org\|8480-6"` returns `total` 0; TC-13 unskipped: `AssertionError: Lists differ: [] != ['SLO-00002']` | Parse the token with `parse_token` as `search_patients` does at line 66; SL-131, TC-13. |
| TS-003 | medium | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:174` | An `amended` Observation saved without `effective_datetime` is filtered out, so `lastn` returns the final it replaces; TC-14 unskipped: `AssertionError: 'SLO-00009' != 'SLO-00010'` | Require `effective_datetime` for final and amended in `SLObservation.validate` (or copy it from `replaces`); SL-132, TC-14. |
| TS-004 | medium | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:183-184` | A newer `preliminary` Observation with no value (stored as 0.0, D-1) wins; TC-15 unskipped: `AssertionError: 0.0 == 0.0` | Filter `status in ("final", "amended")` in `lastn`; a missing reading must never be reported as 0 mm[Hg]; SL-133, TC-15. |
| TS-005 | medium | testing | `sample-app/spice_lite/spice_lite/tests/test_fhir_api.py:171-179` | `with self.assertQueryCount(1000):` around one call on Postgres: `TypeError: sequence item 0: expected str instance, LazyDecode found`; on MariaDB `OK` | Use a query counter (`count_queries()` in the example) for the performance smoke test; `testing-standards.md` "Performance smoke" and the T-1 fix note in `KNOWN_DEFECTS.md` both name `assertQueryCount`. Pinned by TC-24. |
| TS-006 | low | security | `sample-app/spice_lite/spice_lite/api/fhir.py:177` | `rows = frappe.get_all(` skips user permissions and `permission_query_conditions` on SL Observation (reasoned from code; today line 169 still filters by patient, proven by TC-21) | Part of T-1: the rewrite must use `frappe.get_list`. Keep TC-21 so a regression is caught. |
| TS-007 | info | correctness | `sample-app/spice_lite/spice_lite/api/mappers.py:129` | `if ref and ref not in out:` | Duplicate subjects are already collapsed; TC-12 pins it so the rewrite keeps it. |

## Test cases
| id | category | tool | test | scenario | expected | status |
|---|---|---|---|---|---|---|
| TC-01 | unit | unittest | `TestMappers#test_parse_subjects` | JSON list, comma list, `Patient/` prefix, repeats | De-duplicated ids in first-seen order | existing |
| TC-02 | unit | unittest | `TestMappers#test_parse_subjects_bad_json_raises_value_error` | `"[not json"` | `ValueError` | existing |
| TC-03 | unit | unittest | `TestLastnMappers#test_zero_value_with_unit_is_emitted_as_zero_quantity` | preliminary row, `value` 0.0, unit `mm[Hg]` | `valueQuantity.value` 0.0 (explains TS-004) | new |
| TC-04 | unit | unittest | `TestLastnMappers#test_parse_subjects_does_not_cap_the_list` | 101 comma-separated ids | 101 ids: the cap belongs to the API layer | new |
| TC-05 | integration | FrappeTestCase | `TestFhirApi#test_framework_defect_is_set_filter_on_datetime` | `("is", "set")` on `effective_datetime` | Raises only on Postgres | existing |
| TC-06 | integration | FrappeTestCase + call() | `TestLastnPlan#test_lastn_breaks_equal_timestamps_by_creation` | Two observations with the same `effective_datetime` | The later-created one wins (`creation desc`) | new |
| TC-07 | api | FrappeTestCase + call() | `TestLastnPlan#test_lastn_without_code_returns_latest_of_any_code` | BP 30 min ago, HR 5 min ago, no `code` | 200, one entry, the HR observation | new |
| TC-08 | api | FrappeTestCase + call() | `TestLastnPlan#test_lastn_accepts_json_and_comma_separated_subjects` | `'["Patient/SLP-.."]'`, `Patient/SLP-..`, bare id | Same entry each time | new |
| TC-09 | negative | FrappeTestCase + call() | `TestFhirApi#test_lastn_requires_subjects` | `subjects=""` | 400 `OperationOutcome` | existing |
| TC-10 | negative | FrappeTestCase + call() | `TestLastnPlan#test_lastn_with_malformed_json_is_400_invalid` | `subjects="[not json"` | 400, `issue[0].code` = `invalid` | new |
| TC-11 | negative | FrappeTestCase + call() | `TestLastnPlan#test_lastn_with_101_subjects_is_400_too_costly` | 101 ids, then 100 ids | 400 `too-costly`, then 200 | new |
| TC-12 | edge | FrappeTestCase + call() | `TestLastnPlan#test_lastn_deduplicates_repeated_subjects` | Same patient as bare id and `Patient/` reference | `total` 1 | new |
| TC-13 | edge | FrappeTestCase + call() | `TestLastnPlan#test_lastn_accepts_loinc_token_with_system` | `code=http://loinc.org\|8480-6` | The patient's BP observation (fails today with `[]`: TS-002) | new-failing |
| TC-14 | edge | FrappeTestCase + call() | `TestLastnPlan#test_lastn_prefers_undated_amendment_over_the_final_it_replaces` | final 150 an hour ago, amended 140 with no date | The amendment (fails today: TS-003) | new-failing |
| TC-15 | edge | FrappeTestCase + call() | `TestLastnPlan#test_lastn_never_reports_a_missing_value_as_zero` | final 150, then preliminary with no value | Not 0.0 (fails today with 0.0: TS-004) | new-failing |
| TC-16 | performance | query counter | `TestLastnPlan#test_lastn_query_count_is_constant_for_20_subjects` | 20 subjects, caches warmed | `<= 10` queries (fails today: `40 not less than or equal to 10`, TS-001) | new-failing |
| TC-17 | performance | query counter | `TestFhirApi#test_lastn_query_count_grows_with_subjects` | 1 and 5 subjects | Pins the N+1; replace with TC-16 when fixed | existing |
| TC-18 | security | frappe.set_user | `TestFhirApi#test_user_without_clinician_role_is_forbidden` | `norole@spice-lite.test` | 403 `forbidden` | existing |
| TC-19 | security | FrappeTestCase | `TestFhirApi#test_whitelisted_methods_are_not_guest_accessible` | Registry check | Not in `frappe.guest_methods` | existing |
| TC-20 | security | FrappeTestCase | `TestLastnPlan#test_lastn_is_get_only` | `frappe.allowed_http_methods_for_whitelisted_func` | `["GET"]` | new |
| TC-21 | security | frappe.set_user | `TestLastnPlan#test_lastn_skips_patients_outside_the_users_user_permissions` | Clinician with a User Permission for one of two patients | Only that patient's entry (guards TS-006) | new |
| TC-22 | security | unittest.mock | `TestLastnPlan#test_lastn_audits_names_and_count_only` | Spy on `fhir.log_access` | Called once with `("lastn", "SL Observation", [name], result_count=1)`, no values | new |
| TC-23 | regression | FrappeTestCase + call() | `TestFhirApi#test_lastn_returns_latest_per_patient` | Guard named in KNOWN_DEFECTS T-1 | Keeps passing before and after the N+1 fix | existing |
| TC-24 | regression | FrappeTestCase | `TestLastnPlan#test_framework_defect_assert_query_count_breaks_on_postgres` | `assertQueryCount(1000)` around `select 1` | `TypeError` only when `frappe.db.db_type == "postgres"` (TS-005) | new |

## Coverage matrix
| category | cases | note |
|---|---|---|
| unit | TC-01, TC-02, TC-03, TC-04 | Mappers without a site |
| integration | TC-05, TC-06 | Real-database ordering and filter semantics |
| api | TC-07, TC-08 | Happy paths and accepted input shapes |
| negative | TC-09, TC-10, TC-11 | Empty, malformed, oversized |
| edge | TC-12, TC-13, TC-14, TC-15 | Duplicates, tokens, undated amendment, missing value |
| performance | TC-16, TC-17 | Query counter, not wall-clock time |
| security | TC-18, TC-19, TC-20, TC-21, TC-22 | Roles, guest, HTTP verb, User Permissions, audit content |
| regression | TC-23, TC-24 | Guard for the module 04 fix; framework pin |

## Test data
Every integration test creates its own patient in `setUp` with `make_patient()` (random `MRN-` value) and observations with `make_observation(patient, minutes_ago=...)`, LOINC `8480-6` and `8867-4` only. Users come from `ensure_test_users()`. TC-21 deletes its User Permission in `finally`, because the cached copy in redis survives the class rollback. No names, MRNs or values appear in assertions or in the audit spy's expected arguments.

## Exit criteria
- `existing` and `new` cases pass; the four `new-failing` cases ship with `@unittest.skip("SL-13x: ...")` and fail for the stated finding when the skip is removed (measured: 4 failures, messages quoted in the findings table).
- Integration: `bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_plan` gives `Ran 14 tests`, `OK (skipped=4)` on Postgres and on `mariadb.localhost`.
- Unit: `cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .` gives `Ran 11 tests`, `OK` with `test_lastn_mappers_unit.py` added.
- `bench --site test.localhost run-tests --app spice_lite` passes.
- Implementation files: `sample-app/spice_lite/spice_lite/tests/test_lastn_plan.py` and `sample-app/spice_lite/spice_lite/tests/unit/test_lastn_mappers_unit.py` (examples in `.claude/skills/test-strategy/examples/`).
