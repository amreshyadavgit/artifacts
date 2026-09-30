# Skill asset: performance-review

| | |
|---|---|
| Runtime location | `.claude/skills/performance-review/` (`SKILL.md`, `checklist.md`, `scripts/count-queries.mjs`, `examples/lastn-fix/`) |
| Version | 1.0.0 (see `CHANGELOG.md`) |
| Owner | Platform/SRE guild (course role: `sre` agent maintainer) |
| Preloaded by | `sre` subagent (`skills: [performance-review, production-rca]`, see module 05-agent-roster) |
| Invoked as | `/performance-review [diff \| path \| endpoint]` |
| Output | Findings table, measurements table, proposed fix, checked-and-clean list (Markdown, handoff format) |
| Golden cases | `tests/cases.json` (5 live, 3 deterministic); answer key `tests/expected/sample-app-findings.md` |

## What it does
Reviews nine areas: `queries`, `indexes`, `n+1`, `caching`, `latency`, `concurrency`, `memory`, `cpu`, `network`. Every `high` finding carries a number. The skill ships the tools to get that number:

- `scripts/count-queries.mjs`: zero-dependency Node 22 parser for Hibernate SQL logs. Groups statements by shape, flags repeated `select` shapes as N+1 suspects, never prints bind values. `--fail-on-suspect` exits 1, so it can gate CI.
- `examples/lastn-fix/LastnQueryCountTest.java`: a Hibernate-statistics query-count test for `$lastn` (the "performance smoke" row of `context/standards/testing-standards.md`).
- `examples/lastn-fix/lastn-set-based.patch`: the set-based fix for `TEACHING-DEFECT(perf-n+1)`, verified in a scratch copy: 40 statements before, 1 after, 29 tests passing.

## Testing the skill
- Deterministic cases (`perf-06` to `perf-08`) run the helper against the committed log excerpts and need no model.
- Live cases give an invocation (and sometimes a patch) plus the findings that must appear. Re-run them after editing `SKILL.md` or `checklist.md`.

## Change policy
- Changing the N+1 threshold default or the output columns is a minor version; update `tests/cases.json` in the same change.
- The patch and the test must be re-verified against `sample-app` whenever the app changes (`APPLY.md` has the exact commands).
