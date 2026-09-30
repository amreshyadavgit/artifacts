# Skill asset: security-review

| | |
|---|---|
| Runtime location | `.claude/skills/security-review/` (`SKILL.md`, `checklist.md`, `report.schema.json`, `scripts/render-report.mjs`, `examples/example-report.json`) |
| Version | 1.0.0 (see `CHANGELOG.md`) |
| Owner | Security guild (course role: `security` agent maintainer) |
| Preloaded by | `security` subagent (`skills: [security-review]`, see module 05-agent-roster) |
| Invoked as | `/security-review [diff \| path \| git-range]` |
| Output | JSON valid against `report.schema.json`, rendered to Markdown by `render-report.mjs` |
| Golden cases | `tests/cases.json` (7 live, 2 deterministic); answer key `tests/expected/sample-app-report.json` |

## What it does
Reviews the FHIR-lite sample app, or a diff, across ten categories: `phi`, `logging-audit`, `authn`, `authz`, `input-validation`, `injection`, `api-security`, `secrets`, `dependencies`, `infrastructure`. PHI is checked first. Every category ends up either with findings or with a `checkedClean` entry that says what was examined.

## Replaces the bundled command
Claude Code ships a bundled `/security-review`. A project skill with the same name replaces it inside this project (see `build/CLAUDE_CODE_FACTS.md`, addendum). Inside `AI-SDLC/`, `/security-review` therefore runs this skill, with this repo's PHI rules and severity scale. Outside the project the bundled one still runs.

## Severity scale
`critical | high | medium | low | info`, calibrated in `SKILL.md` section 3. The rule that matters most in healthcare: PHI disclosed to an unauthorized caller is `critical`; PHI written to an internal sink such as the application log is `high`.

## Using it headless
```bash
cd AI-SDLC
claude -p "/security-review sample-app/" --permission-mode plan \
  --output-format json \
  --json-schema "$(cat .claude/skills/security-review/report.schema.json)" \
  | jq '.structured_output' > /tmp/security-report.json
node .claude/skills/security-review/scripts/render-report.mjs /tmp/security-report.json --out /tmp/security-report.md --fail-on high
```
`--fail-on high` exits `1` when the report has a `high` or `critical` finding, so the same command works as a CI gate.

## Testing the skill
- Deterministic: `sec-08` and `sec-09` in `tests/cases.json` run the renderer only and need no model.
- Live: each live case names a patch, an invocation and the findings that must (and must not) appear. Run them after any edit to `SKILL.md` or `checklist.md` and record the pass rate in `CHANGELOG.md`.
- The answer key lives here, not in `.claude/skills/security-review/`, so the skill cannot read its own expected output while it runs.

## Change policy
- A new category, a schema change or a severity recalibration is a minor version and needs all live cases re-run.
- A schema change that removes or renames a field is a major version: update `render-report.mjs` and every consumer (workflow step, eval harness) in the same change.
