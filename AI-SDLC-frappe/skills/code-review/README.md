# Skill: code-review (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/code-review/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | Platform engineering, reviewer-agent maintainers |
| Consumers | `reviewer` agent (preloaded via `skills: [code-review]`, see module 05-agent-roster), humans via `/code-review` |
| Invocation | `/code-review` (working tree vs `HEAD`) or `/code-review main` (committed work since `main`) |
| Writes files | No. `disallowed-tools: Edit Write NotebookEdit` while the skill is active |
| Golden cases | [tests/cases.json](tests/cases.json) (6 cases, patches in `tests/patches/` and `.claude/skills/code-review/examples/`) |

## What it does
Reviews a git diff of `sample-app/` (Python, DocType JSON, `patches.txt`, `hooks.py`, fixtures) against `context/standards/` and returns findings in the canonical format from `context/standards/review-standards.md` (`id`, `severity`, `category`, `location`, `evidence`, `recommendation`), followed by per-category "no findings" statements and a verdict (`BLOCK`, `NEEDS-DECISION`, `APPROVE`). The checklist carries the Frappe-specific checks: `frappe.get_all` versus `frappe.get_list`, `ignore_permissions`, SQL parameters, whitelist rules (`allow_guest`, `methods=[...]`), PHI in `frappe.log_error` and `frappe.logger(with_more_info=True)`, patches for schema and data changes, fixtures, `frappe.enqueue` options.

## It replaces the bundled `/code-review` in this project
Claude Code ships a bundled `/code-review`. Per the skills docs, a project skill with the same name replaces the bundled command but not its aliases: the bundled `/review` still runs the bundled one. Inside `AI-SDLC-frappe/`, `/code-review` runs this skill.

## Inputs
- The diff, captured when the skill loads by the `` !`git diff ...` `` and `` !`git status --short -- sample-app` `` injections, pre-approved by `allowed-tools`.
- Optional base ref in `$ARGUMENTS`, validated against `^[A-Za-z0-9._/~^-]+$` before use.
- Untracked files do not appear in `git diff`. After `git apply --directory=...`, run `git add -N sample-app` so new files show up.

## Golden patches (measured, not guessed)
Each patch applies to the unmodified app with `git apply --check --directory="$(git rev-parse --show-prefix)"` from `AI-SDLC-frappe/` (without `--directory`, `git apply` skips the `sample-app/...` paths there and still exits 0). With each one applied, `bench --site test.localhost run-tests --app spice_lite` was run under the shared bench lock, and a throwaway `FrappeTestCase` probe measured the behaviour the expected findings describe. All six leave CI green (`Ran 46 tests`, `OK`; 47 for the test-only control): the review, not the build, has to catch the five defective ones. `patient-national-id-no-patch.patch` is green only because `run-tests` does not migrate; on a scratch site after `bench migrate` the same suite gives `Ran 27 tests`, `FAILED (errors=14)`, all `MandatoryError: ... national_id`.

## Output contract
Defined in `.claude/skills/code-review/output-format.md` and enforced by `.claude/skills/code-review/scripts/validate-findings.mjs` (which also rejects a recommendation that suggests switching to `frappe.get_all`).

## How to test
```bash
cd AI-SDLC-frappe
node --test .claude/skills/code-review/scripts/validate-findings.test.mjs
node .claude/skills/code-review/scripts/validate-findings.mjs \
  .claude/skills/code-review/examples/expected-review-front-desk-lookup.md \
  --case skills/code-review/tests/cases.json#cr-01-front-desk-lookup
for p in .claude/skills/code-review/examples/*.patch skills/code-review/tests/patches/*.patch; do
  git apply --check --directory="$(git rev-parse --show-prefix)" "$p" && echo "applies $p"; done
# Live golden cases (needs Claude Code and a model): follow "howToRun" in tests/cases.json
```

## Change policy
- Any change to `SKILL.md`, `review-checklist.md` or `output-format.md` bumps the version in `CHANGELOG.md`.
- A new checklist item needs a golden case whose patch triggers it.
- After any change to `sample-app`, re-run the `git apply --check --directory=...` loop above for every patch and re-measure `testsAfterPatch`.
