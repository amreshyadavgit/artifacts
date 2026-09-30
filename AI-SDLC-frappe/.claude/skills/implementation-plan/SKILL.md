---
name: implementation-plan
description: Turn approved requirements and the architect's handoff into a step-by-step implementation plan (NN-implementation-plan.md) for the developer on the spice_lite Frappe app - one row per Frappe surface (DocType JSON, controller, whitelisted method, patch and patches.txt, fixtures, hooks.py, tests), verification per step, AC mapping, security scope, migrate need and rollback - that a human approves at gate G1.
when_to_use: After requirements (and the architect step, if the workflow has one) and before any developer launch in the feature and bug-fix workflows; or when the user asks for a concrete plan for a change in sample-app. Never edits code.
argument-hint: "[run-id]"
allowed-tools: Read Grep Glob
disallowed-tools: Edit Bash
---

# Implementation plan

Run: "$ARGUMENTS" (the run id; inputs are the earlier handoffs in `.ai-sdlc/runs/<run-id>/`).

## Procedure
1. Read every earlier handoff in the run folder in step order. Collect the acceptance criteria (`AC-n`) and architect findings and decisions (`ARC-n`, ADR draft).
2. For every file you plan to change, confirm it exists with Glob and read the part you will change. For new files give the exact path in the Frappe layout (`clinical/doctype/<scrubbed_name>/{__init__.py,<name>.json,<name>.py,test_<name>.py}`, `patches/v0_N/<name>.py`, `fixtures/<scrubbed_doctype>.json`). Never plan edits to an applied patch (`patches/v0_1/`), and do not touch the `TEACHING-DEFECT(perf-n+1)` code or open defects unless the request is about them.
3. Write a plan table `step | file | change | verifies`, steps `P1..`. One Frappe surface per row: DocType JSON, controller, whitelisted method, patch module, `patches.txt` line (with its section), fixture file, `hooks.py` key, tests. Every `AC-n` and every `ARC-n` with severity `medium` or above appears in `verifies` at least once. The last row is always the verification: `bench --site test.localhost migrate` (only if DocType JSON, `patches.txt` or fixtures change; this is the G1b prompt) and then `bench --site test.localhost run-tests --app spice_lite` with the expected test count.
4. **Security scope**: answer `Security scope: YES (<rules>)` if the plan touches a DocType `permissions` array or `permlevel` (rule 1), a whitelisted method or anything under `spice_lite/api/` (rule 2), `hooks.py` (rule 3), `ignore_permissions` (rule 4), adds `frappe.db.sql`/`frappe.get_all`/`frappe.qb`/`frappe.db.count` outside tests (rule 5), or ships permission fixtures (rule 6); otherwise `Security scope: NO`. These are the rules of `workflows/composition/security-scope.mjs`, which the SubagentStop Claude Code hook applies to the developer's real diff.
5. State rollback (revert the commit; what a reverted DocType JSON leaves behind: columns and tables stay until a patch removes them; a recorded patch does not run again) and behaviour changes that need a release note or country-app changes.
6. Front matter: `agent: orchestrator`, `status: needs-human` (the plan always goes through gate G1), `next: developer`. Under `## Open questions`, the first item is always the G1 approval request.

## Rules
- A plan names real files and real methods. If the requirements need something the code cannot support without a design change, stop and set `status: blocked` with the question for the architect.
- No code blocks longer than 5 lines: the developer writes the code.
- Tests use `FrappeTestCase` (`frappe.tests.utils`), never `IntegrationTestCase` (that is v16).

Worked example: `workflows/examples/feature-observation-code-vocabulary/03-implementation-plan.md`.
