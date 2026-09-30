# Skill: architecture-review (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/architecture-review/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | Platform engineering, architect-agent maintainers |
| Consumers | `architect` agent (preloaded via `skills: [architecture-review]`, see module 05-agent-roster), humans via `/architecture-review <requirement>` |
| Writes files | One ADR draft under `docs/adr/` with `Status: proposed`. `allowed-tools` pre-approves only `Read Grep Glob Bash(git log *)`, so the write goes through the normal permission prompt (or `acceptEdits`). |
| Golden cases | [tests/cases.json](tests/cases.json) (7 requirements) |

## What it does
Turns a requirement into an Architecture Decision Record for the Frappe v15 app `spice_lite` in five steps: requirement analysis; inspection of the existing architecture (`context/architecture/overview.md`, existing ADRs, the path from whitelisted method to mapper, controller, DocType JSON, `hooks.py` and tests, plus the Frappe source where the decision depends on framework behaviour); options along the Frappe axes (core change, country app with Custom Fields and Property Setters, integration app with `required_apps`, core extension point; controller versus `doc_events`; synchronous versus `frappe.enqueue`); risks in the canonical findings format; and a decision with verification. The output follows `docs/adr/0000-template.md` at H2 level and adds `### Requirement`, `### Current architecture (evidence)` and `### Risks`.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure and rules (loaded on invocation) |
| `frappe-options.md` | The decision axes with verified Frappe v15 behaviour for each option |
| `ADR_TEMPLATE.md` | Fill-in template (the only file with angle-bracket placeholders) |
| `checklist.md` | Self-check the skill walks before writing the file |
| `examples/0002-national-health-id-integration-app.md` | Reference ADR for the national health ID requirement (golden case `ar-01`): 4 options, 7 risks, 26 citations, 10 of them into the Frappe source |
| `scripts/validate-adr.mjs` | Structure validator and golden-case grader (zero dependencies); `--repo` resolves repo paths, `--bench` resolves `apps/frappe/...` paths |
| `scripts/validate-adr.test.mjs` | 10 `node:test` tests |

## Human gate
An ADR drafted by the skill is never `accepted`. The tech lead changes the status in the pull request that adds the file. The validator's `--status proposed` flag makes CI reject an agent-drafted ADR that claims otherwise.

## How to test
```bash
cd AI-SDLC-frappe
node --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs
node .claude/skills/architecture-review/scripts/validate-adr.mjs \
  .claude/skills/architecture-review/examples/0002-national-health-id-integration-app.md \
  --repo . --bench /home/user/frappe-bench --status proposed \
  --case skills/architecture-review/tests/cases.json#ar-01-national-health-id
# Live cases: follow "howToRun" in tests/cases.json (needs Claude Code and a model)
```

## Change policy
- Changing required sections in `SKILL.md` or `ADR_TEMPLATE.md` is a major version bump and must be mirrored in `scripts/validate-adr.mjs`.
- If `docs/adr/0000-template.md` changes, update `SECTIONS` in the validator and re-run every golden case.
- Line numbers in `tests/cases.json` `facts` and in the example ADR are tied to the current `sample-app` and to Frappe 15.121.2; `--repo` and `--bench` turn drift into a failing check. Re-check them after a Frappe upgrade.
