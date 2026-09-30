# Running the security probes

`test_security_probes.py` confirms the security-review findings on the real app. It is **not** part of the app's suite: copy it in, run it once, delete it. Everything it creates is synthetic and rolled back by `FrappeTestCase` at class end. The security agent cannot run it (read-only tools); the tester agent or a human can.

## Probe run (from `AI-SDLC-frappe/`, bench user)

```bash
cp .claude/skills/security-review/probes/test_security_probes.py sample-app/spice_lite/spice_lite/tests/
(cd /home/user/frappe-bench && bench --site test.localhost run-tests --module spice_lite.tests.test_security_probes) 2>&1 | grep -E '^PROBE|^Ran|^OK|^FAIL'
rm sample-app/spice_lite/spice_lite/tests/test_security_probes.py
```

On a shared bench (the course container), hold the lock for the whole copy, run, delete sequence, so no other run imports the file:

```bash
flock /tmp/spice-bench.lock bash -c '
  T=/home/user/artifacts/AI-SDLC-frappe/sample-app/spice_lite/spice_lite/tests/test_security_probes.py
  cp /home/user/artifacts/AI-SDLC-frappe/.claude/skills/security-review/probes/test_security_probes.py $T && chown frappe:frappe $T
  su - frappe -c "source ~/.spice-lite-bench-env && cd /home/user/frappe-bench && bench --site test.localhost run-tests --module spice_lite.tests.test_security_probes" 2>&1 | grep -E "^PROBE|^Ran|^OK|^FAIL"
  rm -f $T'
```

Output recorded on 2026-09-30 (Frappe 15.121.2, PostgreSQL 16, unmodified app):

```text
Ran 7 tests in 2.312s
OK
PROBE SEC-PROBE-1 get_list=['SLO-00001'] has_permission(new)=False lastn_status=200 lastn_returned=['SLO-00002'] hidden=SLO-00002
PROBE SEC-PROBE-2 get_list=[] lastn_status=200 lastn_returned=['SLO-00003']
PROBE SEC-PROBE-3 has_permission(hidden_patient)=False create_status=403 issue=forbidden
PROBE SEC-PROBE-4 existing_but_forbidden=403 not_existing=404
PROBE SEC-PROBE-5 error=InvalidDatetimeFormat value_in_error_log_traceback=True value_in_frappe_log_line=True traceback_has_locals=True
PROBE SEC-PROBE-6 version_rows=1 last_name_in_version=True clinician_can_read_version=False
PROBE SEC-PROBE-7 unsafe_rows=10 safe_rows=0 total_patients=10
```

Document names (`SLO-00001`) depend on the site's naming series and differ between runs. Probe 5 also makes Frappe print one `Error in query: invalid input syntax for type timestamp: "not-a-datetime"` block (expected), and Postgres writes the failed `INSERT` with its values to its server log (`/var/log/postgresql/postgresql-16-main.log` here), which is part of what SEC-002 reports. The value in that line is the synthetic `187.25`.

| Probe | Finding | What "pass" means |
|---|---|---|
| 1, 2 | SEC-001 | `lastn` returned an observation the Clinician cannot read via `get_list` |
| 3 | checked clean (authz) | the write path already enforces User Permissions on the patient Link |
| 4 | SEC-006 | 403 vs 404 for forbidden vs missing names |
| 5 | SEC-002 | request values reach the Error Log traceback (locals) and the `Form Dict` log line |
| 6 | SEC-008 | a patient save writes the old and new `last_name` to `Version.data` |
| 7 | exercise-introduced pattern | an f-string `frappe.db.sql` returns every patient for `nobody' or '1'='1` |

After `performance-review/examples/lastn-fix/lastn-set-based.patch` is applied, probes 1 and 2 **fail**, which is the fix working. Recorded with the patch applied: `PROBE SEC-PROBE-1 get_list=['SLO-00018'] ... lastn_returned=['SLO-00018'] hidden=SLO-00019` (lastn now returns the newest observation the Clinician may read) and `PROBE SEC-PROBE-2 get_list=[] lastn_status=200 lastn_returned=[]`.

## Access log (SEC-003)

Start one gunicorn worker on a spare port, send a guest request, stop it. No data is written.

```bash
cd /home/user/frappe-bench/sites
timeout 25 ../env/bin/gunicorn -b 127.0.0.1:8766 -w 1 -t 120 --access-logfile - frappe.app:application --preload > /tmp/gunicorn-probe.log 2>&1 &
sleep 8
curl -s -o /dev/null -H 'Host: test.localhost' 'http://127.0.0.1:8766/api/method/spice_lite.api.fhir.search_patients?family=Probefamily&identifier=urn:spice-lite:mrn%7CMRN-000123'
curl -s -H 'Host: test.localhost' 'http://127.0.0.1:8766/api/method/spice_lite.api.fhir.search_patients?family=Probefamily' | head -c 300; echo
wait; grep search_patients /tmp/gunicorn-probe.log
```

Recorded output: the access log line carries the query string (`"GET /api/method/spice_lite.api.fhir.search_patients?family=Probefamily&identifier=urn:spice-lite:mrn%7CMRN-000123 HTTP/1.1" 403 2061`), and the guest's 403 body contains `"exc":"[\"Traceback (most recent call last):...` (SEC-004).

bench's production supervisor and systemd templates start gunicorn without `--access-logfile`, so in production the line that matters is nginx's: bench's `nginx.conf` template writes `access_log /var/log/nginx/<site>_access.log` in the combined format, whose `$request` is the same request line with the query string. nginx is not installed in the course container, so that part is from the template and nginx's documented format, not from a run.
