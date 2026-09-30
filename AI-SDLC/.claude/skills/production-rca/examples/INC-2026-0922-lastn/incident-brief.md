# INC-2026-0922-01: fhir-lite-api degraded, pods restarting

Synthetic incident for the production-rca skill. Every value in this pack is invented. It contains no PHI: patient ids are replaced by counts, and no names, MRNs, birth dates or observation values appear.

## What the on-call engineer knew when the RCA started
- 2026-09-22 08:09 UTC: alert `FhirLiteApi5xxRatioHigh` fired (5xx ratio above 5% for 5 minutes).
- Clinicians at several clinics reported "patient chart spinner" and "503 Service Unavailable" between about 08:05 and 08:35.
- Both `fhir-lite-api` pods in namespace `clinical-api` restarted several times. Scaling to 4 replicas at 08:17 did not help for long.
- Service recovered by 08:36 after Clinic C-017's IT team disabled the auto-refresh of their new ward dashboard at 08:31, at the incident commander's request.
- No deployment of `fhir-lite-api` happened that day.

## Deployment facts (from `sample-app/k8s/deployment.yaml`, image `fhir-lite-api:0.1.0`)
- 2 replicas, requests `cpu: 250m` / `memory: 384Mi`, limits `cpu: "1"` / `memory: 768Mi`, `JAVA_OPTS=-XX:MaxRAMPercentage=75`.
- Readiness probe `/actuator/health/readiness`, `periodSeconds: 10`, `failureThreshold: 3`; liveness probe `/actuator/health/liveness`, `periodSeconds: 15`, `failureThreshold: 3`; no `timeoutSeconds` (Kubernetes default 1 s).
- Actuator exposes only `health,info` (`application.yml`), so there are no application metrics. Latency numbers come from the ingress controller; database numbers from `pg_stat_statements`.
- HikariCP and Tomcat run with Spring Boot defaults (10 connections per pod, 30 s connection timeout, 200 request threads).

## Evidence files
| File | Source | Notes |
|---|---|---|
| `changes.md` | change calendar | two changes for Clinic C-017 on 2026-09-22 |
| `app-logs.log` | `kubectl logs --prefix --timestamps=false` for both original pods, filtered to WARN/ERROR/AUDIT and lifecycle lines | stack traces trimmed to the first frames |
| `ingress-access.log` | ingress-nginx access log, sampled | `subjects` id lists replaced by a count by the log pipeline |
| `k8s-events.txt` | `kubectl get events -n clinical-api --sort-by=.lastTimestamp -o custom-columns=...` | |
| `pod-describe.txt` | `kubectl describe pod` excerpt, taken 08:40 | |
| `rollout-history.txt` | `kubectl rollout history deployment/fhir-lite-api` | |
| `metrics.md` | Prometheus query results at 1-minute resolution, and a `pg_stat_statements` diff | |
