# Threat model: FHIR-lite API (STRIDE summary)

| Asset | Threat | STRIDE | Current control | Gap / agent check |
|---|---|---|---|---|
| Patient records | Unauthenticated read | Spoofing / Info disclosure | Spring Security, all `/fhir/**` authenticated | security agent verifies every new endpoint is covered by the filter chain |
| Patient records | Clinician deletes data | Elevation of privilege | `DELETE` restricted to `ADMIN` | security agent checks role annotations/matchers on new write endpoints |
| Search parameters | SQL injection via `family` / `identifier` | Tampering | Spring Data derived queries (parameterised) | reviewer and security flag any string-concatenated JPQL/SQL |
| Logs | PHI leakage | Info disclosure | `AuditLogger` logs ids only | security agent greps for logging of request bodies or names |
| DB credentials | Secret in repo/manifests | Info disclosure | env vars + k8s `Secret` | hook blocks secret-like strings; security agent scans manifests |
| Availability | Unbounded search / N+1 | Denial of service | page size cap (planned) | sre / performance-review flags missing limits and N+1 |
| Agent tooling | Prompt injection via repo or MCP content | Tampering / Elevation | permissions deny-list, human gates | see `docs/governance/prompt-injection.md` |
