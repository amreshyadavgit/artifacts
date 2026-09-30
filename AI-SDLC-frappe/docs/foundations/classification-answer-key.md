# Answer key: classify twelve needs on a Frappe team

Exercise `01-classify-primitives` (module 01-foundations, Frappe edition). For each need, pick exactly
one primary answer from `prompt | skill | agent | workflow | mcp | claude-code-hook | frappe-hook`.
The grader (`docs/foundations/grade-classification.mjs`) reads the table below: column `answer` is the
primary answer, column `accepted` lists other answers that earn full marks when the justification is sound.
A bare `hook` is not an answer in this repo (CLAUDE.md rule 5): the grader marks it `AMBIGUOUS` and gives no point.

The first six are Claude Code primitives for building the SDLC system. `frappe-hook` is not one of
them: it is product code in an app's `hooks.py` (`doc_events`, `scheduler_events`, `permission_query_conditions`, ...)
that runs inside the Frappe site. It is on the list because the word "hook" makes people confuse the two.

Decision order used for the key (first "yes" wins):

0. Is it behaviour of the **running app on a site** (a document event, a scheduled job, who may see which rows)? -> `frappe-hook` (or a controller method). It ships through the normal workflow like any code change.
1. Must it happen **every time** Claude acts, whether or not the model remembers? -> `claude-code-hook` (or a permission rule).
2. Does it need data or actions in a **system outside the repo** (Jira, GitHub, the Frappe site)? -> `mcp`.
3. Does it chain **several roles with a human gate** between them? -> `workflow`.
4. Does it need **its own context, its own tool limits, or an independent opinion**? -> `agent`.
5. Will it be **repeated** by people or agents with the same procedure? -> `skill`.
6. Otherwise it is a one-off -> `prompt`.

| id | need | answer | accepted | justification | repo example |
|---|---|---|---|---|---|
| N01 | Refuse any file write by Claude that contains a Frappe API token (`token <key>:<secret>`) or a `db_password` copied from `site_config.json`. | claude-code-hook | none | Policy must hold even when the model ignores instructions. A Claude Code `PreToolUse` hook on `Edit\|Write` that exits 2 is deterministic; a CLAUDE.md rule is only a request. | `.claude/hooks/block-secrets.mjs` |
| N02 | Once, today: ask which existing tests exercise `spice_lite.api.fhir.lastn`. | prompt | none | One-off question with no reuse, no special tools and no need for isolation. Packaging it would cost more than it saves. | `claude -p "Which tests call spice_lite.api.fhir.lastn?" --permission-mode plan` |
| N03 | A repeatable procedure for reviewing a Frappe diff (Python, DocType JSON, `patches.txt`, `hooks.py`) against `context/standards/review-standards.md`, producing six-field findings, usable by a human with `/code-review` and preloaded by the reviewer agent. | skill | none | Same procedure every time, invoked by people and preloaded into an agent. A skill keeps the steps and the output template in one versioned file with supporting files. | `.claude/skills/code-review/SKILL.md` (module 03) |
| N04 | An independent second opinion on a diff, from something that starts with a clean context and physically cannot edit files or run `bench`. | agent | none | Needs isolation (fresh context, no author bias) and a tool boundary (`tools: Read, Grep, Glob, Bash` with Bash limited to git). Only a subagent gives both. | `.claude/agents/reviewer.md` (module 05) |
| N05 | Deliver a feature: requirements, architect ADR, developer change (DocType JSON, controller, patch, tests), reviewer and security findings, then human approval before merge and before anyone migrates a shared site. | workflow | none | Several roles in a fixed order with gates and handoff files between them. No single agent should own all of it. | `workflows/feature-delivery.md` and `/feature` (module 08) |
| N06 | Pull the summary and acceptance criteria of a Jira ticket into the requirements step. | mcp | none | The data lives in an external system. An MCP server exposes it as tools (`mcp__<server>__<tool>`) that permission rules can allow or deny per tool. | `.mcp.json` and `/ticket-intake` (module 06) |
| N07 | `/run-tests`: run `bench --site test.localhost run-tests --app spice_lite` from the bench and summarise failures with module and test name. | skill | none | A named, repeatable procedure with a user-invoked entry point. The bench command is already on the project allow list, and `allowed-tools` can pre-approve the parser script for that turn. | `.claude/skills/run-tests/SKILL.md` (module 02) |
| N08 | Do not let a subagent finish until its handoff file has valid YAML front matter (`run_id`, `step`, `agent`, `status`, `inputs`, `next`). | claude-code-hook | none | Enforcement at a Claude Code lifecycle event: a `SubagentStop` Claude Code hook that exits 2 forces the agent to continue. Asking nicely in the prompt is not a control. | `.claude/hooks/check-handoff.mjs` (module 08) |
| N09 | Root-cause a backlog on the `long` RQ queue from worker logs and `RQ Job` / `Error Log` excerpts, and propose (not apply) a fix. | agent | skill | Needs a read-only tool boundary and its own context for long log reading, so an agent (`sre`). The analysis procedure itself is the `production-rca` skill the agent preloads, so `skill` is accepted if the answer says it runs inside the `sre` agent. | `.claude/agents/sre.md` preloading `production-rca` (modules 04, 05) |
| N10 | While designing tests, look up PHI-safe counts of `SL Observation` rows per LOINC code on the running test site, read-only. | mcp | none | Live data behind the Frappe REST API, reused by several agents, with a read-only boundary best enforced at the tool level (a read-only API user). | `mcp/` server (module 06) |
| N11 | Whenever an `SL Observation` is saved as `final` on the Kenya deployment, enqueue a push of it to the national health information exchange. | frappe-hook | none | This is runtime behaviour of the app on one country's site, not something Claude does. It is a `doc_events` entry (`on_update`) in the Kenya country app's `hooks.py` that calls `frappe.enqueue`. A Claude Code hook fires on Claude's tool calls, never on a clinician saving a form. | `hooks.py` `doc_events` (commented example in `spice_lite/hooks.py`; the country-app decision is taught in module 03) |
| N12 | Stop Claude from editing an existing line of `spice_lite/patches.txt` (Patch Log keys on the exact line, so the patch would run again on every site). | claude-code-hook | none | It concerns what Claude does to a file, so it is enforced at `PreToolUse` on `Edit\|Write` with a script that exits 2. A `frappe-hook` cannot help: Frappe reads `patches.txt` only at install and `bench migrate`, long after the edit. | a `PreToolUse` Claude Code hook in `.claude/settings.json` (pattern; build it as an improvement of this exercise) |

Common wrong answers and why they lose marks:

- N01 as `prompt` or CLAUDE.md rule: instructions describe intent; only Claude Code hooks and permission rules enforce it.
- N04 as `skill`: a skill runs in the current context (unless `context: fork`), so it shares the author's history and tools.
- N05 as `agent`: one agent doing every role hides the gates; a subagent cannot ask the user questions (`AskUserQuestion` is not available to subagents).
- N08 as `agent`: a checker agent is itself non-deterministic; the check is a script, triggered by a Claude Code hook.
- N11 as `claude-code-hook`: "on save" sounds like `PostToolUse` on `Write`, but the save happens in the Frappe desk or API, where Claude is not involved.
- N12 as `frappe-hook`: `hooks.py` has no key that runs when a file in the repo changes; `before_migrate` would run only after the damage is merged.
- Any answer `hook`: say which one. In this repo the word alone is a bug report waiting to happen.
