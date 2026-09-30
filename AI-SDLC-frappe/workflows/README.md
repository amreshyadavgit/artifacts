# Workflows and the handoff format (Frappe edition)

A **workflow** is a documented, ordered composition of agents, skills and human gates. The orchestrator (`.claude/agents/orchestrator.md`, contract `agents/orchestrator/CONTRACT.md`) executes these specs. The specs are the source of truth for step order, conditions, gates and the retry policy.

| Workflow | Entry point | Spec |
|---|---|---|
| Feature delivery | `/feature OBS-51 Controlled vocabulary for Observation codes` | [feature-delivery.md](feature-delivery.md) |
| Bug fix | `/bug-fix BUG-63 effectiveDateTime has no UTC offset` | [bug-fix.md](bug-fix.md) |
| Incident response | `/incident INC-311 lastn p95 above 2s since 14:05 UTC` | [incident-response.md](incident-response.md) |

Two ways to run any workflow:

```bash
cd AI-SDLC-frappe
# 1. Orchestrator as the main thread: the Agent(...) allowlist in its tools is enforced.
claude --agent orchestrator --settings workflows/gates.settings.json
#    then type: /feature OBS-51 Controlled vocabulary for Observation codes

# 2. Ordinary main session: the /feature skill turns the main session into the orchestrator.
#    The allowlist is NOT enforced in this mode (module 07-agent-composition).
claude --settings workflows/gates.settings.json
```

`workflows/gates.settings.json` adds a permission `ask` rule on `Agent(developer)`, so every developer launch (first implementation and every rework) waits for a human. Run gated workflows in `default` permission mode. Which modes suppress prompts, and how an organisation pins them, is module 10-governance (`docs/governance/`).

## Run folder

Every run writes to `.ai-sdlc/runs/<run-id>/` (git-ignored).

- **Run id**: `YYYY-MM-DD-<feat|bug|inc>-<kebab-slug>`, for example `2026-09-30-feat-observation-code-vocabulary`. The slug never contains patient data.
- **Files**: `NN-<agent>.md` for agent steps (`02-architect.md`, `04-developer.md`, `08-reviewer.md`) and `NN-<skill>.md` for steps the orchestrator runs itself with a skill (`01-requirements.md`, `03-implementation-plan.md`). `NN` is the two-digit step number from the spec. Skipped steps leave their number unused. Rework takes the next free number (`07-developer.md` after `06-security.md`). The last file is `NN-run-report.md`.
- **Active marker**: at run start the orchestrator writes the run id to `.ai-sdlc/runs/.active`; at the end it overwrites it with `none`. While a run is active, the `SubagentStop` Claude Code hook refuses to let a roster agent finish without a valid handoff.
- **Security scope record**: when a developer subagent stops during a run, the same hook classifies the working-tree diff with `workflows/composition/security-scope.mjs` and writes `.ai-sdlc/runs/<run-id>/security-scope.txt` (`SECURITY STEP: MANDATORY (rules ...)` with the triggering lines, or `SECURITY STEP: SKIP (...)`). The orchestrator has no Bash, so this file is how a deterministic diff check reaches it. A missing file counts as MANDATORY.
- **Who writes**: agents with a Write tool scoped to the run folder (architect, developer, tester; module 05-agent-roster) write their own `NN-<agent>.md`. Agents without Write (reviewer, security, sre) **return the handoff document as their final message**, and the orchestrator saves it verbatim. Any agent may end its final message with `HANDOFF: .ai-sdlc/runs/<run-id>/NN-<agent>.md` to point at the file it wrote.

A complete example run, whose developer and tester steps were applied to `spice_lite` and tested for real, lives in [examples/feature-observation-code-vocabulary/](examples/feature-observation-code-vocabulary/).

## Handoff format (canonical)

Every step ends with one Markdown document with this YAML front matter and these five sections:

