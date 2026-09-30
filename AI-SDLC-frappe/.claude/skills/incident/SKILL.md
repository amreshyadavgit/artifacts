---
name: incident
description: Run the incident-response workflow for a spice_lite Frappe deployment - PHI-free incident brief, sre root-cause analysis (slow whitelisted methods such as lastn, RQ queue backlog, worker and scheduler health) with conditional parallel security triage, human mitigation decision, optional fix via the bug-fix workflow, and a postmortem draft - with a run folder under .ai-sdlc/runs/.
disable-model-invocation: true
argument-hint: "[incident-id] [symptom, site and time window]"
allowed-tools: Read Grep Glob Bash(date *)
hooks:
  SubagentStop:
    - matcher: "architect|developer|reviewer|tester|security|sre"
      hooks:
        - type: command
          command: node "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-handoff.mjs"
          timeout: 20
---

# /incident: incident-response workflow

Incident: `$0`. Report: "$ARGUMENTS".
Today: !`date +%F`

You are now the **orchestrator** for this run. If this session was not started with `claude --agent orchestrator`, Read `.claude/agents/orchestrator.md` and follow it exactly. You write only inside `.ai-sdlc/runs/`. Nobody in this workflow changes a production site: mitigation commands are run by a human. `bench --site * migrate`, `execute`, `console`, `set-config` and `run-patch` are `ask` rules, and `drop-site`, `reinstall` and `restore` are denied in `.claude/settings.json`.

## Steps (spec: workflows/incident-response.md)

Run id: `<today>-inc-<slug>`. Read `workflows/incident-response.md` and `workflows/README.md` first.

| step | file | who | how |
|---|---|---|---|
| 01 | `01-incident-brief.md` | you | symptom, start time, affected site and country, endpoints or queues, blast radius, what changed recently (deploys, `bench migrate`, new scheduler events); strip any patient identifiers, document names in job kwargs and search terms before writing |
| 02 + 03 | `02-sre.md`, `03-security.md` | sre and security **in parallel** | security **only if** the symptom involves 401/403 anomalies, data exposure, or unexpected access patterns; otherwise record the skip |
| G-M | | human | mitigation decision: present sre's "mitigate now" options; a human executes one on the affected site and tells you the outcome |
| 04 | `04-sre.md` | sre | verify the mitigation with read-only evidence; confirm or reject the root-cause hypothesis |
| 05 | `05-bug-fix-handover.md` | you | if a code fix is needed: the exact `/bug-fix` command line to run next, with the evidence ids |
| 06 | `06-postmortem.md` | sre | timeline, root cause, contributing factors, action items (prevent horizon) |
| last | `NN-run-report.md` | you | overwrite `.ai-sdlc/runs/.active` with `none` |

Queue incidents: `bench --site <site> show-pending-jobs` prints each job's kwargs. Ask the human to redact them before pasting; never save raw kwargs to the run folder.
