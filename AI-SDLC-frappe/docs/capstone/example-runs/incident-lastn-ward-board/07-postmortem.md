---
run_id: 2026-09-22-inc-lastn-ward-board
step: 07
agent: sre
status: needs-human
inputs: [01-incident-brief.md, 02-sre.md, 03-security.md, 04-sre.md, 05-sre.md, 06-bug-fix-handover.md]
next: human
---
## Summary
Postmortem draft for INC-2026-0922-01 (SEV2, blameless), written with the `production-rca` skill and its `rca-template.md` sections condensed into the handoff format. The full-length RCA for this evidence pack is the skill's golden reference, `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`; this draft agrees with it on trigger, root cause, impact and preventive action ids.

What happened: from 08:00 UTC, 20 ward tablets at Clinic KE-C-017 each called `lastn` with 100 subjects every 30 s. Each call cost 200 statements and about 42,300 rows and held one of the site's 9 sync gunicorn workers for 14 s to over 120 s, so from 08:02 every worker was busy and every endpoint of `ke.spice.example`, desk and login included, returned 504 or 502. Full outage about 08:04 to 08:12 and 08:15 to 08:31 (24 minutes), degradation 08:01 to 08:34 (33 minutes); the 5xx ratio peaked at 36.2% (`metrics.md` 08:20). Clinicians could not open records or record observations; `create_observation` from `ehr-bridge` hit the timeout at 08:07:30 and its worker was killed in the same second (`nginx-access.log:13`, `web.error.log:14`), so whether that insert committed is not determined. Five `send_visit_reminders` runs failed with `JobTimeoutException` from 08:10 to 08:30. No PHI exposure found (03-security.md).

### Timeline (UTC)
| time | kind | event | evidence |
|---|---|---|---|
| 05:10 to 06:41 | trigger (precondition) | CHG-5102 imports 42,300 observations for 100 KE-C-017 patients, about 423 each | `changes.md:5`, `worker.log:1-2` |
| 07:40 | change | CHG-5104 `spice_telephony` 1.8.0, migrate, web restart 07:41 | `changes.md:6`, `web.error.log:1-5` |
| 08:00 | trigger | CHG-5103 ward board live on 20 tablets, `lastn` with 100 subjects every 30 s | `changes.md:7` |
| 08:00:31 | symptom | first 100-subject `lastn`: 13.9 s | `nginx-access.log:3` |
| 08:02:30 | symptom | 38.2 s; 9 of 9 workers busy | `nginx-access.log:7`, `metrics.md` |
| 08:04:05 | symptom | first 504 and first `WORKER TIMEOUT (pid:2240)` | `nginx-access.log:9`, `web.error.log:6` |
| 08:09 | detection | `SpiceKe5xxRatioHigh` | 01-incident-brief.md |
| 08:10:00 | symptom | first reminder job killed at 300 s; `default` backlog 22 | `worker.log:8`, `redis-queue.txt:9` |
| 08:12:05 | action | on-call restarts web; relief until 08:15:30 | `web.error.log:18-22`, `nginx-access.log:15-17` |
| 08:14 | action | `/incident` run starts | 01-incident-brief.md |
| 08:20 | action | G-M round 1: `spice_telephony` rolled back (M3); no change | 04-sre.md |
| 08:31 | action | G-M round 2: KE-C-017 IT switches the tablets' auto-refresh off (M1) | 05-sre.md |
| 08:31:40 | recovery | last tablet call completes; no slow statement afterwards | `nginx-access.log:20`, `postgres-slow.log:21` |
| 08:34 | recovery | p95 0.10 s, 5xx 0.0% | `metrics.md` |
| 08:48 | recovery | `default` queue empty | `redis-queue.txt:25` |

### Root cause
- **Trigger**: CHG-5103 (ward board go-live) on top of CHG-5102 (deep histories).
- **Root cause**: `spice_lite.api.fhir.lastn` costs two queries per subject and reads every matching observation of each subject to keep one row (`sample-app/spice_lite/spice_lite/api/fhir.py:155-184`). `MAX_LASTN_SUBJECTS = 100` bounds the subjects, not that cost. Confirmed by `pg_stat_statements`: 118,400 per-subject calls from 08:00 to 08:31, 423 rows per call (05-sre.md).
- **Contributing factors**: one pool of 9 sync workers serves desk, integrations and login, so one slow endpoint takes the whole site down; one API token shared by 20 tablets and no per-client rate limit; staging load test with 5 patients and 2 observations each; no alert on busy workers; the reminder job is not idempotent, so every timeout is a lost 5-minute window.
- **Rejected**: bad deploy (rollback changed nothing, 04-sre.md), database degradation, OOM (SIGKILL follows `WORKER TIMEOUT`, no kernel OOM kill), queue or Redis failure (05-sre.md).

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| PM-1 | critical | performance | sample-app/spice_lite/spice_lite/api/fhir.py:155 | SRE-001; 118,400 per-subject queries in 31 minutes | PA-1: set-based `lastn` via `/bug-fix BUG-71` (06-bug-fix-handover.md) with a query-count regression test in CI. Prevents. Owner: developer, tester. |
| PM-2 | high | design | changes.md:7 | SRE-002, SEC-002 | PA-2: per-user rate limit on `lastn` and `search_patients`. Mitigates. Owner: sre. PA-4: one API user per integration client. Mitigates. Owner: country deployment team. |
| PM-3 | medium | design | changes.md:10 | load test with 5 patients x 2 observations | PA-3: integration onboarding gate with the client's call pattern on a synthetic site with production-like history depth. Prevents. Owner: architect. |
| PM-4 | medium | docs | metrics.md | SRE-004 | PA-5: alert on 8 of 9 gunicorn workers busy for 2 minutes and on per-endpoint p95. Detects. PA-6: runbook step "site saturated: find the top endpoint and client before restarting". Mitigates. Owner: sre. |
| PM-5 | medium | design | worker.log:8 | SRE-003 | PA-7: idempotent reminder job per window (`job_id`, `deduplicate=True`) that records what it sent. Mitigates. Owner: telephony integration team. |
| PM-6 | low | performance | sample-app/spice_lite/spice_lite/clinical/doctype/sl_encounter/sl_encounter.json | `tabSL Encounter` scan 1.3 s under load (`postgres-slow.log:8`); `search_index` on `patient` not created on Postgres (D-6) | PA-8: `scripts/automation/` check that every `search_index` field has an index in `pg_indexes`, run after every migrate. Detects. Owner: spice_lite maintainers. |

## Decisions
- Action ids PA-1..PA-8 match section 9 of `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`.
- Status stays `needs-human`: an RCA is a draft until the incident commander and the clinical safety officer sign it off.

## Open questions
- Did the `create_observation` call at 08:07:30 commit before its worker was killed? Compare `SL Observation` rows created by the `ehr-bridge` user between 08:05 and 08:08 with the client's retry log.
- Did the five timed-out reminder runs send part of their batches? The telephony provider's delivery report for 08:05 to 08:30 answers it.
- Clinical safety officer: were care decisions delayed by the 24-minute full outage, and did the ward board show stale heart rates as current?

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
