# AI-SDLC reference repository (Frappe edition)

A working AI-assisted software delivery system built with Claude Code, and the Frappe app it operates on. It is the reference repository of the course **AI-SDLC: Agent & Skill Engineering with Claude Code**, Frappe edition. Everything here is real and runnable: agents, skills, Claude Code hooks, workflows, a PHI-safe MCP server, an eval harness, governance checks, and `spice_lite`, a Frappe v15 clinical app on PostgreSQL 16 with 46 passing tests.

This directory is the **Claude Code project root**: start `claude` from here so `CLAUDE.md`, `.claude/` and `.mcp.json` load. The bench is **not** in this repository; the default is `/home/user/frappe-bench` with site `test.localhost`.

## What is here

| Path | What it is |
|---|---|
| `CLAUDE.md`, `.claude/rules/`, `context/` | project memory (bench path, site, commands, rules), path-scoped rules for Python and for DocType JSON / `patches.txt` / `hooks.py`, the context pack (architecture, Frappe standards, security, glossary with PHI table) |
| `.claude/agents/` | seven subagents: `architect`, `developer`, `reviewer`, `tester`, `security`, `sre`, `orchestrator` |
| `agents/<name>/CONTRACT.md` | the Agent Contract each subagent satisfies; `agents/tool-guard.mjs` enforces each agent's write scope and bench command allowlist |
| `.claude/skills/` | 14 skills: reviews (`architecture-review`, `code-review`, `test-strategy`, `security-review`, `performance-review`, `production-rca`), tools (`explain-endpoint`, `run-tests`, `ticket-intake`), workflow entry points (`feature`, `bug-fix`, `incident`, `requirements`, `implementation-plan`) |
| `skills/` | each skill as an engineering asset: README, CHANGELOG, golden test cases |
| `workflows/` | feature-delivery, bug-fix and incident-response specs, the handoff format, the gate settings, a committed feature run tested on the bench |
| `.claude/settings.json`, `.claude/hooks/` | `allow` / `ask` / `deny` rules for bench, git and MCP, and the Claude Code hooks (secrets, bench command guard, outbound MCP, injection flag, handoff check) |
| `.mcp.json`, `mcp/` | GitHub, Atlassian and a local read-only, PHI-safe `spice-site` MCP server over the site's whitelisted methods |
| `evaluations/` | golden tasks with Frappe hallucination traps, the eval harness (offline replay and live), rubrics, reports |
| `docs/` | ADRs, foundations, tutorials, MCP guide, governance, the capstone (`docs/capstone/`) |
| `company-ai/` | the skill library packaged as a Claude Code plugin |
| `scripts/` | deterministic Frappe checks (`automation/`), governance validators (`governance/`), `capstone/verify-system.mjs` |
| `sample-app/` | the `spice_lite` app, `scripts/setup-bench.sh`, a Docker stack, and `docs/KNOWN_DEFECTS.md` (one planted teaching defect T-1 and discovered defects D-1 to D-12) |

The full component map (every folder, its purpose, the module that built it, and whether its format is a verified Claude Code format or a course convention) is in [docs/capstone/README.md](docs/capstone/README.md).

## Quickstart

