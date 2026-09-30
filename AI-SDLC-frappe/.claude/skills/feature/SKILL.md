---
name: feature
description: Run the feature-delivery workflow for one ticket on the spice_lite Frappe app - requirements, architecture review, implementation plan, developer (DocType JSON, controller, patch, fixtures, tests), tester and security in parallel when the diff needs it, code review - with human gates and a run folder under .ai-sdlc/runs/.
disable-model-invocation: true
argument-hint: "[ticket-id] [short feature summary]"
allowed-tools: Read Grep Glob Bash(date *) Bash(git status *)
hooks:
  SubagentStop:
    - matcher: "architect|developer|reviewer|tester|security|sre"
      hooks:
        - type: command
          command: node "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-handoff.mjs"
          timeout: 20
---

# /feature: feature-delivery workflow

Ticket: `$0`. Full request: "$ARGUMENTS".
Today: !`date +%F`
App working tree before the run (must be clean, or the security-scope diff is wrong):
!`git status --short -- sample-app`

You are now the **orchestrator** for this run. If this session was started with `claude --agent orchestrator`, you already have the orchestrator procedure; otherwise Read `.claude/agents/orchestrator.md` and follow its "Starting a run", "Running a step", "Parallel steps", "Gate rules", "Failure and retry policy" and "Finishing a run" sections exactly. You write only inside `.ai-sdlc/runs/`. You never run `bench`.

If the working tree above is not empty, stop and ask the human to commit or stash first.

## Steps (spec: workflows/feature-delivery.md)

Run id: `<today>-feat-<slug>`. Read `workflows/feature-delivery.md` and `workflows/README.md` before step 01.

| step | file | who | how |
|---|---|---|---|
| 01 | `01-requirements.md` | you | `requirements` skill with the ticket; use `00-ticket-intake.md` as input if it exists |
| 02 | `02-architect.md` | architect | inputs `01-requirements.md`; asks where the change lives (core, country app, integration app) and which patch and fixtures it needs |
| 03 | `03-implementation-plan.md` | you | `implementation-plan` skill; status `needs-human` (gate G1) |
| 04 | `04-developer.md` | developer | inputs `03-implementation-plan.md`; launch needs human approval (`Agent(developer)` ask rule); a DocType JSON change also needs the migrate prompt (G1b) |
| 05 + 06 | `05-tester.md`, `06-security.md` | tester and security **in parallel** | security runs unless `.ai-sdlc/runs/<run-id>/security-scope.txt` says `SECURITY STEP: SKIP`; record a skip with that line |
| G2 | | human | stop on any `critical`/`high`, `blocked`, or undecided `medium` |
| 07.. | `07-developer.md` | developer (rework, max 2) | inputs: the blocking handoffs |
| next | `NN-reviewer.md` | reviewer | inputs: plan, latest developer handoff, review handoffs |
| last | `NN-run-report.md` | you | then overwrite `.ai-sdlc/runs/.active` with `none` |

End with `next: human`: a person opens and reviews the PR (gate G3) and each country site runs `bench migrate` after the merge. Never push or merge.
