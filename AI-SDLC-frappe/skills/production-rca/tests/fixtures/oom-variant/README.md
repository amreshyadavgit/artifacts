# Negative control: the same incident, but the kernel really killed gunicorn

Synthetic. Add `kern.log` to the INC-2026-0922-lastn pack and replace the metrics row for 08:04 to 08:10 with `ke-web-1 mem used 97%`. The two `SIGKILL! Perhaps out of memory?` lines in `web.error.log` (pids 2248 and 2251) now have a matching kernel `Out of memory: Killed process` line within a second. An RCA over the modified pack must move "resource exhaustion (memory)" from rejected to contributing, and explain why: each worker hydrated about 42,000 `select *` rows per request.
