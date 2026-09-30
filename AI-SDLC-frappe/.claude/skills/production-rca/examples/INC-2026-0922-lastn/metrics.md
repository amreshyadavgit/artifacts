# Metrics excerpt, 2026-09-22 (UTC)

Sources: node exporter on `ke-web-1` and `ke-db-1`, an nginx log-derived dashboard, `pg_stat_statements` snapshots, and `supervisorctl status`. 1-minute resolution unless noted. There is no gunicorn metrics endpoint; "busy workers" comes from the gunicorn `procname` status sampled with `ps` every minute.

| time (UTC) | lastn req/min (all clients) | lastn subjects per req (median) | p95 lastn s | p95 other /api s | 5xx ratio | busy gunicorn workers (of 9) | ke-web-1 CPU | ke-web-1 mem used | ke-db-1 CPU | db active conns | RQ default backlog |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 07:55 | 4 | 6 | 0.09 | 0.06 | 0.0% | 1 | 11% | 41% | 9% | 3 | 0 |
| 08:00 | 22 | 100 | 14.2 | 0.07 | 0.0% | 4 | 48% | 44% | 38% | 7 | 0 |
| 08:02 | 40 | 100 | 38.9 | 1.9 | 0.0% | 9 | 97% | 49% | 71% | 13 | 1 |
| 08:04 | 41 | 100 | 120.0 | 60.2 | 7.8% | 9 | 99% | 53% | 83% | 14 | 4 |
| 08:06 | 40 | 100 | 120.0 | 118.7 | 21.5% | 9 | 99% | 56% | 86% | 14 | 9 |
| 08:10 | 40 | 100 | 120.0 | 120.0 | 34.0% | 9 | 99% | 57% | 87% | 14 | 22 |
| 08:13 | 39 | 100 | 16.8 | 0.9 | 2.1% | 6 | 81% | 43% | 62% | 10 | 30 |
| 08:16 | 40 | 100 | 120.0 | 112.5 | 29.4% | 9 | 99% | 55% | 86% | 14 | 38 |
| 08:20 | 40 | 100 | 120.0 | 120.0 | 36.2% | 9 | 99% | 58% | 88% | 14 | 51 |
| 08:25 | 40 | 100 | 120.0 | 120.0 | 35.7% | 9 | 99% | 58% | 87% | 14 | 65 |
| 08:30 | 38 | 100 | 120.0 | 119.1 | 33.9% | 9 | 99% | 58% | 86% | 14 | 79 |
| 08:32 | 3 | 7 | 58.9 | 4.2 | 6.0% | 5 | 52% | 47% | 40% | 8 | 81 |
| 08:34 | 4 | 6 | 0.10 | 0.07 | 0.0% | 2 | 19% | 42% | 14% | 4 | 64 |
| 08:40 | 4 | 6 | 0.09 | 0.06 | 0.0% | 1 | 12% | 41% | 10% | 3 | 26 |

Memory: `ke-web-1` has 16 GiB; peak used 58% at 08:20. `journalctl -k` on `ke-web-1` for 07:30 to 08:45 contains no `Out of memory` or `oom-kill` lines.

## pg_stat_statements (shape of the lastn per-subject query, `select * from "tabSL Observation" where "tabSL Observation"."patient" = $1 and ... order by effective_datetime desc, creation desc`)
| snapshot (UTC) | calls since previous | mean ms | rows since previous |
|---|---|---|---|
| 07:00 to 08:00 | 1,212 | 1.9 | 5,030 |
| 08:00 to 08:31 | 118,400 | 176.4 | 50,080,000 |
| 08:31 to 09:00 | 1,190 | 2.1 | 4,960 |

The same shape of `select * from "tabSL Patient" where "name" = $1 limit 1` (from `frappe.get_doc`) shows 118,410 calls between 08:00 and 08:31 at a mean of 0.4 ms.

## Redis (`redis-queue`, port 11000)
`used_memory` 3.1 to 3.8 MB during the window (see `redis-queue.txt`), `connected_clients` 24 to 27, no evictions, no `rejected_connections`. `redis-cache` (13000): hit ratio 0.97, unchanged.

## Other checks
- `supervisorctl status` at 08:25: all programs RUNNING (web, three workers, scheduler, socketio).
- Replication lag on the Postgres standby stayed under 1 s. No lock waits over 1 s in `pg_locks` samples.
