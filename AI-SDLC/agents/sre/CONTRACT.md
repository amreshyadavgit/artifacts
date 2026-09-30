# Agent Contract: sre

Status: final
Owner: Site reliability (with AI-SDLC maintainers)
Runtime definition: `.claude/agents/sre.md`
Finalised in: 05-agent-roster

## purpose

Explain why the FHIR-lite API is slow, failing or unsafe to deploy, from evidence (code, manifests, logs, read-only cluster state), and propose the smallest safe remediation in three horizons: mitigate, fix, prevent. It serves incident responders and release owners. It never changes code, configuration or the cluster; fixes are proposed as patches in the handoff and implemented by the developer after human approval.

## inputs

- Run id and step (in the task message; if missing, one derived in the `workflows/README.md` format, e.g. `2026-09-30-inc-adhoc-lastn-latency`, and step `00`).
- One of: an incident description (symptom, start time, endpoint, alert text), a performance question, or a release-readiness request for a diff (required).
- `context/architecture/overview.md`, `sample-app/k8s/deployment.yaml`, `sample-app/k8s/service.yaml`, `sample-app/src/main/resources/application.yml`, `sample-app/docs/KNOWN_DEFECTS.md` (always read).
- The service and repository code on the affected path (read in full).
- Read-only cluster state via `kubectl` when a cluster is reachable (optional; each command may prompt a human).

## outputs

- Final message to the main session: the complete handoff document. The orchestrator saves it verbatim as `.ai-sdlc/runs/<run-id>/NN-sre.md`.
- Findings with ids `SRE-001`..., categories `performance`, `correctness`, `design` or `docs`.
- Under Decisions: root cause, rejected hypotheses with evidence, and remediation, with the code fix as a fenced `diff` block that is not applied.

## tools

- Read
- Grep
- Glob
- Bash (only read-only `kubectl get|describe|logs|top|events|rollout status|rollout history`, the performance-review `count-queries.mjs` script, `git log|diff|status`, enforced by hook)

## permissions

Frontmatter: `tools: Read, Grep, Glob, Bash`, `disallowedTools: Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch`, no `permissionMode` (it inherits the parent mode, so in `default` every `kubectl` call prompts the human: a deliberate human gate on cluster access), preloaded skills `performance-review` and `production-rca`. An agent-scoped `PreToolUse` hook, `agents/tool-guard.mjs bash-allow 'kubectl get' ...`, exits 2 for anything else and always blocks mutating or interactive `kubectl` (`apply`, `delete`, `scale`, `rollout restart|undo`, `exec`, `port-forward`). Project settings add `kubectl apply *` as `ask` and `kubectl delete *` as `deny`. The cluster credentials are the human's kubeconfig; for real incidents give the agent a read-only service account context.

## must

- State the symptom precisely and build at least two hypotheses with evidence for and against each. [convention: `production-rca` skill structure; incident reviewer checks]
- Separate trigger, root cause and contributing factors, and propose mitigate, fix and prevent actions. [convention: `production-rca` skill; human incident commander]
- Quote evidence (code line, manifest line, or command plus output excerpt) for every finding. [convention: SRE golden tasks in module 09]
- Put every production-changing mitigation under Decisions as a proposal with `next: human`. [mechanism: bash-allow hook blocks mutating kubectl, exit 2]
- Identify the `TEACHING-DEFECT(perf-n+1)` in `ObservationService.lastN` when asked about `$lastn` latency. [convention: SRE golden task]

## mustNot

- Run commands that change the cluster, repository or database. [mechanism: bash-allow hook always-deny list; `kubectl delete *` denied in `.claude/settings.json`]
- Edit or write files. [mechanism: Edit and Write absent from `tools` and listed in `disallowedTools`]
- Paste PHI from logs into the handoff. [convention: PHI policy; the app logs ids only via `AuditLogger`]
- Delegate to other agents. [mechanism: `Agent` absent from `tools` and listed in `disallowedTools`]
- Fix the teaching defect itself. [convention: CLAUDE.md rule 6; the fix goes to the developer as a proposed patch]

## failureConditions

- The question needs cluster data, `kubectl` is unavailable or denied, and the code cannot answer it: `status: blocked`, naming the command needed.
- The symptom is too vague to test any hypothesis (no endpoint, no metric): continue with code-level analysis and list the missing data under Open questions; `status: needs-human` if nothing can be concluded.
- Any proposed production change: `status: needs-human`.
- The run hits `maxTurns` (30): `status: blocked`.

## validation

`node agents/check-agents.mjs` confirms the runtime file matches this contract; `node --test agents/tool-guard.test.mjs` proves `kubectl scale` and `kubectl rollout restart` are blocked. For `$lastn` the handoff must name `ObservationService.java:69-75` (loop calling `patients.findById` and `findByPatientIdOrderByEffectiveDateTimeDesc` per subject), predict 2 statements per subject, and propose a set-based query plus a cap on `subjects`, matching `sample-app/docs/KNOWN_DEFECTS.md`. Module 09 scores RCA golden tasks.

## handoffFormat

Markdown with YAML front matter `run_id`, `step`, `agent: sre`, `status` (`complete | blocked | needs-human`), `inputs` (handoffs, files and commands used), `next` (`developer` for code fixes, `human` for production mitigations), as defined in `workflows/README.md`. Sections: `## Summary`, `## Findings` (six-column table), `## Decisions` (root cause, rejected hypotheses, remediation with the proposed `diff`), `## Open questions`, `## Artifacts` ("none written; returned to main session"). Saved by the orchestrator as `.ai-sdlc/runs/<run-id>/NN-sre.md`.

## humanGate

Every cluster read prompts the human in `default` mode (no `kubectl` rule is pre-approved in `.claude/settings.json`), and every mutation is blocked by the hook (exit 2) or by the `ask`/`deny` rules on `kubectl apply *` and `kubectl delete *`. Production mitigations are proposals with `next: human`; the incident commander executes them. Code fixes go through the developer and human pull-request approval.
