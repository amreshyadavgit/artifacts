# Metrics excerpt, 2026-09-22 (UTC)

Sources: Prometheus (ingress-nginx, kube-state-metrics, cAdvisor) at 1-minute resolution, and `pg_stat_statements` snapshots. The application exposes no metrics endpoint (`management.endpoints.web.exposure.include: health,info`).

## Queries
| Column | PromQL |
|---|---|
| lastn_rps | `sum(rate(nginx_ingress_controller_requests{exported_service="fhir-lite-api",path="/fhir/Observation/$lastn"}[1m]))` |
| lastn_p95_s | `histogram_quantile(0.95, sum by (le) (rate(nginx_ingress_controller_request_duration_seconds_bucket{exported_service="fhir-lite-api",path="/fhir/Observation/$lastn"}[1m])))` |
| other_p95_s | same as above with `path!="/fhir/Observation/$lastn"` |
| error_ratio | `sum(rate(nginx_ingress_controller_requests{exported_service="fhir-lite-api",status=~"5.."}[1m])) / sum(rate(nginx_ingress_controller_requests{exported_service="fhir-lite-api"}[1m]))` |
| ready_pods | `sum(kube_pod_status_ready{namespace="clinical-api",pod=~"fhir-lite-api-.*",condition="true"})` |
| restarts | `sum(kube_pod_container_status_restarts_total{namespace="clinical-api",pod=~"fhir-lite-api-.*"})` (cumulative since 07:56) |
| cpu_throttled | `max(rate(container_cpu_cfs_throttled_periods_total{namespace="clinical-api",container="api"}[1m]) / rate(container_cpu_cfs_periods_total{namespace="clinical-api",container="api"}[1m]))` |
| mem_ws_mi | `max(container_memory_working_set_bytes{namespace="clinical-api",container="api"}) / 2^20` (limit 768) |
| db_conns | `sum(pg_stat_activity_count{datname="fhir",state="active"})` |

## Results
Ingress `proxy-read-timeout` is 60 s, so `lastn_p95_s` saturates at 60.

| time | lastn_rps | lastn_p95_s | other_p95_s | error_ratio | ready_pods | restarts | cpu_throttled | mem_ws_mi | db_conns |
|---|---|---|---|---|---|---|---|---|---|
| 07:56 | 0.09 | 0.18 | 0.04 | 0.001 | 2 | 0 | 0.02 | 598 | 3 |
| 07:58 | 0.10 | 0.19 | 0.04 | 0.001 | 2 | 0 | 0.02 | 601 | 3 |
| 08:00 | 0.12 | 0.19 | 0.04 | 0.001 | 2 | 0 | 0.03 | 604 | 5 |
| 08:01 | 0.86 | 36.9 | 0.31 | 0.002 | 2 | 0 | 0.64 | 721 | 20 |
| 08:02 | 0.91 | 50.4 | 4.8 | 0.021 | 2 | 0 | 0.78 | 749 | 20 |
| 08:03 | 0.94 | 60.0 | 19.7 | 0.118 | 2 | 0 | 0.81 | 752 | 20 |
| 08:04 | 0.97 | 60.0 | 58.2 | 0.371 | 2 | 0 | 0.83 | 755 | 20 |
| 08:05 | 1.12 | 60.0 | 60.0 | 0.886 | 0 | 0 | 0.79 | 757 | 20 |
| 08:06 | 1.20 | 60.0 | 0.00 | 1.000 | 0 | 2 | 0.41 | 402 | 4 |
| 08:07 | 1.18 | 10.2 | 0.06 | 0.412 | 1 | 2 | 0.58 | 588 | 12 |
| 08:08 | 1.15 | 44.7 | 3.9 | 0.203 | 2 | 2 | 0.80 | 739 | 20 |
| 08:10 | 1.09 | 60.0 | 46.1 | 0.522 | 1 | 2 | 0.84 | 756 | 20 |
| 08:12 | 1.21 | 60.0 | 0.07 | 0.644 | 1 | 4 | 0.62 | 611 | 11 |
| 08:15 | 1.06 | 60.0 | 21.3 | 0.297 | 2 | 4 | 0.82 | 752 | 20 |
| 08:17 | 1.04 | 60.0 | 38.8 | 0.402 | 2 | 4 | 0.83 | 754 | 20 |
| 08:19 | 1.02 | 49.6 | 12.9 | 0.187 | 4 | 4 | 0.79 | 748 | 40 |
| 08:22 | 1.10 | 60.0 | 44.0 | 0.463 | 2 | 6 | 0.84 | 757 | 21 |
| 08:25 | 1.13 | 60.0 | 17.5 | 0.338 | 3 | 8 | 0.80 | 751 | 30 |
| 08:28 | 1.07 | 60.0 | 22.6 | 0.305 | 3 | 8 | 0.82 | 753 | 30 |
| 08:31 | 0.96 | 60.0 | 19.8 | 0.284 | 3 | 8 | 0.81 | 750 | 30 |
| 08:32 | 0.31 | 60.0 | 6.2 | 0.121 | 4 | 8 | 0.66 | 744 | 26 |
| 08:33 | 0.11 | 57.8 | 0.9 | 0.024 | 4 | 8 | 0.21 | 702 | 9 |
| 08:34 | 0.10 | 0.21 | 0.05 | 0.002 | 4 | 8 | 0.03 | 655 | 4 |
| 08:36 | 0.09 | 0.20 | 0.04 | 0.001 | 4 | 8 | 0.02 | 649 | 3 |
| 08:40 | 0.10 | 0.19 | 0.04 | 0.001 | 4 | 8 | 0.02 | 646 | 3 |

