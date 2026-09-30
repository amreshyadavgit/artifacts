# Changelog: incident skill (Frappe edition)

Semantic versioning per `skills/README.md`: output contract or arguments changed is major, new capability or golden case is minor, wording fixes are a patch.

## 1.0.0 - 2026-09-30
### Added
- Library entry for the runtime skill `.claude/skills/incident/SKILL.md` (spec: `workflows/incident-response.md`, worked run: `docs/capstone/example-runs/incident-lastn-ward-board/`), first released with module `08-workflow-orchestration`.
- `tests/cases.json` with 4 golden cases (3 deterministic, run and passing on 2026-09-30).
- Consumers: no change needed.
