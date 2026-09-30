# Skill asset: feature (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/feature/SKILL.md` (spec: `workflows/feature-delivery.md`, format: `workflows/README.md`, worked run: `workflows/examples/feature-observation-code-vocabulary/`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | Humans via `/feature` (`disable-model-invocation: true`: Claude never starts it on its own) |
| Invocation | `/feature OBS-51 Controlled vocabulary for observation codes` |
| Writes files | Only inside `.ai-sdlc/runs/<run-id>/` (the orchestrator); subagents change `sample-app/` only in the developer step, after a human approves the launch |
| Taught in | module `08-workflow-orchestration` |
| Golden cases | [tests/cases.json](tests/cases.json): 4 deterministic, 2 live |

## Purpose
Runs the feature-delivery workflow for one ticket on `spice_lite`: requirements, architect, implementation plan (gate G1), developer (DocType JSON, controller, patch and `patches.txt`, fixtures, tests; the migrate prompt is gate G1b), tester and security in parallel, human gate G2, rework (at most two rounds), reviewer and run report. The security step is mandatory whenever `workflows/composition/security-scope.mjs`, run by the SubagentStop Claude Code hook on the developer's real diff, writes `SECURITY STEP: MANDATORY` to `security-scope.txt`.

## Inputs and arguments
`$0` ticket id, the rest a short summary. Injections: `date +%F` and `git status --short -- sample-app` (the run refuses to start on a dirty app tree).

## Output contract
A run folder `.ai-sdlc/runs/<date>-feat-<slug>/` with `01-requirements.md` ... `NN-run-report.md`, each valid under `check-handoff.mjs`, plus `security-scope.txt`. Ends with `next: human` (gate G3: a person opens the PR; each country site runs `bench migrate` after merge).

## Bench assumptions
The orchestrator never runs `bench`. The developer runs `bench --site test.localhost migrate` (ask rule) and `run-tests`; the tester runs `run-tests`.

## Cost notes
The most expensive workflow: 6 to 9 subagent launches. See `docs/governance/model-and-cost-policy.md` for per-agent models and the budget guard.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# fe-01-worked-run-valid: Every handoff of the worked feature run passes the handoff validator
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary
# fe-02-security-mandatory: The developer patch of the worked run makes the security step mandatory (rules 1, 3, 4, 5)
node workflows/composition/security-scope.mjs workflows/examples/feature-observation-code-vocabulary/patches/04-developer.patch
# fe-03-tests-only-skips: A tests-only diff lets the security step be skipped, with the changed path recorded
node workflows/composition/security-scope.mjs workflows/examples/feature-observation-code-vocabulary/patches/05-tester.patch
# fe-04-human-gates: The skill cannot start itself and the SubagentStop hook is registered
grep -nE '^disable-model-invocation: true|check-handoff.mjs' .claude/skills/feature/SKILL.md | wc -l
```

## Known limitations
- The orchestrator has no Bash; it learns the diff classification only through `security-scope.txt`.
- Parallel tester and security steps need the Agent tool calls in one turn; a sequential run is valid but slower.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