Traffic volume for the incident window 08:04:00 to 08:36:00: 29,412 requests through the ingress, 9,847 answered with 5xx (33.5%). Requests from `c017-ward-dashboard/2.3.0`: 1,876 (6.4% of requests, including client retries).

## PostgreSQL: pg_stat_statements, diff between snapshots
Captured with `SELECT queryid, calls, total_exec_time, rows, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 5` at 07:30, 08:00 and 08:31.

### 07:30 to 08:00 (baseline)
| calls | total_exec_ms | mean_ms | rows | query |
|---|---|---|---|---|
| 24,118 | 1,037 | 0.04 | 24,118 | `select p1_0.id,p1_0.active,p1_0.birth_date,p1_0.family_name,p1_0.gender,p1_0.given_names,p1_0.mrn,p1_0.mrn_system from patient p1_0 where p1_0.id=$1` |
| 3,902 | 1,561 | 0.40 | 55,021 | `select o1_0.id,o1_0.code,... from observation o1_0 join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=$1 order by o1_0.effective_date_time desc` |
| 1,288 | 116 | 0.09 | 1,288 | `insert into observation (code,code_display,code_system,effective_date_time,patient_id,status,value_quantity,value_unit,id) values ($1,$2,$3,$4,$5,$6,$7,$8,default)` |

### 08:00 to 08:31 (incident)
| calls | total_exec_ms | mean_ms | rows | query |
|---|---|---|---|---|
| 431,616 | 699,218 | 1.62 | 176,099,328 | `select o1_0.id,o1_0.code,... from observation o1_0 join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=$1 order by o1_0.effective_date_time desc` |
| 456,518 | 18,261 | 0.04 | 456,518 | `select p1_0.id,p1_0.active,p1_0.birth_date,p1_0.family_name,p1_0.gender,p1_0.given_names,p1_0.mrn,p1_0.mrn_system from patient p1_0 where p1_0.id=$1` |
| 402 | 38 | 0.09 | 402 | `insert into observation (...) values (...)` |

Database host CPU (node exporter): 22% at 07:58, peak 61% at 08:20 (4 replicas), 20% at 08:40. No lock waits above 10 ms (`pg_locks` sampled every 30 s). Replication lag below 1 s throughout.
