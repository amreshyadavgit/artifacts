# Changelog: ticket-intake skill

Semantic versioning per `skills/README.md`: a change to the output or invocation contract is major, a new capability is minor, a behaviour fix is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with read-only `mcp__atlassian__*` tools allowed and six Jira write tools disallowed.
- Fixture `FHIR-142.synthetic.json` and the reference handoff.
- Golden cases `skills/ticket-intake/tests/cases.json` (4 cases).
- Library entry `skills/ticket-intake/` (this README, CHANGELOG and golden cases). Consumers: no change needed.
