# Security review: sample-app/ (spice_lite, unmodified)

- Mode: path (ref HEAD)
- Verdict: **block**
- Findings: critical 0, high 3, medium 2, low 5, info 1

## Findings

| id | severity | category | location | title | PHI |
|---|---|---|---|---|---|
| SEC-001 | high | authz | `sample-app/spice_lite/spice_lite/api/fhir.py:177-182` | lastn() reads SL Observation with frappe.get_all, so row-level permissions are ignored | yes |
| SEC-002 | high | phi | `sample-app/spice_lite/spice_lite/api/fhir.py:124-133` | A malformed effective_datetime makes create_observation fail with a 500 that copies the request values into Error Log, frappe.log and the Postgres log | yes |
| SEC-003 | high | phi | `sample-app/spice_lite/spice_lite/api/fhir.py:63-64` | search_patients takes family and identifier (MRN) in a GET query string, which web access logs record | yes |
| SEC-004 | medium | api-security | `sample-app/spice_lite/spice_lite/install.py:17-18` | Error responses include a full Python traceback, also for guests, because allow_error_traceback is on | no |
| SEC-005 | medium | api-security | `sample-app/spice_lite/spice_lite/api/fhir.py:149-150` | lastn accepts 100 subjects per call and costs 2 queries per subject | no |
| SEC-006 | low | api-security | `sample-app/spice_lite/spice_lite/api/fhir.py:52-57` | get_patient answers 404 for missing and 403 for forbidden documents, so names outside the user's permissions can be enumerated | no |
| SEC-007 | low | logging-audit | `sample-app/spice_lite/spice_lite/api/fhir.py:44-45` | Refused requests (403) are not recorded in the audit log | no |
| SEC-008 | low | phi | `sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json:106` | track_changes copies PHI into Version.data on every SL Patient save | yes |
| SEC-009 | low | secrets | `sample-app/spice_lite/spice_lite/demo.py:50-55` | seed_demo returns API key and secret pairs on stdout | no |
| SEC-010 | low | dependencies | `sample-app/spice_lite/pyproject.toml:23-24` | No dependency audit step for the app or the bench | no |
| SEC-011 | info | dependencies | `sample-app/docs/KNOWN_DEFECTS.md` | Frappe v15 on Postgres receives no further Postgres fixes | no |

### SEC-001 (high): lastn() reads SL Observation with frappe.get_all, so row-level permissions are ignored

- Category: authz (CWE-863); confidence high
- Location: `sample-app/spice_lite/spice_lite/api/fhir.py:177-182`
- Verified by: `probes/test_security_probes.py::test_probe_1_lastn_bypasses_user_permission_on_observation, probes/test_security_probes.py::test_probe_2_lastn_ignores_permission_query_conditions`
- Related: PERF-001, SEC-005

Evidence:

```text
rows = frappe.get_all(
	"SL Observation",
	filters=filters,
	order_by="effective_datetime desc, creation desc",
	fields=["*"],
)
frappe.get_all is get_list with ignore_permissions=True. The loop checks has_permission on the SL Patient only. Probe output (Clinician with a User Permission allowing only the older observation; then a permission_query_conditions Frappe hook hiding code 8480-6):
PROBE SEC-PROBE-1 get_list=['SLO-00001'] has_permission(new)=False lastn_status=200 lastn_returned=['SLO-00002'] hidden=SLO-00002
PROBE SEC-PROBE-2 get_list=[] lastn_status=200 lastn_returned=['SLO-00003']
No User Permission or permission_query_conditions exists in spice_lite today, so this is high, not critical; on a country deployment that restricts observations by facility it discloses PHI to users who may not read it.
```

Recommendation: Read observations with frappe.get_list (permission-aware) and validate subjects with one frappe.get_list("SL Patient", filters={"name": ("in", subjects)}, pluck="name"). The performance-review patch examples/lastn-fix/lastn-set-based.patch does both; with it applied, probe 1 returns the newest observation the Clinician may read and probe 2 returns an empty bundle (both probes then fail, as intended). Keep probe 1 as a permanent regression test.

