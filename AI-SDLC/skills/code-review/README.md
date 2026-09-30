# Skill: code-review

| | |
|---|---|
| Runtime location | `.claude/skills/code-review/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | Platform engineering, reviewer-agent maintainers |
| Consumers | `reviewer` agent (preloaded via `skills: [code-review]`, see module 05-agent-roster), humans via `/code-review` |
| Invocation | `/code-review` (working tree vs `HEAD`) or `/code-review main` (committed work since `main`) |
| Writes files | No. `disallowed-tools: Edit Write NotebookEdit` while the skill is active |
| Golden cases | [tests/cases.json](tests/cases.json) (6 cases, patches in `tests/patches/`) |

## What it does
Reviews a git diff of `sample-app/` against `context/standards/` and returns findings in the canonical format from `context/standards/review-standards.md`: `id`, `severity`, `category`, `location`, `evidence`, `recommendation`, followed by per-category "no findings" statements and a verdict (`BLOCK`, `NEEDS-DECISION`, `APPROVE`).

## It replaces the bundled `/code-review` in this project
Claude Code ships a bundled `/code-review`. Per the skills docs, a project skill with the same name replaces the bundled command (but not its aliases; the bundled alias `/review` still runs the bundled one). Inside `AI-SDLC/`, `/code-review` therefore runs this skill. Outside the project, the bundled one runs. If you want both, rename this skill (for example `standards-review`).

## Inputs
- The diff, captured when the skill loads by the `` !`git diff ...` `` and `` !`git status --short` `` injections. They are pre-approved by `allowed-tools` (`Bash(git diff *)`, `Bash(git status *)`) and by `permissions.allow` in `.claude/settings.json`.
- Optional base ref in `$ARGUMENTS`, validated against `^[A-Za-z0-9._/~^-]+$` before use.
- Untracked files do not appear in `git diff`. After `git apply`, run `git add -N sample-app` so new files show up, or rely on the skill reading `??` entries from `git status`.

## Output contract
Defined in `.claude/skills/code-review/output-format.md` and enforced by `.claude/skills/code-review/scripts/validate-findings.mjs`.

## How to test
```bash
cd AI-SDLC
# 1. Validator unit tests (no model needed)
node --test .claude/skills/code-review/scripts/validate-findings.test.mjs
# 2. The shipped expected report passes its golden case
node .claude/skills/code-review/scripts/validate-findings.mjs \
  .claude/skills/code-review/examples/expected-review-patient-by-name.md \
  --case skills/code-review/tests/cases.json#cr-01-jpql-concat-entity-return
# 3. Live golden cases (needs Claude Code and a model): follow "howToRun" in tests/cases.json for each case
```

## Change policy
- Any change to `SKILL.md`, `review-checklist.md` or `output-format.md` bumps the version in `CHANGELOG.md`.
- A new check in the checklist needs a golden case whose patch triggers it.
- Re-run all golden cases before release; the reviewer agent's eval (module 09-agent-evaluation) depends on this skill.
