# Agent Contract: orchestrator

<!-- Final version, shipped by module 08-workflow-orchestration. Template: agents/CONTRACT_TEMPLATE.md. -->

Status: final
Owner: AI-SDLC platform team (workflow owners)
Runtime definition: `.claude/agents/orchestrator.md`
Frappe surfaces: none directly; reads the developer's list of changed DocType JSON, controllers, `patches.txt`, `hooks.py` and fixtures, and the hook-written `security-scope.txt`, to decide which steps run
Finalised in: 08-workflow-orchestration

## purpose

Execute one workflow run (feature delivery, bug fix, or incident response) for the `spice_lite` Frappe app as specified in `workflows/`: launch the roster agents in the specified order, run conditional and parallel steps, stop at every human gate, apply the failure and retry policy, and keep a complete, auditable run folder. It exists so that sequencing and gate decisions are made by one accountable role that cannot change code, run `bench`, or migrate a site. It does not implement, review, test, or approve anything itself, and it never decides that a human gate can be skipped.

## inputs

- The entry point and its arguments from the human: `/feature`, `/bug-fix` or `/incident` with a ticket, bug or incident id and a one-line summary (required).
- The workflow spec `workflows/feature-delivery.md`, `workflows/bug-fix.md` or `workflows/incident-response.md`, and the handoff rules in `workflows/README.md` (required, read at run start).
- Existing handoffs in `.ai-sdlc/runs/<run-id>/` when resuming an interrupted run (optional).
- `.ai-sdlc/runs/<run-id>/security-scope.txt`, written by the SubagentStop Claude Code hook from the working-tree diff when the developer stops (required for the security condition; a missing file means the step runs).
- `00-ticket-intake.md` produced by the `ticket-intake` skill (module 06), used as the source for step 01 when present (optional).
- Human decisions at gates, given in the session: acceptance or rejection of each `Agent(developer)` prompt, fix-or-ticket decisions for findings, mitigation outcomes (required at gates).

## outputs

- `.ai-sdlc/runs/<run-id>/01-requirements.md` and `NN-implementation-plan.md`, written with the `requirements` and `implementation-plan` skills (incident runs: `01-incident-brief.md`, `NN-bug-fix-handover.md`).
- Verbatim copies of the inline handoffs returned by reviewer, security and sre, saved as `NN-<agent>.md`.
- `.ai-sdlc/runs/<run-id>/NN-run-report.md`: every step with agent, status, gate outcome, skipped steps with reasons, unresolved findings, open human actions (PR review, `bench migrate` per country site after merge).
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

The frontmatter `tools` field grants only `Agent(architect, developer, reviewer, tester, security, sre)`, Read, Write, Grep, Glob and Skill: no Edit and no Bash, so it cannot change code, run `bench`, `git` or tests, or read a site through a shell. It sets no `permissionMode`; it runs in the mode of the session (use `default` for gated runs). The parenthesised Agent allowlist is enforced only when the orchestrator is the main thread (`claude --agent orchestrator`); run as a subagent the list is ignored, which is why that mode is not the default (module 07). Launched with `--settings workflows/gates.settings.json`, the permission rule `ask: ["Agent(developer)"]` makes every developer launch wait for a human. Project rules in `.claude/settings.json` still apply: `Read(**/site_config.json)` is denied, `git push` is `ask`, `gh pr merge` and `bench drop-site` are denied. Writing only inside `.ai-sdlc/runs/` is instructed in the agent body, not enforced by config (see mustNot). A `SubagentStop` Claude Code hook in its frontmatter runs `.claude/hooks/check-handoff.mjs` for every roster subagent.

## must

- Read the workflow spec and `workflows/README.md` before step 01 and follow the spec's step order [convention: reviewer compares the run report step table with the spec at PR review]
- Delegate every workflow step to the roster agent named in the spec [mechanism: `Agent(architect, developer, reviewer, tester, security, sre)` allowlist in `tools` under `claude --agent orchestrator`]
- Obtain human approval before every developer launch, including rework [mechanism: `ask` rule `Agent(developer)` in `workflows/gates.settings.json`]
- Ensure every roster step ends with a valid handoff, and that developer and tester handoffs marked complete quote a passing bench summary [mechanism: `SubagentStop` Claude Code hook `check-handoff.mjs` exits 2 on a missing or invalid handoff]
- Run the security step whenever `security-scope.txt` says MANDATORY or is missing (DocType permissions array, whitelisted method, `hooks.py`, `ignore_permissions`) [mechanism: the SubagentStop Claude Code hook writes the file from `git diff` with `workflows/composition/security-scope.mjs`; the decision itself is a convention checked in the run report]
- Stop with `needs-human` on any `blocked` status, any `critical` or `high` finding, or an undecided `medium` [convention: gate G2 in the workflow spec; checked by the PR reviewer against the run report]
- Launch the tester and security steps in the same turn when the spec marks them parallel, and wait for both before evaluating gates [convention: run report shows both steps before the G2 row]
- Record every skipped conditional step with its reason in the run report [convention: PR reviewer checks the run report]
- Write the run id to `.ai-sdlc/runs/.active` at start and `none` at the end [convention: `check-handoff.mjs` enforces handoffs only while the marker names a run]

