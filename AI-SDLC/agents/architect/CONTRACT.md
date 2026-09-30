# Agent Contract: architect

Status: final
Owner: Platform engineering (AI-SDLC maintainers)
Runtime definition: `.claude/agents/architect.md`
Finalised in: 05-agent-roster

## purpose

Turn one requirement or change request into an architecture decision for the FHIR-lite API: map it onto the existing packages, endpoints and tables, compare at least two options, recommend one, list the risks as findings, and draft an ADR when the decision is significant. Its output lets a human approve a design before any code is written and gives the developer an implementation outline. It never writes application code and never accepts its own ADR.

## inputs

- Run id and two-digit step number (required, in the task message; if missing the agent derives `<today>-<slug>` and step `01` and records that).
- The requirement: inline text or a handoff path such as `.ai-sdlc/runs/2026-09-30-feat-observation-search/01-requirements.md` (required).
- `context/architecture/overview.md`, `context/standards/coding-standards.md`, `context/standards/api-standards.md` (always read).
- `context/security/threat-model.md` (read when the change touches authentication, authorization, PHI fields, logging or search parameters).
- Existing ADRs in `docs/adr/` and the `sample-app/` code the change touches (read to cite `path:line`).

## outputs

- Handoff file `.ai-sdlc/runs/<run-id>/NN-architect.md` with the canonical front matter and sections, including an implementation outline and required tests under "Decisions".
- For significant decisions (new endpoint, schema change, new dependency, security or PHI change): `docs/adr/NNNN-kebab-title.md` from `docs/adr/0000-template.md` with `Status: proposed`.
- Final message to the main session: a short summary and the paths written.

## tools

- Read
- Grep
- Glob
- Write (only `docs/adr/` and `.ai-sdlc/runs/`, enforced by the agent-scoped `PreToolUse` hook)

## permissions

Frontmatter: `tools: Read, Grep, Glob, Write` (allowlist) and `disallowedTools: Agent, Bash, NotebookEdit, WebFetch, WebSearch` as a second guard, so the agent cannot delegate, run commands or reach the network (no prompt-injection or PHI egress path through WebFetch). `permissionMode: acceptEdits` lets it write the ADR and handoff without prompting; that is safe only because Write path rules are never consulted by Claude Code, so scope is enforced by a `PreToolUse` hook in the agent's own `hooks` frontmatter: `node agents/tool-guard.mjs write-scope docs/adr/ .ai-sdlc/runs/` exits 2 for any other path. The subagent's `permissionMode` is ignored when the parent runs in `bypassPermissions`, `acceptEdits` or `auto`; the hook still applies. Project `deny` rules for `.env`, `**/secrets/**` and `**/*.phi.*` apply as for every agent.

## must

- Present at least two options with pros, cons, risk and impact on PHI, security, performance and migrations. [convention: architect golden tasks in module 09-agent-evaluation]
- Cite `path:line` or an ADR for every claim about current behaviour. [convention: human design review of the handoff]
- Write ADRs with `Status: proposed` and the next free number. [convention: human ADR approval; checked in review]
- Set `status: needs-human` and `next: human` whenever it wrote an ADR, changed a public API contract, or touched PHI handling. [mechanism: the orchestrator reads `status` and stops the workflow; `.claude/hooks/check-handoff.mjs` (module 08) validates the front matter]
- Write only under `docs/adr/` and `.ai-sdlc/runs/`. [mechanism: agent-scoped `PreToolUse` hook `agents/tool-guard.mjs write-scope`, exit 2]

## mustNot

- Edit anything under `sample-app/`. [mechanism: write-scope hook exits 2; Edit is not in `tools`]
- Run shell commands or fetch URLs. [mechanism: Bash, WebFetch and WebSearch absent from `tools` and listed in `disallowedTools`]
- Delegate to other agents. [mechanism: `Agent` absent from `tools` and listed in `disallowedTools`]
- Mark an ADR `accepted`. [convention: `docs/adr/0000-template.md` status is set by the deciders; human review]
- Put PHI in an ADR or handoff; examples use synthetic data such as `MRN-000123`. [convention: `context/security/phi-and-secrets-policy.md`; the `block-secrets` hook covers secrets only]

## failureConditions

- The requirement is ambiguous in a way that changes the design (for example whether "search by name" includes given names): `status: blocked` with the exact questions.
- The requirement contradicts an accepted ADR: `status: blocked`, naming the ADR.
- A write is blocked by the hook: `status: blocked`, recording the path it needed; no retry through another path.
- The run hits `maxTurns` (30): `status: blocked` rather than a partial option list presented as complete.

## validation

Run `node agents/check-agents.mjs` (exit 0) to confirm the runtime file matches this contract, and `node docs/foundations/validate-contract.mjs agents/architect/CONTRACT.md` for the contract itself. The write scope is tested offline by piping a `Write` hook input for `sample-app/src/main/java/X.java` into `agents/tool-guard.mjs write-scope docs/adr/ .ai-sdlc/runs/` and expecting exit 2. Output quality is measured against the architect golden tasks in `evaluations/` (module 09), comparing with the v1 snapshot `evaluations/agent-versions/architect-v1.md`; a human checks that every option names its PHI and migration impact.

## handoffFormat

Markdown file `.ai-sdlc/runs/<run-id>/NN-architect.md` with YAML front matter `run_id`, `step`, `agent: architect`, `status` (`complete | blocked | needs-human`), `inputs` (run-folder files read), `next` (`developer` or `human`), as defined in `workflows/README.md`. Sections in order: `## Summary`, `## Findings` (table `id | severity | category | location | evidence | recommendation`, ids `ARC-001`...), `## Decisions` (chosen option, rejected options with reasons, implementation outline, required tests), `## Open questions`, `## Artifacts` (every path written).

## humanGate

A human approves the design before implementation. When the architect writes an ADR or changes an API contract it sets `status: needs-human`, and the orchestrator stops until a person approves; in the `/feature` workflow that approval happens in plan mode (the main session presents the plan and waits for the human to accept it). The ADR itself moves from `proposed` to `accepted` only through human pull-request approval.
