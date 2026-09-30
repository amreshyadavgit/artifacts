---
name: implementation-plan
description: Turn approved requirements and the architect's handoff into a step-by-step implementation plan (NN-implementation-plan.md) for the developer - files to change, verification per step, test mapping to acceptance criteria, security scope and rollback - that a human approves at gate G1.
when_to_use: After requirements (and the architect step, if the workflow has one) and before any developer launch in the feature and bug-fix workflows; or when the user asks for a concrete plan for a change in sample-app. Never edits code.
argument-hint: "[run-id]"
allowed-tools: Read Grep Glob
disallowed-tools: Edit Bash
---

# Implementation plan

Run: "$ARGUMENTS" (the run id; inputs are the earlier handoffs in `.ai-sdlc/runs/<run-id>/`).

## Procedure
1. Read every earlier handoff in the run folder in step order. Collect the acceptance criteria (`AC-n`) and architect findings/decisions (`ARC-n`, ADR draft).
2. For every file you plan to change, confirm it exists with Glob and read the method you will change. New files: state the package and why it belongs there (`context/standards/coding-standards.md` rule 1). Do not plan changes to `db/migration/V1__init.sql` (rule 10) or to the `TEACHING-DEFECT(perf-n+1)` code unless the request is about it.
3. Write a plan table `step | file | change | verifies`, steps `P1..`, each small enough to verify with `cd sample-app && mvn -q -B test`. Every `AC-n` and every `ARC-n` with severity `medium` or above appears in the `verifies` column at least once.
4. **Security scope**: answer YES if any planned path matches `sample-app/src/main/java/org/example/fhir/{api,config,error,audit}/`, `sample-app/src/main/resources/`, `sample-app/k8s/`, `sample-app/pom.xml` or `sample-app/Dockerfile`; otherwise NO. The orchestrator re-checks this against the developer's actual `## Artifacts`.
5. State rollback (revert, migration down path) and behaviour changes that need a release note.
6. Front matter: `agent: orchestrator`, `status: needs-human` (the plan always goes through gate G1), `next: developer`. Under `## Open questions`, the first item is always the G1 approval request.

## Rules
- A plan names real files and real methods. If the requirements need something the code cannot support without a design change, stop and set `status: blocked` with the question for the architect.
- No code blocks longer than 5 lines: the developer writes the code.

Worked example: `workflows/examples/feature-patient-pagination/03-implementation-plan.md`.
