---
name: bug-fix
description: Run the bug-fix workflow for one defect in the spice_lite Frappe app - reproduce and specify, plan, failing regression test plus fix, tester and conditional security in parallel, code review - with human gates and a run folder under .ai-sdlc/runs/.
disable-model-invocation: true
argument-hint: "[bug-id] [observed behaviour]"
allowed-tools: Read Grep Glob Bash(date *) Bash(git status *)
hooks:
  SubagentStop:
    - matcher: "architect|developer|reviewer|tester|security|sre"
      hooks:
        - type: command
          command: node "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-handoff.mjs"
          timeout: 20
---

# /bug-fix: bug-fix workflow

Bug: `$0`. Full report: "$ARGUMENTS".
Today: !`date +%F`
App working tree before the run (must be clean):
!`git status --short -- sample-app`

You are now the **orchestrator** for this run. If this session was not started with `claude --agent orchestrator`, Read `.claude/agents/orchestrator.md` and follow it exactly. You write only inside `.ai-sdlc/runs/`. If the working tree is not empty, stop and ask the human to commit or stash first.

## Steps (spec: workflows/bug-fix.md)

Run id: `<today>-bug-<slug>`. Read `workflows/bug-fix.md` and `workflows/README.md` first.

| step | file | who | how |
|---|---|---|---|
| 01 | `01-requirements.md` | you | `requirements` skill in bug mode: observed vs expected, reproduction with synthetic data, regression test name `test_<bugid>_<behaviour>` |
| 02 | `02-architect.md` | architect | **only if** 01 implies a DocType JSON change, a patch, a change to a whitelisted method's response contract, or more than one module; otherwise record the skip |
| 03 | `03-implementation-plan.md` | you | `implementation-plan` skill: root-cause hypothesis with `path:line`, the red test first, then the fix; status `needs-human` (G1) |
| 04 | `04-developer.md` | developer | red regression test first (quote the `FAILED` summary), then the fix (quote the `OK` summary); launch needs human approval (`Agent(developer)` ask rule) |
| 05 + 06 | `05-tester.md`, `06-security.md` | tester and security **in parallel** | security unless `security-scope.txt` says `SECURITY STEP: SKIP` |
| G2 | | human | stop on `critical`/`high`, `blocked` (including "cannot reproduce"), or undecided `medium` |
| 07.. | `07-developer.md` | developer (rework, max 2) | inputs: the blocking handoffs |
| next | `NN-reviewer.md` | reviewer | confirms the regression test failed before the fix (evidence in 04) |
| last | `NN-run-report.md` | you | overwrite `.ai-sdlc/runs/.active` with `none` |

Do not fix `TEACHING-DEFECT(perf-n+1)` or the open defects D-1 and D-3 unless the bug report is explicitly about them (CLAUDE.md rule 8).
