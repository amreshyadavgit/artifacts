# Changelog: implementation-plan skill

Semantic versioning per `skills/README.md`: a change to the output or invocation contract is major, a new capability is minor, a behaviour fix is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with `allowed-tools: Read Grep Glob` and `disallowed-tools: Edit Bash`.
- Golden cases `skills/implementation-plan/tests/cases.json` (4 cases) against `workflows/examples/feature-patient-pagination/03-implementation-plan.md`.
- Library entry `skills/implementation-plan/` (this README, CHANGELOG and golden cases). Consumers: no change needed.
