# Changelog: bug-fix skill

Semantic versioning per `skills/README.md`: a change to the output or invocation contract is major, a new capability is minor, a behaviour fix is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with `disable-model-invocation: true`, `argument-hint` and a frontmatter SubagentStop hook running `check-handoff.mjs`.
- Golden cases `skills/bug-fix/tests/cases.json` (4 cases).
- Library entry `skills/bug-fix/` (this README, CHANGELOG and golden cases). Consumers: no change needed.
