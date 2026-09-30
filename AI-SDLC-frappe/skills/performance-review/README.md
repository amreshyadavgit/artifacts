# Skill asset: performance-review

| | |
|---|---|
| Runtime location | `.claude/skills/performance-review/` (`SKILL.md`, `checklist.md`, `scripts/count-queries.mjs`, `examples/lastn-fix/{APPLY.md, lastn-set-based.patch, test_lastn_query_count.py, sql-before.log, sql-after.log}`) |
| Version | 1.0.0 (see `CHANGELOG.md`) |
| Owner | Platform team (course role: `sre` agent maintainer) |
| Preloaded by | `sre` subagent (`skills: [performance-review, production-rca]`, see module 05-agent-roster) |
| Invoked as | `/performance-review [diff \| path \| method]` |
| Output | Findings, measurements, proposed fix and checked-clean sections in the handoff format of `workflows/README.md` |
| Golden cases | `tests/cases.json`: 4 live, 2 deterministic, 1 bench; answer key `tests/expected/sample-app-findings.md` |

## What it does
Reviews queries per request, indexes (including the Frappe v15 Postgres index-name trap, KNOWN_DEFECTS.md D-6), N+1 loops, `frappe.cache` use, latency, gunicorn and RQ concurrency, memory, CPU and network. It insists on a number for every `high` finding and ships the instruments to take one: a query-count test and a statement-log parser.

## The lastn proof in one table
| | 1 subject | 20 subjects | 100 subjects | suite |
|---|---|---|---|---|
| shipped app | 2 queries | 40 | 200 | 46 OK |
| `lastn-set-based.patch` | 3 | 3 | 3 | 49 OK (46 + 3 new) |

Measured on test.localhost (PostgreSQL 16) and repeated on mariadb.localhost; the patch was reverted afterwards (`git status --short sample-app` empty).

## Testing the skill
- Deterministic: `node --test skills/performance-review/tests/count-queries.test.mjs` (perf-05) and the `--fail-on-suspect` gate on the captured log (perf-06).
- Bench: perf-07 is the apply, test, revert sequence in `examples/lastn-fix/APPLY.md`.
- Live: perf-01 to perf-04, including a negative control (perf-03: no N+1 finding once the patch is applied).

## Change policy
- A new area or a severity recalibration is a minor version.
- Re-measure and update `sql-before.log`, `sql-after.log` and the numbers above after any change to `lastn`, the patch, or a Frappe upgrade (the generated SQL changes between Frappe versions).
