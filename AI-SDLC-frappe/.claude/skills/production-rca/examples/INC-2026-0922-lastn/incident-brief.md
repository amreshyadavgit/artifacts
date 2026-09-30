# INC-2026-0922-01: spice-ke web degraded, 502/504 on every endpoint

Synthetic incident for the production-rca skill. Every value in this pack is invented. It contains no PHI: `lastn` subject lists are elided by the log exporter, search parameters are elided, Error Log tracebacks were exported with local variables and `Form Dict` removed, and no names, MRNs, birth dates or observation values appear. Document names such as `SLP-04711` are opaque series values, not PHI.

## What the on-call engineer knew when the RCA started
- 2026-09-22 08:09 UTC: alert `SpiceKe5xxRatioHigh` fired (5xx ratio above 5% for 5 minutes on `ke.spice.example`).
- Clinicians at several Kenyan clinics reported the desk "spinning" and "502 Bad Gateway" between about 08:04 and 08:33 UTC. Login pages also timed out.
- On-call restarted the web process at 08:12 (`sudo supervisorctl restart spice-ke-web:`). It helped for about three minutes.
- The telephony team rolled `spice_telephony` back from 1.8.0 to 1.7.3 at 08:20 because it was "the only deploy today". No change.
- Service recovered by 08:34, after Clinic KE-C-017's IT team switched off the auto-refresh of their new ward board tablets at 08:31, at the incident commander's request. The `default` RQ queue drained by 08:48 without any action on Redis or the workers.

## Deployment facts (country deployment `spice-ke`, one site)
- Bench on VM `ke-web-1` (4 vCPU, 16 GiB). Apps: `frappe` 15.121.2, `spice_lite` 0.4.1, `spice_ke` (country app), `spice_telephony` (integration app, `required_apps = ["spice_lite"]`).
- Processes from `bench setup supervisor`: gunicorn `-w 9` (bench default `cpu_count() * 2 + 1`, sync workers) `-t 120 --max-requests 5000`; nginx `proxy_read_timeout 120`; one RQ worker each for `default`, `short`, `long`; scheduler. Logs: `logs/web.error.log` (gunicorn), `logs/worker.log` and `logs/worker.error.log` (RQ, `HH:MM:SS` timestamps, server clock is UTC).
- PostgreSQL 16 on VM `ke-db-1` (8 vCPU, 32 GiB), `log_min_duration_statement = 500ms`. Redis: `redis-cache` on 13000, `redis-queue` on 11000 (bench defaults).
- Site time zone `Africa/Nairobi` (UTC+03:00). **Error Log `creation` values are naive site-local timestamps.**
- `spice_lite.api.fhir.lastn` accepts up to 100 subjects (`MAX_LASTN_SUBJECTS`).

## Evidence files
| File | Source | Clock |
|---|---|---|
| `changes.md` | change calendar | UTC |
| `nginx-access.log` | `/var/log/nginx/ke.spice.example_access.log`, format `timed` (combined + `$request_time $upstream_response_time`) | `+0000` |
| `web.error.log` | gunicorn master and workers (`logs/web.error.log`) | `+0000` |
| `worker.log` | RQ workers (`logs/worker.log` and `logs/worker.error.log`, merged by the exporter) | time only, UTC |
| `redis-queue.txt` | `redis-cli -p 11000 LLEN rq:queue:home-frappe-frappe-bench:<queue>`, sampled every minute | UTC |
| `error-log.txt` | Error Log export (`method`, `creation`, last traceback line) | naive, site local (+03:00) |
| `postgres-slow.log` | PostgreSQL server log on `ke-db-1` | UTC |
| `metrics.md` | node exporter, nginx and Postgres dashboards, 1-minute resolution | UTC |