### SEC-002 (high): A malformed effective_datetime makes create_observation fail with a 500 that copies the request values into Error Log, frappe.log and the Postgres log

- Category: phi (CWE-532); confidence high
- Location: `sample-app/spice_lite/spice_lite/api/fhir.py:124-133`
- Verified by: `probes/test_security_probes.py::test_probe_5_unhandled_error_copies_request_values_into_error_sinks; /var/log/postgresql/postgresql-16-main.log STATEMENT line`

Evidence:

```text
try:
	doc.insert()  # permission-aware: checks "create" again for this doc
except frappe.PermissionError:
	...
except frappe.ValidationError as e:
	...
effective_datetime is a str parameter (fhir.py:103) passed to insert unvalidated; on Postgres the INSERT raises psycopg2 InvalidDatetimeFormat, which is neither exception above, so frappe.app.handle_exception answers 500 and calls log_error_snapshot: the Error Log traceback is built with get_traceback(with_context=True) (local variables) and frappe.logger(with_more_info=True) appends Form Dict to logs/frappe.log. Probe with a synthetic value:
PROBE SEC-PROBE-5 error=InvalidDatetimeFormat value_in_error_log_traceback=True value_in_frappe_log_line=True traceback_has_locals=True
Postgres server log for the same call:
STATEMENT:  INSERT INTO "tabSL Observation" ("name", ..., "patient", ..., "effective_datetime", "value", "unit", "replaces") VALUES ('SLO-00004', ..., 'SLP-00007', ..., 'not-a-datetime', [REDACTED], 'mm[Hg]', NULL)
```

Recommendation: Validate effective_datetime in create_observation before building the doc (frappe.utils.get_datetime inside try/except, return _error(422, "invalid", ...) without echoing the value) and catch frappe.db.DataError around insert as a 422. Add a test that posts effective_datetime="not-a-datetime" and asserts 422 and no new Error Log row. For the sinks themselves: restrict Error Log to System Manager (default), set log_min_error_statement = panic on PHI databases or ship Postgres logs only to a PHI-approved store, and add a scheduled check that greps logs/frappe.log for 'Form Dict:' lines from spice_lite methods.

### SEC-003 (high): search_patients takes family and identifier (MRN) in a GET query string, which web access logs record

- Category: phi (CWE-598); confidence high
- Location: `sample-app/spice_lite/spice_lite/api/fhir.py:63-64`
- Verified by: `gunicorn and bench serve on test.localhost, curl as guest (probes/RUN.md, section Access log); nginx not run here`

Evidence:

```text
@frappe.whitelist(methods=["GET"])
def search_patients(family: str | None = None, identifier: str | None = None):
gunicorn with --access-logfile (default access_log_format) for a guest request against test.localhost:
127.0.0.1 - - [30/Sep/2026:08:44:05 +0000] "GET /api/method/spice_lite.api.fhir.search_patients?family=[REDACTED]&identifier=urn:spice-lite:mrn%7CMRN-000123 HTTP/1.1" 403 2061 "-" "curl/8.5.0"
bench serve (werkzeug) logs the same request line. bench's production supervisor command runs gunicorn without --access-logfile, but bench's nginx.conf template writes access_log /var/log/nginx/<site>_access.log, and nginx's combined format includes $request, i.e. the query string. The line is logged whether or not the caller is authenticated. The audit log correctly omits search terms (fhir.py:90-91); the access logs do not.
```

