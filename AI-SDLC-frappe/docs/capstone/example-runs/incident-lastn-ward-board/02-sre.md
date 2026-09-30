---
run_id: 2026-09-22-inc-lastn-ward-board
step: 02
agent: sre
status: needs-human
inputs: [01-incident-brief.md]
next: human
---
## Summary
Evidence up to 08:17 UTC points to one cause with high confidence: the KE-C-017 ward board (CHG-5103, `c017-ward-board/1.0.0`) calls `spice_lite.api.fhir.lastn` with 100 subjects from 20 tablets every 30 s, about 40 calls a minute (`metrics.md` 08:02 to 08:16), and `lastn` costs two queries per subject and reads every matching observation of each patient (`sample-app/spice_lite/spice_lite/api/fhir.py:155-184`, `TEACHING-DEFECT(perf-n+1)`). After CHG-5102 each of those patients has about 423 heart-rate readings, so one call is 200 statements and about 42,300 rows, held in one sync gunicorn worker for 14 s uncontended (`nginx-access.log:3`). By 08:02 all 9 workers are busy (`metrics.md`), every other request queues behind them until nginx gives up at 120 s, and the 08:12 restart only emptied the pool until the next tablet refresh (`nginx-access.log:15-17`, `web.error.log:22`). Skills used: `production-rca`, `performance-review`. Guard: `build-timeline.mjs ... --date 2026-09-22 --offset error-log.txt=+03:00 --offset worker.log=+00:00 --collapse` exit 0, `125 events from 9 file(s)`, no PHI-like content. `count-queries.mjs postgres-slow.log`: 15 slow statements, 14 of one shape (`select * from "tabsl observation" where ..."patient" = ? ...`), total 24,321 ms, marked `N+1 suspect`.

### Hypotheses, ranked by evidence (at 08:17)
| # | hypothesis | for | against | verdict |
|---|---|---|---|---|
| H1 | traffic and data change: 100-subject `lastn` from 20 tablets over deep histories, on the 2-queries-per-subject cost model | first slow request is the ward board's at 08:00:31 (13.9 s), then 38.2 s at 08:02:30 and 504 at 08:04:05 (`nginx-access.log:3,7,9`); subjects per call 6 to 100, `lastn` calls 4 to 40 per minute (`metrics.md` 07:55 vs 08:02); every slow Postgres statement is the `lastn` per-subject shape (`count-queries.mjs`) | none so far | leading, high confidence |
| H2 | bad deploy: `spice_telephony` 1.8.0 and its migrate (CHG-5104) | the only deploy of the day, 20 minutes before the start | web healthy for 19 minutes after the 07:41 restart (`nginx-access.log:1-2`, 0.04 to 0.09 s); the change is SMS template wording only (`changes.md:6`); no telephony SQL among the slow statements | unlikely; a rollback would test it but is not expected to help |
| H3 | database degradation | `ke-db-1` CPU 71 to 87%, per-subject statement up to 2.4 s (`metrics.md`, `postgres-slow.log:11-15`) | one statement shape only, the one whose call count the tablets multiplied; checkpoints normal (`postgres-slow.log:2-3`) | consequence of H1; confirm with a `pg_stat_statements` snapshot |
| H4 | memory exhaustion (OOM) on `ke-web-1` | gunicorn prints `was sent SIGKILL! Perhaps out of memory?` (`web.error.log:10,13,17,23`) | each SIGKILL follows `WORKER TIMEOUT` for the same pid about 1 s earlier: the arbiter's SIGABRT-then-SIGKILL for a stuck worker; memory used 55% at 08:16 (`metrics.md`) | unlikely; the kernel log would settle it |
| H5 | queue or Redis failure | `default` backlog 0 to 38 (`redis-queue.txt:3-12`); `send_visit_reminders` killed at 300 s at 08:10 and 08:15 (`worker.log:8,11`; `error-log.txt:3-4` are the same events at +03:00 site time) | Redis memory 3.1 to 3.5 MB, only `default` grows, jobs start on time and run out of time on a saturated database | symptom of H1 |

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| SRE-001 | critical | performance | sample-app/spice_lite/spice_lite/api/fhir.py:155 | `for s in subject_list:` then `frappe.get_doc("SL Patient", s)` (line 165) and `frappe.get_all("SL Observation", ..., fields=["*"])` without a limit (lines 177-182), called with 100 subjects about 40 times a minute by `c017-ward-board/1.0.0` (`nginx-access.log:3-5,7`) | Mitigate now by stopping the tablet traffic (M1). Permanent fix: the set-based, permission-aware `lastn` in `.claude/skills/performance-review/examples/lastn-fix/lastn-set-based.patch` (3 statements for any subject count), through `/bug-fix` after mitigation. |
| SRE-002 | high | design | changes.md:7 | 20 tablets authenticate with one integration user's API token; one client can occupy all 9 sync workers because nothing limits calls per client | After the incident: one API user per integration client and a per-user rate limit on `lastn` (nginx `limit_req` or `frappe.rate_limiter.rate_limit`). |
| SRE-003 | medium | design | worker.log:8 | `rq.timeouts.JobTimeoutException: Task exceeded maximum timeout value (300 seconds)` for `spice_telephony.tasks.send_visit_reminders` at 08:10 and 08:15, `default` backlog 38 at 08:16 | Symptom, not cause: do not purge the queue. After the incident, make the reminder job idempotent per window (`job_id`, `deduplicate=True`). |
| SRE-004 | medium | docs | metrics.md | detection came from the 5xx ratio at 08:09, eight minutes after the first slow calls; no alert on busy gunicorn workers or per-endpoint p95 | After the incident: alert on 8 of 9 workers busy for 2 minutes. |

## Decisions
Mitigate now (G-M: a human chooses and executes; no agent runs these):
- **M1 (recommended)**: ask Clinic KE-C-017 IT to switch off the ward board's auto-refresh. Removes the trigger; expect recovery within one or two minutes of the last in-flight call (they run up to 120 s).
- **M2**: an nginx rule on `ke-web-1` that answers 429 to user agent `c017-ward-board/1.0.0` on `/api/method/spice_lite.api.fhir.lastn`, then `nginx -s reload`. Same effect as M1 without the clinic; a human edits and reloads nginx.
- **M3 (low confidence)**: roll back `spice_telephony` to 1.7.3 (the telephony team offers it). It tests H2, but nothing in the evidence connects CHG-5104 to the slow statements.
- Not recommended: another web restart (buys minutes, `nginx-access.log:15-17`); more gunicorn workers (each 100-subject call still costs 200 statements, and more concurrent calls load the database further).
Fix: set-based `lastn` via `/bug-fix` (step 05 of the spec). Prevent: per-client credentials and rate limits, a busy-worker alert, a query-count test in CI (postmortem).

## Open questions
- G-M: which mitigation will you run (M1, M2 or M3)? Tell the orchestrator what was executed, by whom and when, in UTC.
- Can the DBA capture a `pg_stat_statements` snapshot for 08:00 onwards (calls and rows of the `lastn` per-subject shape)? It settles H3.
- Can on-call run `journalctl -k` on `ke-web-1` for 07:30 onwards and report whether it contains `oom-kill`? It settles H4.

## Artifacts
- none (read-only; handoff returned inline and saved by the orchestrator)
