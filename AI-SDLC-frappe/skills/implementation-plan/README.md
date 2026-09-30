# Skill asset: implementation-plan (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/implementation-plan/SKILL.md` (worked example: `workflows/examples/feature-observation-code-vocabulary/03-implementation-plan.md`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | The orchestrator as step 03 of `/feature` and `/bug-fix`; the `developer` agent reads the approved plan |
| Invocation | `/implementation-plan 2026-09-30-feat-obs-51` |
| Writes files | `.ai-sdlc/runs/<run-id>/03-implementation-plan.md`. `disallowed-tools: Edit Bash` |
| Taught in | module `08-workflow-orchestration` |
| Golden cases | [tests/cases.json](tests/cases.json): 4 deterministic, 1 live |

## Purpose
Turns approved requirements and the architect handoff into a step-by-step plan for the developer: one row per Frappe surface (DocType JSON, controller, whitelisted method, patch module and its `patches.txt` line and section, fixtures, `hooks.py` key, tests), the acceptance criteria and architect findings each step verifies, a `Security scope: YES|NO` line using the rules of `security-scope.mjs`, the migrate need and rollback. The plan always ends with `status: needs-human` for gate G1.

## Inputs and arguments
`$ARGUMENTS`: the run id; reads every earlier handoff in the run folder and confirms each planned file with Glob.

## Output contract
`03-implementation-plan.md` with a `step | file | change | verifies` table (steps `P1..`), the last row being `bench --site test.localhost migrate` (only when DocType JSON, `patches.txt` or fixtures change) and `bench --site test.localhost run-tests --app spice_lite` with the expected test count.

## Bench assumptions
None; it plans bench commands, the developer runs them.

## Cost notes
Default model; about 10 to 15 Read/Glob calls.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# ip-01-worked-example-valid: The worked plan passes the handoff validator
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary/03-implementation-plan.md
# ip-02-gate-g1: The worked plan stops at gate G1 and states its security scope
grep -E '^status:|Security scope:' workflows/examples/feature-observation-code-vocabulary/03-implementation-plan.md
# ip-03-plan-agrees-with-diff: The plan's security scope matches what security-scope.mjs says about the developer's real diff
node workflows/composition/security-scope.mjs workflows/examples/feature-observation-code-vocabulary/patches/04-developer.patch | head -1
# ip-04-read-only: The skill cannot edit files or run commands
grep -E '^(allowed-tools|disallowed-tools):' .claude/skills/implementation-plan/SKILL.md
```

## Known limitations
- Never plans edits to an applied patch under `patches/v0_1/`.
- Tests use `FrappeTestCase`; `IntegrationTestCase` is Frappe v16.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
