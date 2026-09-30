# Changelog: production-rca

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). SemVer: major = template or output contract break, minor = new section, rule or evidence type, patch = wording.

## [1.0.0] - 2026-09-30
### Added
- `SKILL.md`: evidence guard first, read-only cluster access, analysis order, reasoning rules (exit codes, probe timeouts, quantification), output as a `needs-human` handoff.
- `rca-template.md`: 11 sections from summary to open questions, with clinical safety and PHI exposure in the impact table.
- `scripts/build-timeline.mjs`: multi-format timestamp merge, `--from`, `--to`, `--grep`, `--collapse`, `--json`, PHI guard (exit 3).
- `examples/INC-2026-0922-lastn/`: synthetic evidence pack (brief, change calendar, app logs, ingress log, k8s events, pod describe, rollout history, metrics with pg_stat_statements).
- Golden cases `tests/cases.json` (rca-01 to rca-08) and answer key `tests/expected/INC-2026-0922-01-rca.md`.
### Verified (2026-09-30, Node 22)
- rca-06: 86 events from 8 files, exit 0. rca-07: exit 3 with `rca07.log:1: MRN value`. rca-08: 8 Killing events, first at 08:05:48.
- The whole evidence pack passes the PHI guard.
### Not yet verified
- Live cases rca-01 to rca-05 need a model run; record the first pass rate here.
