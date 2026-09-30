# Workflows and the handoff format

A **workflow** is a documented, ordered composition of agents, skills and human gates. The orchestrator (see `.claude/agents/orchestrator.md` and `agents/orchestrator/CONTRACT.md`) executes these specs; the specs are the source of truth for step order, gates and retry policy.

| Workflow | Entry point | Spec |
|---|---|---|
| Feature delivery | `/feature PAT-142 Paginate Patient search` | [feature-delivery.md](feature-delivery.md) |
| Bug fix | `/bug-fix BUG-57 Family search ignores trailing spaces` | [bug-fix.md](bug-fix.md) |
| Incident response | `/incident INC-311 p95 latency on $lastn above 2s` | [incident-response.md](incident-response.md) |

Two ways to run any workflow:

```bash
cd AI-SDLC
# 1. Orchestrator as the main thread: the Agent(...) allowlist in its tools is enforced.
claude --agent orchestrator --settings workflows/gates.settings.json
#    then type: /feature PAT-142 Paginate Patient search

# 2. Ordinary main session: the /feature skill turns the main session into the orchestrator.
claude --settings workflows/gates.settings.json
#    then type: /feature PAT-142 Paginate Patient search
```

`workflows/gates.settings.json` adds a permission `ask` rule on `Agent(developer)`, so every launch of the developer (first implementation and every rework) waits for a human. Run gated workflows in `default` permission mode. Governance of modes and rules is covered in module 10 (`docs/governance/`).

## Run folder

Every run writes to `.ai-sdlc/runs/<run-id>/` (git-ignored).

- **Run id**: `YYYY-MM-DD-<feat|bug|inc>-<kebab-slug>`, e.g. `2026-09-30-feat-patient-pagination`.
- **Files**: `NN-<step-name>.md`, `NN` = two-digit step number from the workflow spec. Rework steps take the next free number (e.g. `07-developer.md` after `06-security.md`). The last file is `NN-run-report.md` written by the orchestrator.
- **Active marker**: at run start the orchestrator writes the run id to `.ai-sdlc/runs/.active`; at the end it overwrites it with `none`. While a run is active, the `SubagentStop` hook refuses to let a roster agent finish without a handoff.
- **Who writes**: only the orchestrator writes into the run folder. Read-only agents (reviewer, security, sre, architect) cannot write files, so every subagent **returns its handoff as its final message** and the orchestrator saves it verbatim. An agent that writes its own file instead ends its final message with `HANDOFF: .ai-sdlc/runs/<run-id>/NN-<step>.md`.

A complete example run lives in [examples/feature-patient-pagination/](examples/feature-patient-pagination/).

## Handoff format (canonical)

Every step ends with one Markdown document with this YAML front matter and these five sections:

```markdown
---
run_id: 2026-09-30-feat-patient-pagination
step: 04
agent: developer
status: complete        # complete | blocked | needs-human
inputs: [03-implementation-plan.md]
next: tester
---
## Summary
## Findings            # table: id | severity | category | location | evidence | recommendation
## Decisions
## Open questions
## Artifacts           # paths written
```

| Field | Rule |
|---|---|
| `run_id` | Equals the run folder name. |
| `step` | Two digits; equals the file name prefix. |
| `agent` | One of `architect`, `developer`, `reviewer`, `tester`, `security`, `sre`, `orchestrator`; equals the subagent that produced it. |
| `status` | `complete` (step done, next step may start), `blocked` (step cannot pass; rework needed), `needs-human` (a human gate or decision is required). |
| `inputs` | YAML flow list of earlier run files (`[01-requirements.md]`) or external references (`ticket:PAT-142`, `incident:INC-311`). `[]` if none. |
| `next` | The agent the producer expects next, `human`, or `none`. The orchestrator decides; `next` is advisory. |

Section rules:
- `## Findings`: a table with exactly the columns `id | severity | category | location | evidence | recommendation`, severities `critical | high | medium | low | info` (see `context/standards/review-standards.md`), or the sentence `No findings.`
- `## Open questions`: must contain a concrete item when `status` is `blocked` or `needs-human`.
- `## Artifacts`: every file the step created or changed, repo-relative. The orchestrator uses the developer's list to decide whether the security step runs.
- No PHI anywhere in a handoff. Synthetic identifiers only (`MRN-000123`).

## Validation

`.claude/hooks/check-handoff.mjs` enforces the rules above.

```bash
# Validate files or a whole run folder (exit 0 = all valid, 1 = at least one invalid)
node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-patient-pagination
# Tests (20 cases, including all example handoffs)
node .claude/hooks/check-handoff.test.mjs
```

As a `SubagentStop` hook (matcher `architect|developer|reviewer|tester|security|sre`) it reads the subagent's `last_assistant_message`, validates the handoff, and exits `2` with the reasons on stderr when it is invalid, which makes the subagent continue and fix it. It is registered in the orchestrator's frontmatter `hooks` and in the `feature`, `bug-fix` and `incident` skills' frontmatter `hooks`.

## Gates at a glance

| Gate | Where | Mechanism | Details |
|---|---|---|---|
| G1 plan approval | before the first developer step | `ask` rule on `Agent(developer)` in `workflows/gates.settings.json` | human reads 01..03 and accepts or rejects the prompt |
| G2 findings | after tester/security, before rework or review | orchestrator stops with `needs-human` on any `critical`/`high` or undecided `medium`; rework needs another `Agent(developer)` approval | decision recorded in the next handoff |
| G3 merge | after code review | human PR review; `git push` is `ask` in `.claude/settings.json`, agents never push or merge (CLAUDE.md rule 7) | branch protection: module 10 |
