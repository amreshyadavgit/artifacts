# Skill asset: bug-fix (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/bug-fix/SKILL.md` (spec: `workflows/bug-fix.md`, format: `workflows/README.md`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | Humans via `/bug-fix`, and the incident workflow's `05-bug-fix-handover.md`, which prints the exact `/bug-fix` command line to run next |
| Invocation | `/bug-fix D-1 lastn returns preliminary observations with value 0.0` |
| Writes files | Only inside `.ai-sdlc/runs/<run-id>/` (the orchestrator); subagents change `sample-app/` only in the developer step, after a human approves the launch |
| Taught in | module `08-workflow-orchestration` |
| Golden cases | [tests/cases.json](tests/cases.json): 4 deterministic, 1 live |

## Purpose
Runs the bug-fix workflow for one defect in `spice_lite`: requirements in bug mode (observed, expected, reproduction with synthetic data, regression test name `test_<bugid>_<behaviour>`), an architect step only when the fix changes DocType JSON, a patch, a whitelisted method's response contract or more than one module, a plan (gate G1), a developer who shows the red regression test before the fix, tester and conditional security in parallel, gate G2, rework, reviewer and run report.

## Inputs and arguments
`$0` bug id, the rest the observed behaviour. Same injections as `/feature` (`date`, `git status --short -- sample-app`).

## Output contract
A run folder `.ai-sdlc/runs/<date>-bug-<slug>/`; the developer handoff quotes the `FAILED` summary before the fix and the `Ran N tests ... OK` summary after it, which `check-handoff.mjs` enforces for `status: complete`.

## Bench assumptions
As `/feature`. The orchestrator never runs `bench`.

## Cost notes
Usually 4 to 6 subagent launches (no architect for a local fix).

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# bf-01-local-fix-skips-security: A controller-only fix does not trigger the security step
node workflows/composition/security-scope.mjs docs/tutorials/level-2/patches/02-final-without-value-regression.patch
# bf-02-api-fix-needs-security: A fix inside spice_lite/api/ makes the security step mandatory (rule 2)
node workflows/composition/security-scope.mjs docs/tutorials/level-2/patches/02-review-exercise.patch
# bf-03-refactor-skips: A refactor of the SL Encounter controller is classified SKIP
node workflows/composition/security-scope.mjs workflows/composition/fixtures/encounter-refactor.patch
# bf-04-defect-rule: The skill forbids fixing the teaching defect and open defects unless the report is about them
grep -c 'TEACHING-DEFECT(perf-n+1)' .claude/skills/bug-fix/SKILL.md; grep -c 'disable-model-invocation: true' .claude/skills/bug-fix/SKILL.md
```

## Known limitations
- CLAUDE.md rule 8: the open defects D-1 and D-3 and `TEACHING-DEFECT(perf-n+1)` are fixed only when the bug report is explicitly about them.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
