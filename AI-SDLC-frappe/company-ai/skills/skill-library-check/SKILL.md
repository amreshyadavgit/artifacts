---
name: skill-library-check
description: Validate a repository's skill library against the company-ai policy - every .claude/skills/<name>/SKILL.md has name and description front matter, and every skills/<name>/ has README.md, a CHANGELOG.md with a semver heading, and golden cases. Reports errors and warnings; never edits files.
when_to_use: Before opening a PR that adds or changes a skill, before packaging skills into the company-ai plugin, or when asked whether the skill library is healthy.
argument-hint: "[--strict]"
allowed-tools: Read Grep Glob Bash(node *validate-skill-library.mjs*)
disallowed-tools: Edit Write NotebookEdit
---

# Skill library check

Run the validator and explain the result. Do not fix anything unless the user asks in a follow-up message.

1. Pick the validator:
   - If `scripts/governance/validate-skill-library.mjs` exists in the project, run
     `node scripts/governance/validate-skill-library.mjs $ARGUMENTS`.
   - Otherwise run the copy bundled with this plugin:
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-skill-library.mjs" --root "${CLAUDE_PROJECT_DIR}" $ARGUMENTS`.
2. Report the table exactly as printed, then group the `ERROR` lines by skill.
3. For each error, name the file to change and the smallest fix, using the policy in `skills/README.md` when the project has one:
   - missing `name` / `description`: add it to the SKILL.md front matter (hyphenated keys only, for example `allowed-tools`).
   - no semver heading: add `## [1.0.0] - YYYY-MM-DD` to `skills/<name>/CHANGELOG.md`.
   - README version mismatch: bump `Version` in `skills/<name>/README.md` to the latest CHANGELOG entry.
4. End with one line: `verdict: pass` if the validator exited 0, otherwise `verdict: fail (N errors)`.
