# Hierarchy and depth: the real limits, and why the roster stays flat

## The limits (Claude Code docs, `build/CLAUDE_CODE_FACTS.md` §1)

- A subagent **can** spawn subagents of its own, up to **three layers below the main conversation** by default (v2.1.219+; older versions differed, and versions before 2.1.172 allowed no nesting at all).
- `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes the limit (`"2"`, or `"1"` to turn nesting off). It can be set in the `env` block of a settings file.
- At the depth limit Claude Code **withholds the `Agent` tool** from every subagent except a fork, so a subagent at the limit does its work itself and returns one summary. A fork cannot spawn further forks.
- To stop a particular subagent from delegating: omit `Agent` from its `tools`, or add `Agent` to `disallowedTools`. An agent that omits `tools` inherits every tool, including `Agent`.
- `Agent(architect, developer)` in `tools` is an **allowlist of spawnable types only for an agent running as the main thread** (`claude --agent <name>` or the `agent` setting). In a subagent definition the parenthesised list is ignored: listing `Agent(...)` there simply grants `Agent`.
- `permissions.deny: ["Agent(general-purpose)"]` (settings) blocks a subagent type everywhere, at any depth.

## The course topology (depth 1)

```text
depth 0  main thread: claude --agent orchestrator        tools: Agent(architect, developer, reviewer, tester, security, sre), Read, Write, Grep, Glob, Skill
depth 1  architect | developer | reviewer | tester | security | sre   no Agent in tools
```

`node workflows/composition/check-roster-flat.mjs` enforces it: roster agents must list `tools` without `Agent`, and the orchestrator may only name roster types.

## The one sanctioned depth-2 pattern

Sometimes you are already deep in an ordinary interactive session and want to hand a whole workflow to the orchestrator without restarting. You can run the orchestrator **as a subagent**:

```text
depth 0  main session (plain `claude --settings workflows/composition/depth-2.settings.json`)
depth 1  orchestrator (launched with @agent-orchestrator)
depth 2  architect | developer | reviewer | tester | security | sre   (Agent withheld: depth limit 2)
```

`workflows/composition/depth-2.settings.json` makes this safe:

| Setting | Why |
|---|---|
| `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "2"` | Roster agents at depth 2 are at the limit, so `Agent` is withheld even if someone later adds it to a roster file. |
| `permissions.deny: ["Agent(general-purpose)"]` | As a subagent, the orchestrator's `Agent(...)` allowlist is **ignored**; the deny rule replaces it for the most dangerous type. |
| `permissions.ask: ["Agent(developer)"]` | Gate G1 still applies; the prompt from the background orchestrator surfaces in the main session. |

What you give up at depth 2, and why it is the exception:

1. **Allowlist lost.** Only the deny rule constrains which types the orchestrator can launch; Explore, Plan and any new custom agent are reachable.
2. **Double summarisation.** Roster results return to the orchestrator as summaries, and the orchestrator's result returns to you as a summary of summaries. Only the handoff files keep full detail; read the run folder, not the chat.
3. **Waiting semantics.** Interactively, the orchestrator waits for its background children; under `claude -p` or the Agent SDK it does not, so a headless depth-2 run can end before its steps finish. Never run depth 2 headless.
4. **Audit trail split.** Delegations appear in the orchestrator's subagent transcript, not in your main transcript.

## Why the roster itself never delegates

- **Auditability**: every delegation is an `Agent` call by the orchestrator and a handoff file. A reviewer that quietly launches a helper produces findings nobody can trace.
- **Enforceable scope**: the only place Claude Code enforces a spawnable-type allowlist is the main thread.
- **Cost predictability**: each nested level multiplies launches and start-up context (measure with `context-budget.mjs`).
- **Failure isolation**: a nested failure surfaces two levels up as a vague summary instead of a `blocked` handoff with evidence.
- **Handoffs through files, not context**: a subagent at any depth starts fresh, so the next step needs a file anyway. Once you have files, nesting buys nothing that sequencing in the orchestrator does not.
