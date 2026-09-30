# Changelog: run-tests skill (Frappe edition)

Semantic versioning per `skills/README.md`: output contract or arguments changed is major, new capability or golden case is minor, wording fixes are a patch.

## 1.0.0 - 2026-09-30
### Added
- Library entry for the runtime skill `.claude/skills/run-tests/` (`SKILL.md`, `scripts/parse_bench_tests.py`, `scripts/test_parse_bench_tests.py`, `scripts/fixtures/` with 9 captured bench outputs), first released with module `02-first-agent-skill-tools`.
- `tests/cases.json` with 8 golden cases (6 deterministic, run and passing on 2026-09-30).
- Consumers: no change needed.
