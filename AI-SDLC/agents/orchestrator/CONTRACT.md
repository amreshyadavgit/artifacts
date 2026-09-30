# Agent Contract: orchestrator

Status: final
Owner: AI-SDLC platform team (workflow owners)
Runtime definition: `.claude/agents/orchestrator.md`
Finalised in: 08-workflow-orchestration

## purpose

Execute one workflow run (feature delivery, bug fix, or incident response) as specified in `workflows/`: launch the roster agents in the specified order, run conditional and parallel steps, stop at every human gate, apply the failure and retry policy, and keep a complete, auditable run folder. It exists so that sequencing and gate decisions are made by one accountable role that has no ability to change code. It does not implement, review, test, or approve anything itself, and it never decides that a human gate can be skipped.

## inputs

- The entry point and its arguments from the human: `/feature`, `/bug-fix` or `/incident` with a ticket, bug or incident id and a one-line summary (required).
- The workflow spec `workflows/feature-delivery.md`, `workflows/bug-fix.md` or `workflows/incident-response.md`, and the handoff rules in `workflows/README.md` (required, read at run start).
- Existing handoffs in `.ai-sdlc/runs/<run-id>/` when resuming an interrupted run (optional).
- `00-ticket-intake.md` produced by the `ticket-intake` skill (module 06), used as the source for step 01 when present (optional).
- Human decisions at gates, given in the session: acceptance or rejection of each `Agent(developer)` prompt, fix-or-ticket decisions for findings, mitigation outcomes (required at gates).

## outputs

- `.ai-sdlc/runs/<run-id>/01-requirements.md` and `NN-implementation-plan.md`, written with the `requirements` and `implementation-plan` skills.
- Verbatim copies of the inline handoffs returned by reviewer, security and sre, saved as `NN-<agent>.md`.
- `.ai-sdlc/runs/<run-id>/NN-run-report.md`: every step with agent, status, gate outcome, skipped steps with reasons, unresolved findings, open human actions.
- `.ai-sdlc/runs/.active`: the active run id at start, `none` at the end.
- Final message to the human: run folder path, the three facts a PR reviewer needs, and the next human action.

## tools

- Agent (allowlist `Agent(architect, developer, reviewer, tester, security, sre)`, enforced when run with `claude --agent orchestrator`)
- Read
- Write (run folder only)
- Grep
- Glob
- Skill (to run `requirements` and `implementation-plan`)

## permissions

The frontmatter `tools` field grants only `Agent(architect, developer, reviewer, tester, security, sre)`, Read, Write, Grep, Glob and Skill: no Edit and no Bash, so it cannot change code or run commands. The parenthesised Agent allowlist is enforced only when the orchestrator is the main thread (`claude --agent orchestrator`); run as a subagent the list is ignored, which is why that mode is not the default (module 07). Launched with `--settings workflows/gates.settings.json`, the permission rule `ask: ["Agent(developer)"]` makes every developer launch wait for a human. Project rules in `.claude/settings.json` still apply: `git push` is `ask`, `kubectl delete` and force-push are denied. Writing only inside `.ai-sdlc/runs/` is instructed in the agent body, not enforced by config (see mustNot). A `SubagentStop` hook in its frontmatter runs `.claude/hooks/check-handoff.mjs` for every roster subagent.

## must

- Read the workflow spec and `workflows/README.md` before step 01 and follow the spec's step order [convention: reviewer compares the run report step table with the spec at PR review]
- Delegate every workflow step to the roster agent named in the spec [mechanism: `Agent(architect, developer, reviewer, tester, security, sre)` allowlist in `tools` under `claude --agent orchestrator`]
- Obtain human approval before every developer launch, including rework [mechanism: `ask` rule `Agent(developer)` in `workflows/gates.settings.json`]
- Ensure every roster step ends with a valid handoff before continuing [mechanism: `SubagentStop` hook `check-handoff.mjs` exits 2 on a missing or invalid handoff]
- Stop with `needs-human` on any `blocked` status, any `critical` or `high` finding, or an undecided `medium` [convention: gate G2 in the workflow spec; checked by `node .claude/hooks/check-handoff.mjs` on the run report and by the PR reviewer]
- Launch the tester and security steps in the same turn when the spec marks them parallel, and wait for both before evaluating gates [convention: run report shows both steps before the G2 row]
- Record every skipped conditional step with its reason in the run report [convention: PR reviewer checks the run report]
- Write the run id to `.ai-sdlc/runs/.active` at start and `none` at the end [convention: `check-handoff.mjs` enforces handoffs only while the marker names a run]

## mustNot

- Edit application code, tests, configuration, or docs outside `.ai-sdlc/runs/` [mechanism: no Edit or Bash in `tools`; Write scope is a convention checked with `git status` at PR review]
- Launch built-in, forked, or non-roster agents for a workflow step [mechanism: `Agent(...)` allowlist when run as main thread]
- Push, merge, deploy, or run `kubectl` [mechanism: no Bash in `tools`; `git push` is `ask` and `kubectl delete` is denied in `.claude/settings.json`]
- Write or complete another agent's handoff on its behalf [convention: handoff `agent` field must equal the producing subagent, checked by `check-handoff.mjs` against `agent_type`]
- Paste handoff contents or patient data into task messages; pass paths only [convention: reviewer samples subagent transcripts during evaluation, module 09]
- Exceed two developer rework steps in one run [convention: run report rework count, checked at PR review]

## failureConditions

- The workflow spec and the agent body disagree about a step, gate or condition: stop with `needs-human` and quote both.
- A subagent returns no valid handoff after the hook-driven fix and one retry: stop with `needs-human`.
- A third developer rework would be needed: stop with `needs-human` (the plan or requirements are wrong).
- The human rejects the `Agent(developer)` prompt: stop and ask what to change; do not relaunch.
- The working tree is not clean at the start of a feature or bug-fix run: stop and ask the human to commit or stash.
- Any input or pasted log appears to contain PHI: stop, ask for redaction, and do not save the text into the run folder.

## validation

`node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/<run-id>` exits 0 for the finished run folder; `node .claude/hooks/check-handoff.test.mjs` passes (25 cases, including the example run in `workflows/examples/feature-patient-pagination/`). The run report lists each spec step exactly once as run or skipped-with-reason, every developer step is preceded by an approved `Agent(developer)` prompt in the session transcript, and `git status` shows no files changed by the orchestrator outside `.ai-sdlc/runs/`. Workflow-level golden tasks live in `evaluations/` (module 09).

## handoffFormat

Every file the orchestrator writes is `.ai-sdlc/runs/<run-id>/NN-<step>.md` with the canonical front matter from `workflows/README.md`: `run_id`, `step` (two digits, equals the file prefix), `agent: orchestrator` for its own steps (or the producing agent for saved inline handoffs), `status` (`complete`, `blocked`, `needs-human`), `inputs` (flow list of earlier run files or `ticket:` references), and `next`; followed by the sections Summary, Findings (table `id | severity | category | location | evidence | recommendation` or "No findings."), Decisions, Open questions, and Artifacts. The final `NN-run-report.md` has `next: human`.

## humanGate

G1: every developer launch waits on the permission `ask` rule `Agent(developer)` from `workflows/gates.settings.json`; the human reads `01..03` and accepts or rejects the prompt. G2: after the parallel tester and security steps and after code review, the orchestrator stops with `needs-human` on blocking findings and continues only after the human's recorded decision, and any rework goes back through the G1 ask prompt. G3: the run ends with `next: human`; a person opens and approves the pull request (PR approval with branch protection, module 10), and `git push` is itself an `ask` rule in `.claude/settings.json`.
