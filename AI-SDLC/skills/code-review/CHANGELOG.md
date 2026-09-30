# Changelog: code-review skill

All notable changes to `.claude/skills/code-review/`. Versions follow semantic versioning: a change to the output format is a major bump, a new check or golden case is a minor bump, wording fixes are a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with diff injection (`git diff --stat HEAD`, `git status --short`, `git diff HEAD -- sample-app`), optional validated base ref in `$ARGUMENTS`, and `disallowed-tools: Edit Write NotebookEdit`.
- `review-checklist.md`: checks for the eight review categories, each tied to a rule in `context/standards/` or the PHI policy.
- `output-format.md`: findings table, details, categories checked, verdict.
- `scripts/validate-findings.mjs` (+ `validate-findings.test.mjs`, 8 tests): structure validator and golden-case grader.
- `examples/patient-by-name.patch` and `examples/expected-review-patient-by-name.md` (10 findings, verdict BLOCK).
- Golden cases `skills/code-review/tests/cases.json` (6 cases, including one false-positive control).
