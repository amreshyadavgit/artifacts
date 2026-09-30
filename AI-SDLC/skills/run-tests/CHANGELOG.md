# Changelog: run-tests skill

Semantic versioning per `skills/README.md`: a change to the output or invocation contract is major, a new capability is minor, a behaviour fix is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with five `allowed-tools` entries (two Maven forms, the summarizer, `date`, `git status`).
- `scripts/summarize-surefire.mjs` and 6 tests.
- Golden cases `skills/run-tests/tests/cases.json` (4 cases).
- Library entry `skills/run-tests/` (this README, CHANGELOG and golden cases). Consumers: no change needed.
