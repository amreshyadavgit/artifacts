# Changelog: code-review skill (Frappe edition)

Semantic versioning: a change to the output format is major, a new check or golden case is minor, wording fixes are a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md` with diff injection (`git diff --stat HEAD -- sample-app`, `git status --short -- sample-app`, `git diff HEAD -- sample-app`), optional validated base ref in `$ARGUMENTS`, `disallowed-tools: Edit Write NotebookEdit`, and a step that pairs DocType JSON changes with `patches.txt`.
- `review-checklist.md`: Frappe checks for the eight review categories, each tied to a rule in `context/standards/`, the PHI policy or `.claude/rules/doctype-json.md`.
- `output-format.md`: findings table, details, categories checked, verdict.
- `scripts/validate-findings.mjs` (+ 9 tests): structure validator, golden-case grader, and a lint against recommending `frappe.get_all`.
- `examples/front-desk-lookup.patch` and `examples/expected-review-front-desk-lookup.md` (11 findings, verdict BLOCK), with probe results measured on the bench.
- Golden cases `tests/cases.json` (6 cases: guest lookup with f-string SQL, `get_all` without permission check, `reqd` DocType field without a patch, observation values in the Error Log, `with_more_info=True` on the audit logger, and a false-positive control).
