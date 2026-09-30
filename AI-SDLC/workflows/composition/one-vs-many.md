# Decision record: one large agent vs specialised agents

- Status: accepted
- Date: 2026-09-30
- Scope: how the AI-SDLC roster is split (`.claude/agents/`), module 07-agent-composition

## Context

The first working setup was a single `sdlc` subagent with every tool and every skill preloaded: it planned, coded, tested, reviewed and security-checked the same diff in one context. It worked on small changes and failed in three repeatable ways on the sample app:

1. It reviewed its own code. On a change to `PatientController.search` it wrote the code, then "reviewed" it and reported no findings, including a `Bundle.total` that counted the page instead of all matches.
2. Its start-up context carried all seven review skills even for a one-line fix (measure it with `node workflows/composition/context-budget.mjs`).
3. A failure anywhere (a hung `mvn` run, a wrong assumption in the plan) lost the whole run; there was no intermediate artifact to resume from.

## Options considered

| Criterion | One large agent | Specialised roster (chosen) |
|---|---|---|
| Context size at start | CLAUDE.md + imports + body + **every** preloaded skill, paid on every task | CLAUDE.md + imports + a short body + 1-2 skills per agent; each subagent starts with a fresh context |
| Tool surface | Union of all needs: Edit, Write, Bash, kubectl, MCP; one prompt injection reaches all of it | Per role: security has Read, Grep, Glob only; reviewer's Bash is limited to `git diff/log/show/status` by a `PreToolUse` guard |
| Auditability | One transcript, decisions interleaved; no artifact per decision | One handoff per step in `.ai-sdlc/runs/<run-id>/`, validated by `check-handoff.mjs`; each delegation is a visible `Agent` call |
| Cost | Fewer turns on tiny tasks; large context re-read every turn; one model for everything | More launches, but each is small; model per role (`opus` for architect/security, `sonnet` for developer/tester/reviewer) |
| Failure isolation | A failure stops everything; no resume point | A failed step is retried alone; completed handoffs are not redone |
| Independence of review | Author reviews itself | Reviewer and security never wrote the code and cannot edit it |
| Latency | One sequential context | Independent steps (tester, security) run in parallel |
| Coordination overhead | None | Needs an orchestrator, a handoff format, and gates |

## Decision

Use the specialised roster (architect, developer, reviewer, tester, security, sre) with a single orchestrator that sequences them. The coordination overhead is paid once, in `workflows/README.md` and `.claude/agents/orchestrator.md`, and every later workflow reuses it.

Keep a single agent (or no agent: the main session) for tasks that are small, low-risk and not reviewed separately: explaining an endpoint (`/explain-endpoint`, module 02), running tests (`/run-tests`).

## Consequences

- Positive: each agent's contract is small enough to evaluate with golden tasks (module 09); a security regression in one prompt does not affect the others.
- Negative: more files to maintain; handoffs must carry everything the next agent needs, because a subagent never sees the main-session history.
- Follow-up: measure cost per run with `total_cost_usd` from `claude -p --output-format json` (module 09) and revisit if orchestration overhead exceeds 20 % of run cost.

## Verification

- `node workflows/composition/check-roster-flat.mjs` exits 0 (only the orchestrator delegates).
- `node workflows/composition/context-budget.mjs` shows every roster agent below 6,000 estimated start-up tokens.
- Every example run in `workflows/examples/` has one handoff per step.
