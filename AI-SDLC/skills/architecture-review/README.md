# Skill: architecture-review

| | |
|---|---|
| Runtime location | `.claude/skills/architecture-review/SKILL.md` |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | Platform engineering, architect-agent maintainers |
| Consumers | `architect` agent (preloaded via `skills: [architecture-review]`, see module 05-agent-roster), humans via `/architecture-review <requirement>` |
| Writes files | One ADR draft under `docs/adr/` with `Status: proposed`. `allowed-tools` pre-approves only `Read Grep Glob Bash(git log *)`, so the write goes through the normal permission prompt (or `acceptEdits`). |
| Golden cases | [tests/cases.json](tests/cases.json) (6 requirements) |

## What it does
Turns a requirement into an Architecture Decision Record in five steps: requirement analysis, inspection of the existing architecture (`context/architecture/overview.md`, existing ADRs, the code path with `path:line` evidence), options and trade-offs, risks in the canonical findings format, and a decision with verification. The output follows `docs/adr/0000-template.md` exactly at H2 level; the skill adds `### Requirement`, `### Current architecture (evidence)` and `### Risks` sub-sections.

## Files
| File | Purpose |
|---|---|
| `SKILL.md` | Procedure and rules (loaded on invocation) |
| `ADR_TEMPLATE.md` | Fill-in template (the only file with angle-bracket placeholders) |
| `checklist.md` | Self-check the skill walks before writing the file |
| `examples/0002-paginate-patient-search.md` | Reference output for the pagination requirement (golden case `ar-01`) |
| `scripts/validate-adr.mjs` | Structure validator and golden-case grader (zero dependencies) |
| `scripts/validate-adr.test.mjs` | 8 `node:test` tests for the validator |

## Human gate
An ADR drafted by the skill is never `accepted`. The tech lead changes the status in the pull request that adds the file. The validator's `--status proposed` flag makes CI reject an agent-drafted ADR that claims otherwise.

## How to test
```bash
cd AI-SDLC
node --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs
node .claude/skills/architecture-review/scripts/validate-adr.mjs \
  .claude/skills/architecture-review/examples/0002-paginate-patient-search.md \
  --repo . --status proposed --case skills/architecture-review/tests/cases.json#ar-01-patient-search-pagination
# Live cases: follow "howToRun" in tests/cases.json (needs Claude Code and a model)
```

## Change policy
- Changing required sections in `SKILL.md` or `ADR_TEMPLATE.md` is a major version bump and must be mirrored in `scripts/validate-adr.mjs`.
- If `docs/adr/0000-template.md` changes, update `SECTIONS` in the validator and re-run every golden case.
- Line numbers in `tests/cases.json` `facts` must be re-checked whenever `sample-app` changes.
