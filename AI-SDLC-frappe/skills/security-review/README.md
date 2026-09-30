# Skill asset: security-review

| | |
|---|---|
| Runtime location | `.claude/skills/security-review/` (`SKILL.md`, `checklist.md`, `report.schema.json`, `scripts/render-report.mjs`, `examples/example-report.json`, `probes/test_security_probes.py`, `probes/RUN.md`) |
| Version | 1.0.0 (see `CHANGELOG.md`) |
| Owner | Security guild (course role: `security` agent maintainer) |
| Preloaded by | `security` subagent (`skills: [security-review]`, see module 05-agent-roster) |
| Invoked as | `/security-review [diff \| path \| git-range]` |
| Output | JSON valid against `report.schema.json`, rendered to Markdown by `render-report.mjs` |
| Golden cases | `tests/cases.json`: 6 live, 2 deterministic, 1 bench; answer key `tests/expected/sample-app-report.json` (3 high, 2 medium, 5 low, 1 info) |

## What it does
Reviews `spice_lite`, or a diff, across ten categories (`phi`, `logging-audit`, `authn`, `authz`, `input-validation`, `injection`, `api-security`, `secrets`, `dependencies`, `infrastructure`) with the Frappe behaviour that decides each one written into `SKILL.md` section 3: `get_all` skips permissions, `permission_query_conditions` only affects `get_list`, a 5xx copies locals and `Form Dict` into Error Log and `frappe.log`, Postgres logs failed statements with their values, `track_changes` copies values into Version.

## Replaces the bundled command
Claude Code ships a bundled `/security-review`. A project skill with the same name replaces it inside this project (`build/CLAUDE_CODE_FACTS.md`, addendum). Inside `AI-SDLC-frappe/`, `/security-review` runs this skill with the spice_lite PHI rules and severity scale.

## Findings on the unmodified app (answer key)
| id | severity | what | confirmed by |
|---|---|---|---|
| SEC-001 | high | `lastn` reads `SL Observation` with `frappe.get_all`: User Permissions and `permission_query_conditions` are ignored | probes 1 and 2 |
| SEC-002 | high | a malformed `effective_datetime` makes `create_observation` 500, copying request values into the Error Log traceback, `frappe.log` Form Dict and the Postgres log | probe 5 and the Postgres server log |
| SEC-003 | high | `search_patients` takes `family`/`identifier` in a GET query string, which access logs record | gunicorn and `bench serve` run |
| SEC-004 | medium | `allow_error_traceback` (default 1) returns tracebacks to callers, guests included | curl as guest |
| SEC-005 | medium | 100 subjects per `lastn` call at 2 queries each | query-count test |
| SEC-006..011 | low/info | 403/404 oracle (probe 4), refusals not audited, Version stores PHI (probe 6), `seed_demo` prints keys, no dependency audit, Frappe v15 Postgres support frozen | |

## Using it headless
```bash
cd AI-SDLC-frappe
claude -p "/security-review sample-app/" --permission-mode plan \
  --output-format json \
  --json-schema "$(cat .claude/skills/security-review/report.schema.json)" \
  | jq '.structured_output' > /tmp/security-report.json
node .claude/skills/security-review/scripts/render-report.mjs /tmp/security-report.json --out /tmp/security-report.md --fail-on high
```
`--fail-on high` exits `1` when the report has a `high` or `critical` finding, so the same command works as a CI gate.

## Testing the skill
- Deterministic (no model): `node --test skills/security-review/tests/render-report.test.mjs` (cases `sec-07`, `sec-08`).
- Bench: `sec-09` runs the probes (`.claude/skills/security-review/probes/RUN.md`) and checks that the findings still reproduce.
- Live: `sec-01` to `sec-06` apply a patch (or none), invoke the skill, and compare against `mustFind` / `mustNotFind`. Patches marked EXERCISE-INTRODUCED add a defect that is not in the app. Run them after any edit to `SKILL.md` or `checklist.md` and record the pass rate in `CHANGELOG.md`.
- The answer key lives here, not under `.claude/skills/security-review/`, so the skill cannot read its own expected output while it runs.

## Change policy
- A new category, a schema change or a severity recalibration is a minor version and needs all live cases re-run.
- A schema change that removes or renames a field is a major version: update `render-report.mjs`, the answer key and every consumer (workflow step, eval harness) in the same change.
- Re-run the probes after any Frappe upgrade: SEC-002 and SEC-004 depend on Frappe defaults.
