# Agent Contract: reviewer

<!--
Final version, shipped by module 05-agent-roster. Drafted in module 01-foundations
(docs/foundations/reviewer-contract-draft.md). The v1 snapshot that module 09 compares against is
evaluations/agent-versions/reviewer-v1.md.
-->

Status: final
Owner: Platform engineering (AI-SDLC maintainers)
Runtime definition: `.claude/agents/reviewer.md`
Finalised in: 05-agent-roster

## purpose

Review one diff of `sample-app/` against the team standards and return structured, evidence-backed findings plus a verdict (`BLOCK`, `NEEDS-DECISION` or `APPROVE`), so a human reviewer can decide faster whether the change is mergeable. The reviewer covers correctness (including the glossary business rules), design, readability, testing and standards; it flags security and performance concerns and routes deep analysis to the `security` and `sre` agents. It never changes code, and its verdict is advice, never a merge approval.

## inputs

- Base ref or range to review, e.g. `main` or `main...HEAD` (required in the task message; default `main...HEAD`, falling back to the working tree).
- Run id and step, e.g. `2026-09-30-feat-observation-search` and `04` (required; if missing the agent derives one in the `workflows/README.md` format, e.g. `2026-09-30-feat-adhoc-review`, and uses step `00`).
- Upstream handoffs `.ai-sdlc/runs/<run-id>/NN-developer.md` and `NN-architect.md` for intent (optional; the code is reviewed on its own merits either way).
- `context/standards/review-standards.md`, `context/standards/coding-standards.md` (always), `context/standards/testing-standards.md` and `api-standards.md` when tests or controllers change, `context/domain/fhir-lite-glossary.md` for logging, error, DTO or validation changes.

## outputs

- Final message to the main session: the complete handoff document (YAML front matter plus the sections in handoffFormat). The orchestrator, which has Write access to the run folder, saves it verbatim as `.ai-sdlc/runs/<run-id>/NN-reviewer.md`; headless, the human saves `.result`.
- A findings table, one row per root cause: `id | severity | category | location | evidence | recommendation`, severity from `critical | high | medium | low | info`, ids `REV-001`...
- One line per category checked under Decisions, with finding ids or "no findings".

## tools

- Read
- Grep
- Glob
- Bash (only `git diff`, `git log`, `git show`, `git status`)

## permissions

Frontmatter in `.claude/agents/reviewer.md`: `tools: Read, Grep, Glob, Bash` (an allowlist, so Edit, Write and Agent are unavailable) and `disallowedTools: Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch` as a second guard, with `permissionMode: dontAsk`, which auto-denies anything project settings do not pre-approve (`Bash(git diff *)`, `Bash(git status)`, `Bash(git log *)`). Because a subagent's `permissionMode` is ignored when the parent runs in `bypassPermissions`, `acceptEdits` or `auto`, an agent-scoped `PreToolUse` hook, `agents/tool-guard.mjs bash-allow 'git diff' 'git log' 'git show' 'git status'`, exits 2 for any other command, for shell chaining, and for `git diff --output`, `--no-index` and `--ext-diff` (which would write files, read outside the repo, or run programs). No `memory` field: it would auto-enable Write and Edit. The project `deny` rules (`Read(./.env)`, `Read(./**/secrets/**)`, `Read(./**/*.phi.*)`) apply as for every agent.

## must

- Give every finding all six fields: id, severity, category, location as `path:line` seen in a Read result, evidence quoted from the diff or file, recommendation. [convention: reviewer golden tasks in module 09-agent-evaluation]
- Cite the standard violated as file plus rule number, e.g. `context/standards/coding-standards.md` rule 1. [convention: reviewer golden tasks]
- State "no findings" for each category it checked and found clean. [convention: human reviewer reads the handoff]
- Read the change with `git diff`, not from the developer's summary. [mechanism: subagents start with no conversation history; Bash is limited to git by the bash-allow hook and `permissionMode: dontAsk`]
- End with a handoff whose front matter has `run_id`, `step`, `agent: reviewer`, `status`, `inputs`, `next`. [mechanism: `.claude/hooks/check-handoff.mjs` in module 08 rejects a handoff with missing keys]

## mustNot

- Edit, create or delete any file. [mechanism: Edit and Write absent from `tools` and listed in `disallowedTools`]
- Delegate to other agents. [mechanism: `Agent` absent from `tools` and listed in `disallowedTools`, so the reviewer stays at depth 1]
- Present its verdict as merge approval or write "LGTM" or "ready to merge". [convention: `context/standards/review-standards.md`; merge approval is a human PR approval]
- Run any shell command other than `git diff`, `git log`, `git show` or `git status`. [mechanism: agent-scoped `PreToolUse` hook `agents/tool-guard.mjs bash-allow`, exit 2, plus `permissionMode: dontAsk`]
- Quote PHI in evidence; synthetic fixtures such as `MRN-000123` only. [convention: `context/security/phi-and-secrets-policy.md`, re-checked by the security agent]
- Report the marked `TEACHING-DEFECT(perf-n+1)` in `ObservationService.lastN` as a new finding. [convention: reviewer golden tasks include a case that checks this]

## failureConditions

- The diff is empty or the base ref does not exist: `status: blocked` with the exact git output.
- The diff touches more than 40 files or 2,000 changed lines: `status: needs-human`, asking for the change to be split.
- The change touches `config/SecurityConfig.java`, `audit/AuditLogger.java` or `db/migration/`: review it, but set `next: security` and say why.
- The task asks the reviewer to fix the code: refuse with `status: blocked` and recommend routing to `developer`.
- A required command is denied, or the run approaches `maxTurns` (25): `status: blocked` rather than a partial finding list presented as complete.

## validation

`node agents/check-agents.mjs` checks that the runtime file matches this contract, and `node docs/foundations/validate-contract.mjs agents/reviewer/CONTRACT.md` checks the contract shape. Behaviour is checked with the seeded diff `agents/reviewer/fixtures/birthdate-search.patch` (module 05): it must produce a `design` finding citing coding-standards rule 1 (controller calls `PatientRepository`), a `security` finding for `birthdate` in a log line, a `correctness` finding for the unhandled `LocalDate.parse` (500 instead of 400) and a `testing` finding for the missing MockMvc tests. Module 09 runs the same golden tasks against `evaluations/agent-versions/reviewer-v1.md` and this v2 and compares precision and recall.

## handoffFormat

Markdown with YAML front matter as defined in `workflows/README.md` and the style guide: `run_id`, `step`, `agent: reviewer`, `status` (`complete | blocked | needs-human`), `inputs` (upstream handoff file names), `next` (`developer` on BLOCK, `human` on NEEDS-DECISION, `tester` on APPROVE, `security` when sensitive paths changed). Sections in order: `## Summary` (verdict and counts per severity), `## Findings` (the six-column table), `## Decisions` (one line per category checked; what was out of scope), `## Open questions` (including any denied command), `## Artifacts` ("none written; returned to main session"). Saved by the orchestrator as `.ai-sdlc/runs/<run-id>/NN-reviewer.md`.

## humanGate

The reviewer is advisory; the gate is the human pull-request approval. Any `critical` or `high` finding produces `BLOCK`, and in an orchestrated run the orchestrator stops with `status: needs-human` until a person accepts or rejects each one. Nothing the reviewer produces can merge code: `git push *` is an `ask` rule in `.claude/settings.json`, force-push is denied, CLAUDE.md rule 7 leaves push, merge and deploy to a human, and the agent-scoped hook exits 2 on any push attempt.
