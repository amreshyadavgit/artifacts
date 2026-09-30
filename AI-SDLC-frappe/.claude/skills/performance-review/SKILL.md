---
name: performance-review
description: Performance review of the spice_lite Frappe app or a diff covering SQL statements per request, indexes and search_index, N+1 loops over frappe.get_doc/get_all, frappe.cache, latency, concurrency (gunicorn sync workers, RQ queues and timeouts), memory, CPU and network. Measures statement counts with a query-count test and a zero-dependency log parser, proposes set-based permission-aware fixes, and proves them with assertQueryCount.
when_to_use: When a whitelisted method is slow or its latency grows with input size, before merging a change that adds a query inside a loop, a list endpoint, a report or a frappe.enqueue job, or when an RCA points at the database, gunicorn workers or an RQ queue.
argument-hint: "[diff | path | method]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(node ${CLAUDE_SKILL_DIR}/scripts/count-queries.mjs *)
---

# Performance review (measure, then fix)

Scope requested: `$ARGUMENTS`

A performance finding without a number is an opinion. Every `high` finding carries a measurement (statements per request, rows returned, duration) or states exactly how to take one.

## 1. Scope
- Empty or `diff`: review `git diff` and the code paths it touches, down to the SQL Frappe generates.
- A path: review everything under it.
- A whitelisted method such as `spice_lite.api.fhir.lastn`: trace `/api/method/<path>` to the function, every `frappe.get_doc`, `get_list`, `get_all`, `db.*` and `qb` call it makes, the controller methods and `doc_events` those trigger, and the indexes the queries need.
Read `context/architecture/overview.md` (DocTypes, process model) and `context/standards/frappe-coding-standards.md` rules 5, 7 and 8 (no queries in loops, background jobs, caching) first.

## 2. Work through the checklist
Use [checklist.md](checklist.md). Cover all nine areas: `queries`, `indexes`, `n+1`, `caching`, `latency`, `concurrency`, `memory`, `cpu`, `network`. An area you checked and found clean goes under "Checked and clean" with the evidence.

## 3. Measure statements per request
For any method that returns a collection, count SQL statements for a small and a large input. A constant count is fine; a count that grows with the input is an N+1.

1. **Query-count test** (preferred; it becomes the regression test). [examples/lastn-fix/test_lastn_query_count.py](examples/lastn-fix/test_lastn_query_count.py) wraps `frappe.db.sql`, prints `LASTN_QUERY_COUNT subjects=N queries=Q rows_returned_by_sql=R` for 1, 20 and 100 subjects, and asserts `with self.assertQueryCount(6)`. This skill never runs it itself (it has no Bash pre-approval for `bench`, and the sre agent that preloads it is read-only). Put a **query-count test request** in your handoff instead: the test file to copy into `sample-app/spice_lite/spice_lite/tests/`, the command `CI=1 bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_query_count`, and the numbers you expect. The tester agent (or a human) copies it, runs it, reports the `LASTN_QUERY_COUNT` lines and deletes it. The proof is the test's own counter around `frappe.db.sql`, not Frappe's helper: on Postgres, `FrappeTestCase.assertQueryCount` crashes in Frappe v15 with `TypeError: sequence item 0: expected str instance, LazyDecode found` even when the count is under the limit (`sample-app/docs/KNOWN_DEFECTS.md` D-10). The file also carries `PostgresQueryCountMixin`, which makes `assertQueryCount` usable as a second check.
2. **Statement log plus the helper.** The test prints every statement of the 20-subject call between `LASTN_BEGIN` and `LASTN_END`. When the tester's saved output (or a Postgres log from an evidence pack) is available, run:
   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/count-queries.mjs /tmp/lastn.out --from LASTN_BEGIN --to LASTN_END
   ```
   The same helper reads a Postgres server log (`log_min_duration_statement`), sums durations per shape, and marks a `select` shape repeated five or more times as an N+1 suspect. Literals are masked, so names and values are never printed.

Never measure against a site that holds real patient data. Use `test.localhost` and synthetic records inside a `FrappeTestCase` (rolled back at class end).

## 4. Known defect in this repo
`sample-app/spice_lite/spice_lite/api/fhir.py`, function `lastn`, is marked `TEACHING-DEFECT(perf-n+1)` (see `sample-app/docs/KNOWN_DEFECTS.md`, T-1). Report it when it is in scope, with the measured numbers: **2 queries per subject (2, 40, 200 for 1, 20, 100 subjects) and 5 rows per subject with 4 matching observations each**. Propose [examples/lastn-fix/lastn-set-based.patch](examples/lastn-fix/lastn-set-based.patch):
- one permission-aware `frappe.get_list("SL Patient", filters={"name": ("in", subjects)}, pluck="name")` that drops unknown and forbidden subjects,
- one permission-aware `frappe.get_list` on `SL Observation` with `max(effective_datetime)` grouped by patient, then one more for only the rows at those timestamps with explicit fields,
- results in request order; the `(">", "1900-01-01 00:00:00")` filter stays (D-2).
Measured after the patch: **3 queries for 1, 20 or 100 subjects**, 3 rows per subject, full suite 49 tests OK on Postgres, and the same counts on MariaDB. It also closes the security finding on `frappe.get_all` in the same loop (security-review SEC-001). See [examples/lastn-fix/APPLY.md](examples/lastn-fix/APPLY.md).

Do not apply the patch to `sample-app/` unless the task explicitly asks for it (CLAUDE.md rule 8). Propose it; the developer agent or the learner applies it and reverts.

## 5. Severity
| Severity | Use when |
|---|---|
| `critical` | Can take a site down under normal production load today: a request that holds a gunicorn sync worker for tens of seconds at current traffic, a job that exceeds its queue timeout on every run |
| `high` | Cost grows with input or data size on a hot path: N+1, full-history reads, a list parameter without a cap |
| `medium` | A missing index for an existing query, an unbounded result set, a queue or timeout misconfiguration |
| `low` | Waste with bounded cost: `fields=["*"]` where two columns are needed, an extra existence check |
| `info` | An observation, or a measurement you could not take |

## 6. Output
A Markdown section in the handoff format of `workflows/README.md`:

```markdown
## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| PERF-001 | high | n+1 | sample-app/spice_lite/spice_lite/api/fhir.py:155-184 | ... | ... |

## Measurements
| scenario | statements | rows returned | how measured |

## Test request (for the tester)
Test file, `CI=1 bench --site test.localhost run-tests --module ...` command, expected `LASTN_QUERY_COUNT` numbers.

## Proposed fix
Patch path, the test that proves it, and the command to run.

## Checked and clean
```

`category` is one of `queries`, `indexes`, `n+1`, `caching`, `latency`, `concurrency`, `memory`, `cpu`, `network`. `location` is `path:line` relative to `AI-SDLC-frappe/`. Quote code in `evidence`; do not paraphrase.

## 7. Do not
- Do not recommend `frappe.cache` or `@redis_cache` before fixing the query shape. A cache in front of an N+1 hides it until the cache misses, and cached clinical rows are PHI in Redis.
- Do not "fix" permissions away for speed: `frappe.qb`, `frappe.db.sql` and `frappe.get_all` are faster to write and skip permissions. A set-based fix stays on `frappe.get_list` unless the permission check is re-done explicitly.
- Do not edit `sample-app/` source or run `bench --site * migrate` on a shared site. New indexes ship as a patch in `patches.txt` or a `search_index` change, reviewed like any schema change.
- Do not print SQL values or row contents from any log; they can contain PHI.