Requirements: Node 22 and Python 3.11; for the bench also `redis-server` and PostgreSQL 16 (the setup script installs PostgreSQL if it is missing, starts Redis on bench's default ports, and was tested as root on Ubuntu 24.04). An authenticated Claude Code CLI (`claude --version`) is needed only for the agent runs.

```bash
cd AI-SDLC-frappe

# 1. Is the system wired? (no bench, no API key needed)
node scripts/capstone/verify-system.mjs

# 2. Pure-Python unit tests of the app (no bench needed)
cd sample-app/spice_lite && python3 -m unittest discover -s spice_lite/tests/unit -t . && cd ../..

# 3. Build a bench with the app on a Postgres 16 site (idempotent; creates the bench user "frappe")
sudo ./sample-app/scripts/setup-bench.sh
node scripts/capstone/verify-system.mjs --bench /home/user/frappe-bench    # adds the bench rows

# 4. Run the Frappe tests, as the bench user, from the bench directory
su - frappe -c "source ~/.spice-lite-bench-env && cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite"

# 5. Run a workflow with human gates (interactive)
claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default
#    then type one of:
#    /feature OBS-51 Controlled vocabulary for Observation codes
#    /bug-fix BUG-63 effectiveDateTime has no UTC offset
#    /incident INC-311 lastn p95 above 2s since 14:05 UTC on the KE site
```

You approve every developer launch (the `Agent(developer)` ask rule) and every `bench --site test.localhost migrate`, decide on findings when the orchestrator stops with `needs-human`, execute every production mitigation yourself, and open and merge the PR yourself. Handoffs land in `.ai-sdlc/runs/<run-id>/` (git-ignored). Walkthroughs with every command, agent and gate: [docs/capstone/walkthrough-feature.md](docs/capstone/walkthrough-feature.md) and [docs/capstone/walkthrough-incident.md](docs/capstone/walkthrough-incident.md).

`bench run-tests` exits 0 even when tests fail unless `CI` is set. Read the final `Ran N tests` and `OK` / `FAILED` lines, or use `CI=1 bench --site test.localhost run-tests --app spice_lite` in scripts. The one printed Postgres error line (`invalid input syntax for type timestamp`) comes from the test that pins defect D-2 and is expected.

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
| `07-agent-composition` | 5 | `workflows/composition/` (execution modes, depth limits, the diff-driven security scope) |
| `08-workflow-orchestration` | 6 | `orchestrator`, `feature` / `bug-fix` / `incident` skills, `workflows/`, `check-handoff.mjs` |
| `09-agent-evaluation` | 7 | `evaluations/` |
| `10-governance` | 8 | `.claude/settings.json` extensions, governance Claude Code hooks, `docs/governance/`, `company-ai/`, `scripts/governance/` |
| `11-capstone` | 9 | this README, `docs/capstone/`, `scripts/capstone/` |

## Tests, evals and verification

```bash
cd AI-SDLC-frappe

# Whole-system wiring check (PASS/WARN/FAIL/SKIP table; exit 0 = WIRED)
node scripts/capstone/verify-system.mjs
node scripts/capstone/verify-system.mjs --bench /home/user/frappe-bench              # plus apps/spice_lite, sites/apps.txt,
                                                                                     # bench --site test.localhost list-apps, eval traps
node scripts/capstone/verify-system.mjs --bench /home/user/frappe-bench --bench-user frappe   # run bench through su - frappe
node scripts/capstone/verify-system.mjs --with-tests                                 # plus every *.test.mjs and the unit tests

# Frappe app (as the bench user, from the bench directory)
bench --site test.localhost run-tests --app spice_lite                               # Ran 46 tests ... OK
bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api

# Node tests (zero dependencies), for example:
node .claude/hooks/check-handoff.test.mjs
node agents/check-agents.test.mjs
node scripts/capstone/verify-system.test.mjs
node scripts/capstone/stack-inventory.test.mjs
node --test evaluations/harness/test/harness.test.mjs

# Deterministic Frappe checks that beat an agent
node scripts/automation/check-patches.mjs
node scripts/automation/lint-doctype-json.mjs

# Evals: offline replay needs no API key; live runs call claude -p and cost money
node evaluations/harness/run-evals.mjs --mode replay
node evaluations/harness/run-evals.mjs --mode replay --compare v1 v2
node evaluations/harness/run-evals.mjs --verify-traps                                # every trap is false in the Frappe v15 source
node evaluations/harness/run-evals.mjs --mode live --suite reviewer --case REV-05 --dry-run

# Validate the handoffs of a run
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary
node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-ward-board
```

The recordings under `evaluations/recordings/` are synthetic (marked `"_synthetic": true`); replace them with live runs before you use a comparison to make a decision.

## Rules that apply to every change here

- No PHI or secrets anywhere: code, logs, Error Log, `frappe.throw` messages, prompts, fixtures, eval data, commit messages, MCP calls. Synthetic data only (`MRN-000123`). Never read `site_config.json` or `common_site_config.json`.
- Agents never push, merge, migrate a shared site or deploy; a human does, after review. `bench console` and `bench execute` are never available to an agent.
- The planted `TEACHING-DEFECT(perf-n+1)` in `lastn()` and the open defects in `sample-app/docs/KNOWN_DEFECTS.md` stay in `sample-app/`; exercises depend on them. Exercises that change the app apply a patch, test, and revert.
- Changes to `.claude/**`, `.mcp.json`, `CLAUDE.md`, `skills/**` and `company-ai/**` need an AI-governance approval on the PR; changes to `**/doctype/**`, `patches.txt`, `hooks.py` and fixtures need a schema-owner approval (`docs/governance/approval-gates.md`).

To run this system on your own `spice_next_core`-style bench, follow [docs/capstone/personalize-checklist.md](docs/capstone/personalize-checklist.md).
