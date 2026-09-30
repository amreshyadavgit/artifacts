# Decision record: one large agent vs specialised agents (Frappe edition)

- Status: accepted
- Date: 2026-09-30
- Scope: how the AI-SDLC roster is split (`.claude/agents/`), module 07-agent-composition

## Context

The candidate setup is a single `sdlc-monolith` subagent (starting file of exercise 07-split-the-monolith) with every tool inherited and seven skills preloaded: it would plan, edit DocType JSON, write the patch, run `bench`, and review the same diff in one context. On `spice_lite` that design is exposed to four failure modes; the first two are visible in real artifacts of this repository:

1. **It reviews its own schema change.** In the example run `workflows/examples/feature-observation-code-vocabulary/`, the developer step copied the `Clinician` DocPerm row from `sl_patient.json` (create, write) into a new DocType. Two independent agents caught it (tester TST-2, security SEC-1 high). An agent reviewing its own diff shares the blind spot that produced it.
2. **It can trust the exit code.** `bench --site test.localhost run-tests` exits 0 on failures unless `CI` is set: the tester step in the same example printed `FAILED (failures=1, errors=1)` and exited 0. The roster's handoff Claude Code hook requires the quoted `Ran N tests` / `OK` lines; a monolith that checks `$?` reports success.
3. **Its tool surface is the union.** Omitting `tools` means inheriting everything, including `Agent` and every MCP tool; one prompt injection in a ticket reaches `Bash` on a bench where `bench --site * execute` is one approval away.
4. **A failure loses the whole run.** A rejected migrate prompt leaves no intermediate artifact to resume from.

## Measurements (2026-09-30, this repository)

`node workflows/composition/context-budget.mjs` with the monolith installed (characters / 4, a rough estimate):

| agent | body | preloaded skills | start-up total | preloaded |
|---|---|---|---|---|
| sdlc-monolith | 197 | 11578 | 14858 | 7 skills |
| sre | 1757 | 3636 | 8475 | performance-review, production-rca |
| tester | 1623 | 2395 | 7101 | test-strategy, run-tests |
| reviewer | 2282 | 1678 | 7043 | code-review |
| security | 1613 | 2262 | 6958 | security-review |
| architect | 1657 | 1608 | 6348 | architecture-review |
| developer | 2031 | 998 | 6112 | run-tests |
| orchestrator | 1625 | 0 | 4709 | none |

Every agent also pays CLAUDE.md with its three imports (about 3083 tokens). The monolith's start-up context is about 1.7 to 3 times that of any specialist, on every launch, including a one-line fix. `node workflows/composition/check-roster-flat.mjs` rejects it: `"sdlc-monolith" omits tools, so it inherits every tool including Agent`.

## Options considered

| Criterion | One large agent | Specialised roster (chosen) |
|---|---|---|
| Context size at start | CLAUDE.md + imports + body + **every** preloaded skill, paid on every task | CLAUDE.md + imports + a short body + 1-2 skills; each subagent starts fresh |
| Tool surface | Union of all needs: Edit, Write, Bash (all of `bench`), MCP | Per role: security has Read, Grep, Glob only; reviewer's Bash is limited to read-only `git` by its guard; only the developer may request `bench migrate`, and only as a prompt |
| Auditability | One transcript, decisions interleaved | One handoff per step in `.ai-sdlc/runs/<run-id>/`, validated by `check-handoff.mjs`; each delegation is a visible `Agent` call; the security decision is a file computed from the diff |
| Cost | Fewer launches; large context re-read every turn; one model for everything | More launches, each small; model per role (`opus` architect, security, sre; `sonnet` developer, tester, reviewer, orchestrator) |
| Failure isolation | A failure stops everything; no resume point | A failed step is retried alone; completed handoffs are not redone |
| Independence of review | Author reviews its own DocType JSON, patch and `permissions` array | Reviewer and security never wrote the code and cannot edit it |
| Latency | One sequential context | Independent steps (tester, security) run in parallel |
| Coordination overhead | None | Needs an orchestrator, a handoff format, and gates |

## Decision

Use the specialised roster (architect, developer, reviewer, tester, security, sre) with a single orchestrator that sequences them. The coordination overhead is paid once, in `workflows/README.md` and `.claude/agents/orchestrator.md`, and every later workflow reuses it.

Keep a single agent, or just the main session, for tasks that are small, low-risk and not reviewed separately: explaining a whitelisted method end to end (`/explain-endpoint`, module 02), running and parsing the test suite (`/run-tests`), checking `patches.txt` ordering with a script (module 06).

## Consequences

- Positive: each agent's contract is small enough to evaluate with golden tasks (module 09); a regression in the security prompt does not affect the developer.
- Negative: more files to maintain; handoffs must carry everything the next agent needs (paths, quoted bench output), because a subagent never sees the main-session history.
- Follow-up: measure cost per run with `total_cost_usd` from `claude -p --output-format json` (module 09) and revisit if orchestration overhead exceeds 20 % of run cost.

## Verification

- `node workflows/composition/check-roster-flat.mjs` exits 0 once the monolith is removed (only the orchestrator delegates).
- `node workflows/composition/context-budget.mjs` shows every roster agent below 9,000 estimated start-up tokens.
- `node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary` passes: one handoff per step.
