---
name: feature
description: Run the feature-delivery workflow for one ticket - requirements, architecture review, implementation plan, developer, tester and security in parallel, code review - with human gates and a run folder under .ai-sdlc/runs/.
disable-model-invocation: true
argument-hint: "[ticket-id] [short feature summary]"
allowed-tools: Read Grep Glob Bash(date *) Bash(git status *)
hooks:
  SubagentStop:
    - matcher: "architect|developer|reviewer|tester|security|sre"
      hooks:
        - type: command
          command: node "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-handoff.mjs"
          timeout: 10
---

# /feature: feature-delivery workflow

Ticket: `$0`. Full request: "$ARGUMENTS".
Today: !`date +%F`
Working tree before the run (must be clean, or the diff-based checks below are wrong):
!`git status --short`

You are now the **orchestrator** for this run. If this session was started with `claude --agent orchestrator`, you already have the orchestrator procedure; otherwise Read `.claude/agents/orchestrator.md` and follow its "Starting a run", "Running a step", "Gate rules", "Failure and retry policy" and "Finishing a run" sections exactly. You write only inside `.ai-sdlc/runs/`.

If the working tree above is not empty, stop and ask the human to commit or stash first.

## Steps (spec: workflows/feature-delivery.md)

Run id: `<today>-feat-<slug>`. Read `workflows/feature-delivery.md` and `workflows/README.md` before step 01.

| step | file | who | how |
|---|---|---|---|
| 01 | `01-requirements.md` | you | `requirements` skill with the ticket; use `00-ticket-intake.md` as input if it exists |
| 02 | `02-architect.md` | architect | inputs `01-requirements.md` |
| 03 | `03-implementation-plan.md` | you | `implementation-plan` skill; status `needs-human` (gate G1) |
| 04 | `04-developer.md` | developer | inputs `03-implementation-plan.md`; launch needs human approval (`Agent(developer)` ask rule) |
| 05 + 06 | `05-tester.md`, `06-security.md` | tester and security **in parallel** | security only if a path in 04's `## Artifacts` is security-scoped (see spec); otherwise record the skip |
| G2 | | human | stop on any `critical`/`high`, `blocked`, or undecided `medium` |
| 07.. | `07-developer.md` | developer (rework, max 2) | inputs: the blocking handoffs |
| next | `NN-reviewer.md` | reviewer | inputs: plan, latest developer handoff, review handoffs |
| last | `NN-run-report.md` | you | then overwrite `.ai-sdlc/runs/.active` with `none` |

End with `next: human`: a person opens and reviews the PR (gate G3). Never push or merge.