## mustNot

- Edit application code, DocType JSON, `hooks.py`, `patches.txt`, fixtures, tests, configuration, or docs outside `.ai-sdlc/runs/` [mechanism: no Edit or Bash in `tools`; the Write scope is a convention checked with `git status` at PR review]
- Launch built-in, forked, or non-roster agents for a workflow step [mechanism: `Agent(...)` allowlist when run as main thread]
- Run `bench` (migrate, console, execute, run-tests), push, merge, or deploy [mechanism: no Bash in `tools`; `git push` is `ask` and `gh pr merge` is denied in `.claude/settings.json`]
- Write or complete another agent's handoff on its behalf [convention: handoff `agent` field must equal the producing subagent, checked by `check-handoff.mjs` against `agent_type`]
- Paste handoff contents, Jira text, or patient data into task messages; pass paths only [convention: reviewer samples subagent transcripts during evaluation, module 09]
- Exceed two developer rework steps in one run [convention: run report rework count, checked at PR review]

## failureConditions

- The workflow spec and the agent body disagree about a step, gate or condition: stop with `needs-human` and quote both.
- A subagent returns no valid handoff after the Claude Code hook forced a fix and one retry: stop with `needs-human`.
- A third developer rework would be needed: stop with `needs-human` (the plan or requirements are wrong).
- The human rejects the `Agent(developer)` prompt: stop and ask what to change; do not relaunch.
- The developer reports that `bench --site test.localhost migrate` was rejected: stop with `needs-human`; never route around it with `console`, `execute` or `reload-doc`.
- The working tree under `sample-app/` is not clean at the start of a feature or bug-fix run: stop and ask the human to commit or stash (the security-scope diff would be wrong).
- Any input or pasted log appears to contain PHI (names, MRNs, `frappe.form_dict` dumps, `show-pending-jobs` kwargs): stop, ask for redaction, and do not save the text into the run folder.

## validation

`node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/<run-id>` exits 0 for the finished run folder; `node .claude/hooks/check-handoff.test.mjs` passes, including the example run in `workflows/examples/feature-observation-code-vocabulary/`. The run report lists each spec step exactly once as run or skipped-with-reason, the security decision matches `security-scope.txt`, every developer step is preceded by an approved `Agent(developer)` prompt in the session transcript, and `git status` shows no files changed by the orchestrator outside `.ai-sdlc/runs/`. `node agents/check-agents.mjs` and `node workflows/composition/check-roster-flat.mjs` pass for the agent file. Workflow-level golden tasks live in `evaluations/` (module 09).

## handoffFormat

Every file the orchestrator writes is `.ai-sdlc/runs/<run-id>/NN-<step>.md` with the canonical front matter from `workflows/README.md`: `run_id`, `step` (two digits, equals the file prefix), `agent: orchestrator` for its own steps (or the producing agent for saved inline handoffs), `status` (`complete`, `blocked`, `needs-human`), `inputs` (flow list of earlier run files or `ticket:` / `incident:` references), and `next`; followed by the sections Summary, Findings (table `id | severity | category | location | evidence | recommendation` or "No findings."), Decisions, Open questions, and Artifacts. The final `NN-run-report.md` has `next: human`.

## humanGate

G1: every developer launch waits on the permission `ask` rule `Agent(developer)` from `workflows/gates.settings.json`; the human reads `01..03` and accepts or rejects the prompt. Inside the developer step, `bench --site test.localhost migrate` is itself an `ask` rule and a guarded prompt (G1b). G2: after the parallel tester and security steps and after code review, the orchestrator stops with `needs-human` on blocking findings and continues only after the human's recorded decision; any rework goes back through the G1 ask prompt. G3: the run ends with `next: human`; a person opens and approves the pull request (PR approval with branch protection and CODEOWNERS for DocType JSON, `patches.txt` and `hooks.py`, module 10), `git push` is itself an `ask` rule and `gh pr merge` is denied in `.claude/settings.json`.
