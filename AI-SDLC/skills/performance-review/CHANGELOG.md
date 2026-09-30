# Changelog: performance-review

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). SemVer: major = output format break, minor = new area or check, patch = wording.

## [1.0.0] - 2026-09-30
### Added
- `SKILL.md`: scope selection, measure-first rule, severity table, handoff output format, `$lastn` defect guidance.
- `checklist.md`: nine areas with repo-specific checks (indexes in `V1__init.sql`, generated SQL shapes, pool and probe defaults, heap sizing).
- `scripts/count-queries.mjs`: statement counter and N+1 detector for Hibernate logs (`--from`, `--to`, `--threshold`, `--json`, `--fail-on-suspect`).
- `examples/lastn-fix/`: `lastn-set-based.patch`, `LastnQueryCountTest.java`, `APPLY.md`, real before/after show-sql excerpts.
- Golden cases `tests/cases.json` (perf-01 to perf-08) and answer key `tests/expected/sample-app-findings.md`.
### Verified (2026-09-30, Java 21, Maven 3.9, Node 22)
- Unpatched scratch copy: `LastnQueryCountTest` 2 of 4 fail, 40 statements for 20 subjects.
- Patched scratch copy: `mvn -q -B test` passes (29 tests), 1 statement for 20 subjects.
- Patched copy still reproduces D-02 (null `effectiveDateTime` returned as latest) and D-03 (duplicate subjects returned twice): the patch is behaviour-preserving.
- `count-queries.mjs`: before log 40 statements / 2 suspects (exit 1 with `--fail-on-suspect`), after log 1 statement / none (exit 0).
### Not yet verified
- Live cases perf-01 to perf-05 need a model run; record the first pass rate here.
