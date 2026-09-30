# Execution modes: sequential, conditional, parallel (Frappe edition)

How the main session (or the orchestrator running as the main thread) launches subagents, and what comes back. Facts are from the Claude Code sub-agents docs as summarised in `build/CLAUDE_CODE_FACTS.md` §1; course conventions are marked as such.

## What a launch is

The main session calls the `Agent` tool (renamed from `Task` in v2.1.63; `Task(...)` still works as an alias) with a `prompt`, a `description` and a `subagent_type` (for example `security`). The subagent starts with a **fresh context**: its own system prompt (the agent file body), the task message, the CLAUDE.md hierarchy, git status, and its preloaded `skills`. It does not see the main-session history, the Claude Code system prompt, the output style, or auto memory. It does not know where the bench is unless CLAUDE.md or the task message says so.

What comes back to the caller is the subagent's **final message**, as a summary. Everything else the subagent read or ran (every `bench` command, every test traceback) stays in its own transcript (`~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`). Course convention: that final message is the handoff document, or a pointer to it (`workflows/README.md`), and a developer or tester handoff quotes the bench summary lines, so nothing important lives only in a transcript.

## Sequential

Step B needs step A's output. The caller launches A, waits for its result, then launches B with the path of A's handoff.

```text
Use the architect subagent: run 2026-09-30-feat-observation-code-vocabulary, step 02, input .ai-sdlc/runs/2026-09-30-feat-observation-code-vocabulary/01-requirements.md.
```

## Conditional

The caller decides from an earlier artifact whether a step runs. For the security step the artifact is not the developer's opinion but its **diff**: the `SubagentStop` Claude Code hook runs `workflows/composition/security-scope.mjs` when the developer stops and writes `.ai-sdlc/runs/<run-id>/security-scope.txt`. Security is mandatory when the diff touches

1. a DocType `permissions` array or a field `permlevel`,
2. a whitelisted method (`@frappe.whitelist`, `allow_guest`, anything under `spice_lite/api/`),
3. `hooks.py`,
4. `ignore_permissions`,
5. an added `frappe.db.sql(`, `frappe.get_all(`, `frappe.qb.` or `frappe.db.count(` outside tests,
6. fixtures that ship Role or DocPerm records.

Try it on the two fixture patches:

```bash
cd AI-SDLC-frappe
node workflows/composition/security-scope.mjs workflows/composition/fixtures/whitelist-count.patch
node workflows/composition/security-scope.mjs workflows/composition/fixtures/encounter-refactor.patch
node workflows/composition/security-scope.mjs --git          # the current working tree under sample-app/
```

A condition evaluated by a script from the diff is deterministic and auditable; "use the security agent if it seems relevant" is neither. The orchestrator writes the decision and its reason to the run report (course convention).

## Parallel

Independent steps run concurrently when the caller launches them in the same turn. After the developer, tester (step 05) and security (step 06) both read the same diff and write to different places: the tester writes only `spice_lite/tests/**` and `doctype/*/test_*.py` (its write-scope guard, module 05), security writes nothing.

```text
In parallel: launch the tester subagent for step 05 and the security subagent for step 06 of run 2026-09-30-feat-count-observations, both with input 04-developer.md. Wait for both results before deciding anything.
```

Rules that make parallel safe (course convention): no two parallel agents edit the same files; each has a pre-assigned step number and handoff file; the caller evaluates gates only after all parallel results are in. On a bench there is one more shared resource: the **test site**. Two agents running `bench --site test.localhost run-tests` at the same moment share one database; FrappeTestCase rolls back per class, so read-mostly suites usually coexist, but a `migrate` during another agent's test run does not. That is why only the developer migrates (behind the G1b prompt), never a parallel step.

## Foreground, background, fork mode

| Behaviour | Fact |
|---|---|
| Interactive sessions | Fork mode is on by default (v2.1.232+): subagents run in the background, and the main session is notified when each finishes. `Ctrl+B` backgrounds a running task. |
| `claude -p` and Agent SDK | Fork mode is off: subagents run in the foreground. |
| Overrides | `CLAUDE_CODE_FORK_SUBAGENT=1` or `0`; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` forces foreground; agent frontmatter `background: true` always backgrounds that agent. |
| Permission prompts | A background subagent's permission prompts surface in the main session, so the G1 `Agent(developer)` prompt and the developer's `bench --site test.localhost migrate` prompt still reach the human. |
| Background tool set | Background subagents keep MCP tools but only a fixed set of built-ins (Read, Grep, Glob, Bash, Edit, Write, WebFetch, Skill and a few others). |
| Nesting and waiting | Interactive: a subagent that launched background children waits for them. `-p`/SDK: it does not wait. |
| Concurrency limit | 20 running subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`); beyond it the launch fails with `Concurrent subagent limit reached`. |
| Resume | Each launch is a new instance. The caller continues a finished subagent with `SendMessage` to its agent id or name. Built-in Explore and Plan are one-shot. |

**Fork** is a different thing from fork *mode*: a fork (`/subtask <task>`, or subagent type `fork`) inherits the full conversation, system prompt, tools and model of its caller. It is useful for "try this in a side branch of my current context", and wrong for workflow steps: it defeats the fresh-context isolation that makes a reviewer independent, it carries the whole conversation's tokens, and a fork cannot spawn further forks. Workflow steps always use named roster agents.

## How to observe it

```bash
cd AI-SDLC-frappe
patch -p1 < workflows/composition/fixtures/whitelist-count.patch
claude
# In the session, send the parallel prompt above (run 2026-09-30-feat-count-observations).
# Watch "tester" and "security" appear as running tasks at the same time.
ls ~/.claude/projects/*/*/subagents/ | tail -n 4     # one agent-<id>.jsonl per launch
patch -R -p1 < workflows/composition/fixtures/whitelist-count.patch   # clean up
```
