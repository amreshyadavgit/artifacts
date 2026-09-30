# Changelog: security-review

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow SemVer: major = breaking report schema change, minor = new category or check, patch = wording.

## [1.0.0] - 2026-09-30
### Added
- `SKILL.md` with scope selection, ten categories, the Frappe facts that decide findings, a severity scale for PHI, and evidence and redaction rules. Injects `git diff --stat` and the list of `@frappe.whitelist` methods.
- `checklist.md` with per-category files, Grep patterns and Frappe behaviour for spice_lite.
- `report.schema.json` (schemaVersion 1.0, optional `verifiedBy`) and `scripts/render-report.mjs` (schema, counts, verdict, unique ids, non-synthetic MRN, Frappe API token and unredacted Form Dict guards, `--fail-on`).
- `probes/test_security_probes.py` (7 probes) and `probes/RUN.md`.
- Golden cases `tests/cases.json` (sec-01 to sec-09) and the answer key `tests/expected/sample-app-report.json` with its rendering.
### Verified (2026-09-30, Frappe 15.121.2, PostgreSQL 16, Node 22)
- `node --test skills/security-review/tests/render-report.test.mjs`: 7 pass (sec-07); sec-08 exits 1.
- Probes: `Ran 7 tests ... OK` on the unmodified app; with `performance-review/examples/lastn-fix/lastn-set-based.patch` applied, probes 1 and 2 fail as intended.
- SEC-003 and SEC-004: guest requests through gunicorn 23.0.0 (`--access-logfile -`) and `bench serve`.
- SEC-002: the failed INSERT with its values appears in `/var/log/postgresql/postgresql-16-main.log`.
### Not yet verified
- Live cases sec-01 to sec-06 need a model run (`claude -p`); no API key in the build container. Record the first pass rate here.
- nginx was not run; SEC-003's nginx part rests on bench's `nginx.conf` template and nginx's documented combined format.
