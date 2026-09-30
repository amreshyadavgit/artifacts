# Answer key: classify ten SDLC needs

Exercise `01-classify-primitives` (module 01-foundations). For each need, pick exactly one primary
primitive from `prompt | skill | agent | workflow | mcp | hook`. The grader
(`docs/foundations/grade-classification.mjs`) reads the table below: column `answer` is the primary
answer, column `accepted` lists other answers that earn full marks when the justification is sound.

Decision order used for the key (first "yes" wins):

1. Must it happen **every time**, whether or not the model remembers? -> `hook` (or a permission rule).
2. Does it need data or actions in a **system outside the repo**? -> `mcp`.
3. Does it chain **several roles with a human gate** between them? -> `workflow`.
4. Does it need **its own context, its own tool limits, or an independent opinion**? -> `agent`.
5. Will it be **repeated** by people or agents with the same procedure? -> `skill`.
6. Otherwise it is a one-off -> `prompt`.

| id | need | answer | accepted | justification | repo example |
|---|---|---|---|---|---|
| N01 | Refuse any file write that contains an AWS access key or a hard-coded password. | hook | none | Policy must hold even when the model ignores instructions. A `PreToolUse` hook on `Edit\|Write` that exits 2 is deterministic; a CLAUDE.md rule is only a request. | `.claude/hooks/block-secrets.mjs` |
| N02 | Once, today: ask which existing tests exercise `GET /fhir/Observation/$lastn`. | prompt | none | One-off question with no reuse, no special tools and no need for isolation. Packaging it would cost more than it saves. | `claude -p "Which tests call /fhir/Observation/\$lastn?" --permission-mode plan` |
| N03 | A repeatable procedure for reviewing a diff against `context/standards/review-standards.md`, producing findings in the six-field format, usable by a human with `/code-review` and preloaded by the reviewer agent. | skill | none | Same procedure every time, invoked by people and preloaded into an agent. A skill keeps the steps and the output template in one versioned file with supporting files. | `.claude/skills/code-review/SKILL.md` (module 03) |
| N04 | An independent second opinion on a diff, from something that starts with a clean context and physically cannot edit files. | agent | none | Needs isolation (fresh context, no author bias) and a tool boundary (`tools: Read, Grep, Glob, Bash`). Only a subagent gives both. | `.claude/agents/reviewer.md` (module 05) |
| N05 | Deliver a feature: requirements, architect ADR, developer change with tests, reviewer and security findings, then human approval before merge. | workflow | none | Several roles in a fixed order with gates and handoff files between them. No single agent should own all of it. | `workflows/feature-delivery.md` and `/feature` (module 08) |
| N06 | Pull the summary and acceptance criteria of a Jira ticket into the requirements step. | mcp | none | The data lives in an external system. An MCP server exposes it as tools (`mcp__<server>__<tool>`) that permission rules can allow or deny per tool. | `.mcp.json` and `/ticket-intake` (module 06) |
| N07 | `/run-tests`: run `mvn -q -B test` in `sample-app/` and summarise failures with file and test name. | skill | none | A named, repeatable procedure with a user-invoked entry point. `allowed-tools` pre-approves the Maven command for that turn. | `.claude/skills/run-tests/SKILL.md` (module 02) |
| N08 | Do not let a subagent finish until its handoff file has valid YAML front matter (`run_id`, `step`, `agent`, `status`, `inputs`, `next`). | hook | none | Enforcement at a lifecycle event: a `SubagentStop` hook that exits 2 forces the agent to continue. Asking nicely in the prompt is not a control. | `.claude/hooks/check-handoff.mjs` (module 08) |
| N09 | Root-cause a latency spike on `$lastn` from logs and the k8s manifests, and propose (not apply) a patch. | agent | skill | Needs a read-only tool boundary and its own context for long log reading, so an agent (`sre`). The analysis procedure itself is the `production-rca` skill the agent preloads, so `skill` is accepted if the answer says it runs inside the `sre` agent. | `.claude/agents/sre.md` preloading `production-rca` (modules 04, 05) |
| N10 | While designing tests, look up synthetic Observation data served by a running FHIR-lite server, read-only. | mcp | none | Live data behind an API, reused by several agents, with a read-only boundary best enforced at the tool level. | `mcp/` FHIR-lite server (module 06) |

Common wrong answers and why they lose marks:

- N01 as `prompt` or CLAUDE.md rule: instructions describe intent; only hooks and permission rules enforce it.
- N04 as `skill`: a skill runs in the current context (unless `context: fork`), so it shares the author's history and tools.
- N05 as `agent`: one agent doing every role hides the gates; a subagent cannot ask the user questions (`AskUserQuestion` is not available to subagents).
- N08 as `agent`: a checker agent is itself non-deterministic; the check is a script, triggered by a hook.