```markdown
---
run_id: 2026-09-30-feat-observation-code-vocabulary
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
| `inputs` | YAML flow list of earlier run files (`[01-requirements.md]`) or external references (`ticket:OBS-51`, `incident:INC-311`). `[]` if none. |
| `next` | The agent the producer expects next, `human`, or `none`. The orchestrator decides; `next` is advisory. |

Section rules:
- `## Findings`: a table with exactly the columns `id | severity | category | location | evidence | recommendation`, severities `critical | high | medium | low | info` (`context/standards/review-standards.md`), or the sentence `No findings.`
- `## Open questions`: must contain a concrete item when `status` is `blocked` or `needs-human`.
- `## Artifacts`: every file the step created or changed, repo-relative. For a Frappe change this lists the DocType JSON, controller, `patches.txt` line, patch module, fixture file and tests separately, so a reader sees at a glance whether a schema change shipped without a patch.
- **Test evidence (developer, tester)**: a `complete` handoff quotes the bench summary lines (`Ran 56 tests in 4.361s` and `OK`). `bench --site test.localhost run-tests` exits 0 even when tests fail unless the `CI` environment variable is set (`frappe/commands/utils.py`, `if os.environ.get("CI"): sys.exit(ret)`), so an exit code is not evidence. A handoff that quotes `FAILED (` cannot be `complete`.
- No PHI anywhere in a handoff: synthetic identifiers only (`MRN-000123`), document names (`SLP-00042`), never names, MRNs or search terms from a real site.

## Validation

`.claude/hooks/check-handoff.mjs` enforces the rules above.

```bash
# Validate files or a whole run folder (exit 0 = all valid, 1 = at least one invalid)
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary
# Tests (subprocess runs with real SubagentStop payloads)
node .claude/hooks/check-handoff.test.mjs
```

As a `SubagentStop` Claude Code hook (matcher `architect|developer|reviewer|tester|security|sre`) it finds the handoff in this order: a `HANDOFF: <path>` line in `last_assistant_message`; then, only while `.ai-sdlc/runs/.active` names a run, the inline handoff in `last_assistant_message`, then the newest file in the active run folder whose `agent` is this subagent. It exits `2` with the reasons on stderr when the handoff is invalid or missing, which makes the subagent continue and fix it. The orchestrator's retry policy (one retry, then `needs-human`) bounds how long an agent can fail the check. Outside an active run, roster agents used ad hoc are not checked. It is registered in the orchestrator's frontmatter `hooks` and in the `feature`, `bug-fix` and `incident` skills' frontmatter `hooks`. It is deliberately not in `.claude/settings.json`: frontmatter hooks fire when the orchestrator runs as the main session through `--agent`, and skill hooks stay registered for the rest of the session once `/feature`, `/bug-fix` or `/incident` is invoked, so every workflow run is covered. The one gap is the workspace-trust rule: a project agent's frontmatter hooks are skipped in a folder whose trust dialog was never accepted, so trust the folder once before a headless `claude -p --agent orchestrator` run (or start it through a skill, whose hooks run without trust). Adding the same command to settings would fire it on every roster subagent stop in every session; outside an active run it passes anyway.

## Gates at a glance

| Gate | Where | Mechanism | Details |
|---|---|---|---|
| G1 plan approval | before every developer launch | `ask` rule on `Agent(developer)` in `workflows/gates.settings.json` | the human reads 01..03 and accepts or rejects the prompt |
| G1b schema on the test site | inside the developer step, when DocType JSON changed | `bench --site test.localhost migrate` is an `ask` entry in the developer's bash guard (module 05) and an `ask` rule in `.claude/settings.json` (module 10) | the human sees exactly which site is migrated |
| G2 findings | after tester/security, before rework or review; after review | orchestrator stops with `needs-human` on `blocked`, any `critical`/`high`, or an undecided `medium`; rework needs another `Agent(developer)` approval | decision recorded in the next handoff and the run report |
| G3 merge | after the run report | human PR review; `git push` is `ask` and `gh pr merge` is denied in `.claude/settings.json`; agents never push or merge (CLAUDE.md rule 9) | CODEOWNERS for `**/doctype/**`, `patches.txt`, `hooks.py`: module 10 |
