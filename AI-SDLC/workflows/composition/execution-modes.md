# Execution modes: sequential, conditional, parallel

How the main session (or the orchestrator running as the main thread) launches subagents, and what comes back. Facts are from the Claude Code sub-agents docs as summarised in `build/CLAUDE_CODE_FACTS.md` §1; course conventions are marked as such.

## What a launch is

The main session calls the `Agent` tool (renamed from `Task` in v2.1.63; `Task(...)` still works as an alias) with a `prompt`, a `description` and a `subagent_type` (for example `reviewer`). The subagent starts with a **fresh context**: its own system prompt (the agent file body), the task message, the CLAUDE.md hierarchy, git status, and its preloaded `skills`. It does not see the main-session history, the Claude Code system prompt, the output style, or auto memory.

What comes back to the caller is the subagent's **final message**, as a summary. Everything else the subagent read or tried stays in its own transcript (`~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`). Course convention: that final message is the handoff document, or a pointer to it (`workflows/README.md`), so nothing important lives only in a transcript.

## Sequential

Step B needs step A's output. The caller launches A, waits for its result, then launches B with the path of A's handoff.

```text
Use the architect subagent: run 2026-09-30-feat-patient-pagination, step 02, input .ai-sdlc/runs/2026-09-30-feat-patient-pagination/01-requirements.md.
```

## Conditional

The caller decides from an earlier handoff whether a step runs. In the feature workflow the orchestrator reads `04-developer.md` `## Artifacts`; the security step runs only if a path is under `api/`, `config/`, `error/`, `audit/`, `src/main/resources/`, `k8s/`, `pom.xml` or `Dockerfile`. The decision and its reason are written to the run report (course convention). A condition evaluated by reading a file is deterministic and auditable; "use the security agent if it seems relevant" is neither.

## Parallel

Independent steps run concurrently when the caller launches them in the same turn. In the feature workflow, tester (step 05) and security (step 06) both read the developer's diff and write to different places (tests vs. nothing), so they can overlap.

```text
In parallel: launch the tester subagent for step 05 and the security subagent for step 06 of run 2026-09-30-feat-patient-pagination, both with input 04-developer.md. Wait for both results before deciding anything.
```

Rules that make parallel safe (course convention): no two parallel agents edit the same files; each has a pre-assigned step number and handoff file; the caller evaluates gates only after all parallel results are in.

## Foreground, background, fork mode

| Behaviour | Fact |
|---|---|
| Interactive sessions | Fork mode is on by default (v2.1.232+): subagents run in the background, and the main session is notified when each finishes. `Ctrl+B` backgrounds a running task. |
| `claude -p` and Agent SDK | Fork mode is off: subagents run in the foreground. |
| Overrides | `CLAUDE_CODE_FORK_SUBAGENT=1` or `0`; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` forces foreground; agent frontmatter `background: true` always backgrounds that agent. |
| Permission prompts | A background subagent's permission prompts surface in the main session, so the G1 `Agent(developer)` prompt and any `ask` rule still reach the human. |
| Background tool set | Background subagents keep MCP tools but only a fixed set of built-ins (Read, Grep, Glob, Bash, Edit, Write, WebFetch, Skill and a few others). |
| Nesting and waiting | Interactive: a subagent that launched background children waits for them. `-p`/SDK: it does not wait. |
| Concurrency limit | 20 running subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`); beyond it the launch fails with `Concurrent subagent limit reached`. |
| Resume | Each launch is a new instance. The caller continues a finished subagent with `SendMessage` to its agent id or name. Built-in Explore and Plan are one-shot. |

**Fork** is a different thing from fork *mode*: a fork (`/subtask <task>`, or subagent type `fork`) inherits the full conversation, system prompt, tools and model of its caller. It is useful for "try this in a side branch of my current context", and wrong for workflow steps: it defeats the fresh-context isolation that makes a reviewer independent, it carries the whole conversation's tokens, and a fork cannot spawn further forks. Workflow steps always use named roster agents.

## How to observe it

```bash
cd AI-SDLC
claude --agent orchestrator --settings workflows/gates.settings.json
# In the session:
#   /feature PAT-142 Paginate Patient search
# After step 04, watch both "tester" and "security" appear as running tasks at the same time.
ls ~/.claude/projects/*/*/subagents/ | tail -n 4     # one agent-<id>.jsonl per launch
stat -c '%y %n' .ai-sdlc/runs/*/05-tester.md .ai-sdlc/runs/*/06-security.md
```
