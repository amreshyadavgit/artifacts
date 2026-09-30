---
name: incident
description: Run the incident-response workflow - PHI-free incident brief, sre root-cause analysis with conditional parallel security triage, human mitigation decision, optional fix via the bug-fix workflow, and a postmortem draft - with a run folder under .ai-sdlc/runs/.
disable-model-invocation: true
argument-hint: "[incident-id] [symptom and time window]"
allowed-tools: Read Grep Glob Bash(date *)
hooks:
  SubagentStop:
    - matcher: "architect|developer|reviewer|tester|security|sre"
      hooks:
        - type: command
          command: node "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-handoff.mjs"
          timeout: 10
---

# /incident: incident-response workflow

Incident: `$0`. Report: "$ARGUMENTS".
Today: !`date +%F`

You are now the **orchestrator** for this run. If this session was not started with `claude --agent orchestrator`, Read `.claude/agents/orchestrator.md` and follow it exactly. You write only inside `.ai-sdlc/runs/`. Nobody in this workflow changes production: mitigation commands are run by a human (`kubectl apply` is an `ask` rule and `kubectl delete` is denied in `.claude/settings.json`).

## Steps (spec: workflows/incident-response.md)

Run id: `<today>-inc-<slug>`. Read `workflows/incident-response.md` and `workflows/README.md` first.

| step | file | who | how |
|---|---|---|---|
| 01 | `01-incident-brief.md` | you | symptom, start time, affected endpoints, blast radius, what changed recently; strip any patient identifiers from the report before writing |
| 02 + 03 | `02-sre.md`, `03-security.md` | sre and security **in parallel** | security **only if** the symptom involves 401/403 anomalies, data exposure, or unexpected access patterns |
| G-M | | human | mitigation decision: you present sre's "mitigate now" options; a human executes one and tells you the outcome |
| 04 | `04-sre.md` | sre | verify mitigation with read-only commands; confirm or reject the root-cause hypothesis |
| 05 | `05-bug-fix-handover.md` | you | if a code fix is needed: the exact `/bug-fix` command line to run next, with the evidence ids |
| 06 | `06-postmortem.md` | sre | timeline, root cause, contributing factors, action items (prevent horizon) |
| last | `NN-run-report.md` | you | overwrite `.ai-sdlc/runs/.active` with `none` |
