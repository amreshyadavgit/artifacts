---
name: performance-review
description: Performance review of the FHIR-lite sample app or a diff covering SQL statements per request, indexes, N+1 patterns, caching, latency, concurrency and pools, memory, CPU and network. Measures statement counts with a zero-dependency log parser, proposes set-based fixes, and proves them with a query-count test.
when_to_use: When an endpoint is slow or its latency grows with input size, before merging a change that adds a repository call, a loop over entities or a collection endpoint, or when an RCA points at the database.
argument-hint: "[diff | path | endpoint]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(mvn -q -B test *) Bash(node */performance-review/scripts/count-queries.mjs *)
---

# Performance review (measure, then fix)

Scope requested: `$ARGUMENTS`

A performance finding without a number is an opinion. Every `high` finding in this review carries a measurement (statement count, rows read, latency) or states exactly how to take one.

## 1. Scope
- Empty or `diff`: review `git diff` and the code paths it touches, down to the SQL.
- A path: review everything under it.
- An endpoint such as `GET /fhir/Observation/$lastn`: trace controller, service, repository and entity mapping for that endpoint only.
Read `context/architecture/overview.md` (data model and indexes) and `context/standards/coding-standards.md` rule 6 (no queries inside a loop) first.

## 2. Work through the checklist
Use [checklist.md](checklist.md). Cover all nine areas: `queries`, `indexes`, `n+1`, `caching`, `latency`, `concurrency`, `memory`, `cpu`, `network`. An area you checked and found clean is listed under "Checked and clean" with the evidence.

## 3. Measure statements per request
For any endpoint that returns a collection, count SQL statements for a small and a large input. Two ways:

1. **Hibernate statistics in a test** (preferred; it is also the regression test). See [examples/lastn-fix/LastnQueryCountTest.java](examples/lastn-fix/LastnQueryCountTest.java): it enables `hibernate.generate_statistics` with `@TestPropertySource`, clears `Statistics`, calls the endpoint through MockMvc and asserts `getPrepareStatementCount()`.
2. **SQL log plus the helper**. Run the test with `-Dspring.jpa.show-sql=true`, save the output, then:
   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/count-queries.mjs /tmp/lastn.log --from LASTN_BEGIN --to LASTN_QUERY_COUNT
   ```
   It groups statements by shape (literals and `IN (...)` lists collapsed) and marks a `select` shape repeated five or more times as an N+1 suspect. Bound values are never printed.

Never run the application against a database that holds real patient data to take a measurement. Use the H2 test profile or a synthetic dataset.

## 4. Known defect in this repo
`sample-app/src/main/java/org/example/fhir/service/ObservationService.java`, method `lastN`, is marked `TEACHING-DEFECT(perf-n+1)` (see `sample-app/docs/KNOWN_DEFECTS.md`). Report it when it is in scope, with the measured count (2 statements per subject: 40 for 20 subjects), and propose the set-based fix in [examples/lastn-fix/lastn-set-based.patch](examples/lastn-fix/lastn-set-based.patch):
- one native query with `ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY effective_date_time DESC, id DESC)` over `WHERE patient_id IN (:patientIds)`, with a second variant that also filters `code`,
- results re-ordered in Java to match the request order,
- a cap of 100 subjects per request (400 `OperationOutcome` above that).
Do not apply the patch to `sample-app/` unless the task explicitly asks for it (CLAUDE.md rule 6). Propose it, and let the developer agent or the learner apply it in a copy.

## 5. Severity
| Severity | Use when |
|---|---|
| `critical` | Can take the service down under normal production load today (for example a request that holds a connection for tens of seconds at the current traffic) |
| `high` | Cost grows with input or data size on a hot path (N+1, full-history load, missing cap on a list parameter) |
| `medium` | Missing index for an existing query, unbounded result set, pool or timeout misconfiguration |
| `low` | Waste with bounded cost (an unneeded join, an extra existence check) |
| `info` | Observation or measurement you could not take |

## 6. Output
A Markdown section in the handoff format of `workflows/README.md`:

```markdown
## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| PERF-001 | high | n+1 | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69 | ... | ... |

## Measurements
| scenario | statements | rows read | how measured |

## Proposed fix
Patch path, the test that proves it, and the command to run.

## Checked and clean
```

`category` is one of `queries`, `indexes`, `n+1`, `caching`, `latency`, `concurrency`, `memory`, `cpu`, `network`. `location` is `path:line` relative to `AI-SDLC/`. Quote code in `evidence`; do not paraphrase.

## 7. Do not
- Do not recommend a cache before fixing the query shape. A cache in front of an N+1 hides it until the cache misses.
- Do not edit `sample-app/` source or applied migrations (`V1__init.sql` is immutable; new indexes go in `V2__...sql`).
- Do not print SQL bind values or row contents from any log; they can contain PHI.