Recommendation: Accept searches as POST (methods=["POST"], or ["GET", "POST"] during a migration window with clients moved to POST, like FHIR's POST _search) so family and identifier travel in the body. Until then, give /api/method/ an nginx log_format that logs $uri instead of $request, and never enable a gunicorn access_log_format with %(r)s or %(q)s. Treat existing nginx access logs as PHI (retention, access). Add a test that asserts search_patients rejects GET once migrated.

### SEC-004 (medium): Error responses include a full Python traceback, also for guests, because allow_error_traceback is on

- Category: api-security (CWE-209); confidence high
- Location: `sample-app/spice_lite/spice_lite/install.py:17-18`
- Verified by: `curl as guest against gunicorn on test.localhost`

Evidence:

```text
System Settings allow_error_traceback defaults to 1 (frappe/core/doctype/system_settings/system_settings.json) and is 1 on test.localhost. Guest request through gunicorn:
{"exception":"frappe.exceptions.PermissionError: ... Function <strong>spice_lite.api.fhir.search_patients</strong> is not whitelisted.","exc_type":"PermissionError","exc":"[\"Traceback (most recent call last):\\n  File \\\"apps/frappe/frappe/app.py\\\", line 157, in application ...
For a 500 the exception text is returned too; on Postgres that text quotes the failing SQL with its values.
```

Recommendation: Turn it off on every non-development site: in after_install and after_migrate (install.py) set frappe.db.set_single_value("System Settings", "allow_error_traceback", 0) unless developer_mode is set, or make it part of the country deployment checklist. Add a test that asserts the setting is 0 after install on a non-developer site.

### SEC-005 (medium): lastn accepts 100 subjects per call and costs 2 queries per subject

- Category: api-security (CWE-770); confidence high
- Location: `sample-app/spice_lite/spice_lite/api/fhir.py:149-150`
- Related: PERF-001

Evidence:

```text
MAX_LASTN_SUBJECTS = 100 (fhir.py:35)
if len(subject_list) > MAX_LASTN_SUBJECTS:
	return _error(400, "too-costly", ...)
Measured with performance-review examples/lastn-fix/test_lastn_query_count.py: LASTN_QUERY_COUNT subjects=20 queries=40. Any Clinician token can drive 200 queries per request, in a loop.
```

Recommendation: Apply the set-based fix (performance-review, PERF-001: 3 queries for any number of subjects). Add a per-user rate limit for lastn (frappe.rate_limiter.rate_limit decorator or at nginx) sized for dashboard refresh rates.

### SEC-006 (low): get_patient answers 404 for missing and 403 for forbidden documents, so names outside the user's permissions can be enumerated

- Category: api-security (CWE-204); confidence high
- Location: `sample-app/spice_lite/spice_lite/api/fhir.py:52-57`
- Verified by: `probes/test_security_probes.py::test_probe_4_get_patient_existence_oracle`

Evidence:

```text
if not name or not frappe.db.exists("SL Patient", name):
	return _error(404, "not-found", _("Patient {0} not found").format(name))
doc = frappe.get_doc("SL Patient", name)
if not frappe.has_permission("SL Patient", "read", doc=doc):
	return _forbidden("SL Patient")
PROBE SEC-PROBE-4 existing_but_forbidden=403 not_existing=404
Names are an opaque series (SLP-.#####), so this reveals which names exist and how many patients a site has, not who they are.
```

Recommendation: Return 404 for both cases when the user lacks read permission on the document (check has_permission before disclosing existence), and keep 403 for users without DocType-level read.

### SEC-007 (low): Refused requests (403) are not recorded in the audit log

- Category: logging-audit; confidence high
- Location: `sample-app/spice_lite/spice_lite/api/fhir.py:44-45`

Evidence:

```text
def _forbidden(doctype: str, ptype: str = "read") -> dict:
	return _error(403, "forbidden", _("Not permitted to {0} {1}").format(ptype, doctype))
Only successful reads and writes call log_access; an auditor cannot see which user was refused, or how often.
```

Recommendation: Call log_access("denied", doctype, names) with document names only (never search terms) from _forbidden's call sites, and alert on bursts of denied events per user.

### SEC-008 (low): track_changes copies PHI into Version.data on every SL Patient save

- Category: phi (CWE-532); confidence high
- Location: `sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json:106`
- Verified by: `probes/test_security_probes.py::test_probe_6_version_stores_phi_diff`

Evidence:

```text
"track_changes": 1
PROBE SEC-PROBE-6 version_rows=1 last_name_in_version=True clinician_can_read_version=False
Version is readable by System Manager only, so this is not a disclosure today. It is a second PHI store with its own retention, and it is exactly what an MCP server or report over Version would leak.
```

Recommendation: Keep track_changes (it is the clinical change history), document Version and Error Log as PHI stores in context/security/phi-and-secrets-policy.md, never expose them through MCP or /api/resource to integration users, and set a retention period.

### SEC-009 (low): seed_demo returns API key and secret pairs on stdout

- Category: secrets; confidence high
- Location: `sample-app/spice_lite/spice_lite/demo.py:50-55`

Evidence:

```text
keys = {user: generate_keys(user) for user in (CLINICIAN, NO_ROLE_USER)}
...
out[user] = f"{k['api_key']}:{k['api_secret']}"
Guarded: it throws unless allow_tests or developer_mode is set (demo.py:20-21). bench execute prints the return value, so the pair lands in terminal scrollback or CI logs.
```

Recommendation: Keep the guard; write the pairs to a 0600 file outside the repo instead of returning them, and never run it in CI jobs whose logs are retained.

### SEC-010 (low): No dependency audit step for the app or the bench

- Category: dependencies; confidence medium
- Location: `sample-app/spice_lite/pyproject.toml:23-24`

Evidence:

```text
[tool.bench.frappe-dependencies]
frappe = ">=15.0.0,<16.0.0"
dependencies = [] and no pip-audit, Dependabot or Renovate configuration in the repo.
```

Recommendation: Run pip-audit against the bench venv (env/bin/pip freeze) in CI and on each country deployment image, and pin the Frappe minor you deploy.

### SEC-011 (info): Frappe v15 on Postgres receives no further Postgres fixes

- Category: dependencies; confidence high
- Location: `sample-app/docs/KNOWN_DEFECTS.md`

Evidence:

```text
bench new-site --db-type postgres prints: "PostgreSQL support is limited to Frappe v16 and above. Fixes for earlier versions will not be added." D-2 in KNOWN_DEFECTS.md is one such bug.
```

Recommendation: Record the accepted risk in an ADR and plan the v16 upgrade; security fixes in shared code still arrive in v15 patch releases.

## Checked and clean

- **authn**: No allow_guest in sample-app/spice_lite (grep); test_whitelisted_methods_are_not_guest_accessible passes; a guest GET on search_patients through gunicorn returned 403 'is not whitelisted'. No override_whitelisted_methods in hooks.py.
- **authz**: Apart from SEC-001, request paths use frappe.get_list or has_permission(doc=...). The write path enforces User Permissions on the patient Link: PROBE SEC-PROBE-3 has_permission(hidden_patient)=False create_status=403 issue=forbidden. DocType permissions: Clinician has no delete on SL Patient, SL Encounter, SL Observation; read only on SL Country. ignore_permissions appears only in install.py and the v0_1 patch.
- **injection**: No frappe.db.sql in sample-app/spice_lite/spice_lite (grep). The only frappe.qb use (patches/v0_1/backfill_patient_country.py) binds values through .set/.where. search_patients rejects %, _ and backslash (D-5). Probe 7 shows what an f-string query would allow: unsafe_rows=10 safe_rows=0 total_patients=10.
- **input-validation**: Whitelisted parameters are typed and Frappe enforces the hints (value="72" becomes 72.0); parse_subjects errors map to 400; Select fields are validated on insert (422). The one gap, an unvalidated effective_datetime string, is reported as SEC-002.
- **secrets**: No secret in app code, DocType JSON or patches. frappe.conf is read only for spice_lite_country_code/_name (patches/v0_1/backfill_patient_country.py). site_config.json and common_site_config.json are denied in .claude/settings.json and were not read.
- **infrastructure**: sample-app/docker/docker-compose.yml:5 labels its passwords 'DEV / TEACHING ONLY'; only port 8080 is published; the Dockerfile sets no secret ENV. sample-app/k8s/ contains a README pattern only (see limitations).

## Limitations

- Probes ran on test.localhost (PostgreSQL 16) with synthetic data inside FrappeTestCase. SEC-002 was probed on Postgres only; how MariaDB reacts to the same malformed datetime was not probed.
- The production nginx and gunicorn access_log_format are not in this repo; SEC-003 was shown with gunicorn's default format.
- No CVE feed lookup (offline); SEC-010 is about the missing process, not a known vulnerable version.
- sample-app/k8s/README.md describes a Helm pattern; no manifests exist to review.
