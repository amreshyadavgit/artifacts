# AI-SDLC reference repository

A working AI-assisted software delivery system built with Claude Code, and the service it operates on. It is the reference repository of the course **AI-SDLC: Agent & Skill Engineering with Claude Code**. Everything here is real and runnable: agents, skills, hooks, workflows, an MCP server, an eval harness, governance checks, and a Java 21 / Spring Boot FHIR-lite API with 25 passing tests.

This directory is the **Claude Code project root**: start `claude` from here so `CLAUDE.md`, `.claude/` and `.mcp.json` load.

## What is here

| Path | What it is |
|---|---|
| `CLAUDE.md`, `.claude/rules/`, `context/` | project memory, path-scoped Java rules, the context pack (architecture, standards, security, domain, PHI) |
| `.claude/agents/` | seven subagents: `architect`, `developer`, `reviewer`, `tester`, `security`, `sre`, `orchestrator` |
| `agents/<name>/CONTRACT.md` | the Agent Contract each subagent satisfies; `agents/tool-guard.mjs` enforces write and Bash scope |
| `.claude/skills/` | 14 skills: reviews (`architecture-review`, `code-review`, `test-strategy`, `security-review`, `performance-review`, `production-rca`), tools (`explain-endpoint`, `run-tests`, `ticket-intake`), workflow entry points (`feature`, `bug-fix`, `incident`, `requirements`, `implementation-plan`) |
| `skills/` | each skill as an engineering asset: README, CHANGELOG, golden test cases |
| `workflows/` | feature-delivery, bug-fix and incident-response specs, the handoff format, a committed example run |
| `.claude/settings.json`, `.claude/hooks/` | permission `allow` / `ask` / `deny` rules and the hooks (secrets, outbound MCP, injection, handoff check) |
| `.mcp.json`, `mcp/` | GitHub, Atlassian and a local read-only, PHI-safe FHIR MCP server |
| `evaluations/` | golden tasks, the eval harness (offline replay and live), rubrics, reports |
| `docs/` | ADRs, governance, MCP guide, tutorials, the capstone (`docs/capstone/`) |
| `company-ai/` | the skill library packaged as a Claude Code plugin |
| `scripts/` | deterministic automation, governance validators, `capstone/verify-system.mjs` |
| `sample-app/` | the FHIR-lite Patient/Observation API the agents work on; known defects in `sample-app/docs/KNOWN_DEFECTS.md` |

The full component map (every folder, its purpose, the module that built it, and whether its format is a verified Claude Code format or a course convention) is in [docs/capstone/README.md](docs/capstone/README.md).

## Quickstart

Requirements: Node 22, Java 21, Maven 3.9, and an authenticated Claude Code CLI (`claude --version`) for the agent runs.

```bash
cd AI-SDLC

# 1. Is the system wired? (no API key needed)
node scripts/capstone/verify-system.mjs

# 2. Does the service build and pass its tests?
cd sample-app && mvn -q -B test && cd ..

# 3. Run a workflow with human gates (interactive)
claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default
#    then type one of:
#    /feature PAT-142 Paginate Patient search with _count and _offset
#    /bug-fix BUG-57 Family search ignores trailing spaces
#    /incident INC-311 p95 latency on GET /fhir/Observation/$lastn above 2s since 14:05 UTC
```

You approve every developer launch (the `Agent(developer)` ask rule), decide on findings when the orchestrator stops with `needs-human`, execute every production mitigation yourself, and open and merge the PR yourself. Handoffs land in `.ai-sdlc/runs/<run-id>/` (git-ignored). Walkthroughs with every command, agent and gate: [docs/capstone/walkthrough-feature.md](docs/capstone/walkthrough-feature.md) and [docs/capstone/walkthrough-incident.md](docs/capstone/walkthrough-incident.md).

## Module map

| Module | Level | Builds |
|---|---|---|
| `00-example` | 1 | `CLAUDE.md`, `.claude/rules/`, `context/` |
| `01-foundations` | 1 | `agents/CONTRACT_TEMPLATE.md`, `docs/foundations/` |
| `02-first-agent-skill-tools` | 2 | `evaluations/agent-versions/reviewer-v1.md`, `explain-endpoint`, `run-tests`, `docs/tutorials/level-2/` |
| `03-skills-architecture-code-test` | 3 | `architecture-review`, `code-review`, `test-strategy` and their `skills/` assets |
| `04-skills-security-performance-rca` | 3 | `security-review`, `performance-review`, `production-rca` and their `skills/` assets |
| `05-agent-roster` | 3 | the six specialist agents, their contracts, `agents/tool-guard.mjs`, `agents/check-agents.mjs` |
| `06-mcp-and-tooling-architecture` | 4 | `.mcp.json`, `mcp/`, `ticket-intake`, `scripts/automation/`, `docs/mcp/` |
| `07-agent-composition` | 5 | `workflows/composition/` (execution modes, depth limits) |
| `08-workflow-orchestration` | 6 | `orchestrator`, `feature` / `bug-fix` / `incident` skills, `workflows/`, `check-handoff.mjs` |
| `09-agent-evaluation` | 7 | `evaluations/` |
| `10-governance` | 8 | `.claude/settings.json` extensions, governance hooks, `docs/governance/`, `company-ai/`, `scripts/governance/` |
| `11-capstone` | 9 | this README, `docs/capstone/`, `scripts/capstone/` |

## Tests, evals and verification

```bash
cd AI-SDLC

# Whole-system wiring check (PASS/WARN/FAIL/SKIP table; exit 0 = WIRED)
node scripts/capstone/verify-system.mjs
node scripts/capstone/verify-system.mjs --with-tests --with-maven   # plus every *.test.mjs and mvn

# Java service
cd sample-app && mvn -q -B test && cd ..

# Node tests (zero dependencies), for example:
node .claude/hooks/check-handoff.test.mjs
node agents/check-agents.test.mjs
node scripts/capstone/verify-system.test.mjs
node --test evaluations/harness/test/harness.test.mjs

# Evals: offline replay needs no API key; live runs call claude -p and cost money
node evaluations/harness/run-evals.mjs --mode replay
node evaluations/harness/run-evals.mjs --mode replay --compare v1 v2 --judge
node evaluations/harness/run-evals.mjs --mode live --suite reviewer --case REV-05 --dry-run

# Validate handoffs of a run
node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/<run-id>
```

The recordings under `evaluations/recordings/` are synthetic (marked `"_synthetic": true`); replace them with live runs before you use a comparison to make a decision.

## Rules that apply to every change here

- No PHI or secrets anywhere: code, logs, prompts, fixtures, eval data, commit messages, MCP calls. Synthetic data only (`MRN-000123`).
- Agents never push, merge or deploy; a human does, after review.
- The planted `TEACHING-DEFECT(perf-n+1)` and the discovered defects in `sample-app/docs/KNOWN_DEFECTS.md` stay unfixed in `sample-app/`; exercises depend on them.
- Changes to `.claude/**`, `.mcp.json`, `CLAUDE.md`, `skills/**` and `company-ai/**` need an AI-governance approval on the PR (`docs/governance/approval-gates.md`).

To run this system on your own stack and domain, follow [docs/capstone/personalize-checklist.md](docs/capstone/personalize-checklist.md).
