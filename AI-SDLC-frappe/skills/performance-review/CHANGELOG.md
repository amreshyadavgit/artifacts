# Changelog: performance-review

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). SemVer: minor = new area or check, patch = wording.

## [1.0.0] - 2026-09-30
### Added
- `SKILL.md` (measure-first procedure, severity, output format) and `checklist.md` (nine areas with Frappe v15 and bench 5.31 defaults: gunicorn sync workers `cpu_count() * 2 + 1`, `-t 120`, RQ queue timeouts 300/300/1500 s, `rq:queue:<bench_id>:<queue>` keys, the Postgres `search_index` name collision).
- `scripts/count-queries.mjs`: statement shapes from `SQL:` lines or a Postgres server log, durations per shape, N+1 suspects, literals masked, `--fail-on-suspect`.
- `examples/lastn-fix/`: `test_lastn_query_count.py` (own `frappe.db.sql` counter plus `assertQueryCount` through `PostgresQueryCountMixin`), `lastn-set-based.patch`, `APPLY.md`, and the captured statements before and after.
- Golden cases perf-01 to perf-07 and the answer key.
### Verified (2026-09-30, Frappe 15.121.2)
- Before: `LASTN_QUERY_COUNT` 2 / 40 / 200 for 1 / 20 / 100 subjects, `AssertionError: 200 not less than or equal to 6`. After: 3 / 3 / 3 on Postgres and MariaDB; full suite `Ran 49 tests ... OK`; sample-app reverted.
- `FrappeTestCase.assertQueryCount` raises `TypeError ... LazyDecode found` on Postgres (KNOWN_DEFECTS.md D-10); the mixin fixes it by patching `frappe.db.__class__`.
- `pg_indexes` on test.localhost has no index for `tabSL Encounter.patient` or `tabSL Patient.country`; MariaDB has both.
- `node --test skills/performance-review/tests/count-queries.test.mjs`: 6 pass.
### Not yet verified
- Live cases perf-01 to perf-04 need a model run. Record the first pass rate here.
