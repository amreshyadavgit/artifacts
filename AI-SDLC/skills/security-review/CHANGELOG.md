# Changelog: security-review

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow SemVer: major = breaking report schema change, minor = new category or check, patch = wording.

## [1.0.0] - 2026-09-30
### Added
- `SKILL.md` with scope selection (diff, path, range), ten review categories, severity calibration for PHI, evidence and redaction rules.
- `checklist.md` with per-category files to open and Grep patterns for the sample app.
- `report.schema.json` (schemaVersion 1.0) and `scripts/render-report.mjs` (schema validation, count and verdict consistency, synthetic-MRN guard, `--fail-on`).
- `examples/example-report.json` (one-finding format example).
- Golden cases `tests/cases.json` (sec-01 to sec-09) and answer key `tests/expected/sample-app-report.json` (1 high, 5 medium, 3 low, 1 info).
### Verified
- Renderer: sec-08 exits 2, sec-09 exits 1 (run 2026-09-30, Node 22).
- SEC-001 reproduced on H2: a 280-character given name returns 500 and appears in ERROR logs from `SqlExceptionHelper` and `GlobalExceptionHandler`.
### Not yet verified
- Live cases sec-01 to sec-07 need a model run (`claude -p`); record the first pass rate here.
