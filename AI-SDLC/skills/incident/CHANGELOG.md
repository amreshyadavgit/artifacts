# Changelog: incident skill

Semantic versioning per `skills/README.md`: a change to the output or invocation contract is major, a new capability is minor, a behaviour fix is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with `disable-model-invocation: true`, `argument-hint` and a frontmatter SubagentStop hook running `check-handoff.mjs`.
- Golden cases `skills/incident/tests/cases.json` (4 cases) against the committed run `docs/capstone/example-runs/incident-lastn-latency/`.
- Library entry `skills/incident/` (this README, CHANGELOG and golden cases). Consumers: no change needed.
