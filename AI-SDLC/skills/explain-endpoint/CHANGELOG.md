# Changelog: explain-endpoint skill

Semantic versioning per `skills/README.md`: a change to the output or invocation contract is major, a new capability is minor, a behaviour fix is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with `argument-hint`, `allowed-tools: Read Grep Glob Bash(grep *)` and the route-map injection.
- `reference.md` supporting file, linked from SKILL.md.
- Golden cases `skills/explain-endpoint/tests/cases.json` (4 cases).
- Library entry `skills/explain-endpoint/` (this README, CHANGELOG and golden cases). Consumers: no change needed.
