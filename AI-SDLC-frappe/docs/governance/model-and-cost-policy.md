# Model, effort and cost policy (Frappe edition)

Owner: AI governance group. Enforced by `scripts/governance/check-agent-policy.mjs` (policy file `scripts/governance/agent-policy.json`) and, for headless runs, by `--max-turns` / `--max-budget-usd` plus `scripts/governance/cost-report.mjs`.

## Principles

1. **Pay for reasoning where a miss is expensive.** A missed `allow_guest=True` or a `frappe.get_all` in a request path on clinical data costs more than a month of model spend. A mis-sequenced handoff costs a re-run.
2. **Every roster subagent pins `model`, `effort` and `maxTurns`** (the main-thread orchestrator pins `model`; its run is bounded by `--max-turns` / `--max-budget-usd`). `model: inherit` is forbidden: the same agent must not cost five times more because someone started the session on a bigger model.
3. **Every agent declares `tools`.** Omitting `tools` inherits every tool, including MCP write tools and an unscoped `Bash` that can reach `bench`. That is a cost risk and a security risk.
4. **Budgets are set per run, not per month.** Headless runs always pass `--max-turns` and `--max-budget-usd`. A run that stops on a limit (`subtype` `error_max_turns` or `error_max_budget_usd`) is a human decision point, not something to retry blindly.
5. **Deterministic work does not go to a model.** `bench run-tests`, the patches.txt and DocType JSON lints of module 06-mcp-and-tooling-architecture, and these governance scripts cost nothing per run. Agents call them; they do not re-derive their results.

## Per-agent model selection

| Agent | model | effort | maxTurns (ceiling) | Why this model | Why not the alternative |
|---|---|---|---|---|---|
| `architect` | `opus` | `high` | 30 | Core change vs country app (Custom Fields, Property Setters, `doc_events`) vs a new integration app with `required_apps`; synchronous vs `frappe.enqueue`; patch strategy. The ADR shapes every later step and the decision is hard to undo once other sites depend on it. Runs once per feature. | Sonnet gives plausible but shallower option sets, and tends to put country logic into `spice_lite`. |
| `developer` | `sonnet` | `medium` | 60 | Implements an approved plan: DocType JSON, controller, patch, tests; most turns are edit, `bench --site test.localhost run-tests --module ...`, read the failure, fix. Throughput and cost per turn dominate. | Opus costs more per turn on the longest-running agent; the plan already carries the hard reasoning. Raise effort to `high` for a hard bug, not the model. |
| `reviewer` | `sonnet` | `high` | 25 | Reads one diff against `context/standards/review-standards.md` and the Frappe coding standards (`get_list` vs `get_all`, parameterised `frappe.db.sql`, whitelist rules, patches for schema changes). `high` effort buys more careful evidence per finding. | Opus is allowed by policy for large or permission-touching diffs; the golden-task scores of module 09-agent-evaluation decide whether the upgrade pays. |
| `tester` | `sonnet` | `medium` | 40 | `FrappeTestCase` tests with unique MRNs per class, `frappe.set_user`, `assertQueryCount`, and pure `unittest` mapper tests. Pattern-heavy, not reasoning-heavy. | Opus adds cost without better tests; the patterns live in `tests/utils.py`. |
| `security` | `opus` | `high` | 30 | Guest access, `ignore_permissions`, `permission_query_conditions` that `get_all` skips, SQL built with f-strings, PHI in Error Log or `frappe.logger(with_more_info=True)`, site_config secrets. PHI disclosed outside the service is `critical`, PHI in logs is `high`; false negatives are the costliest error in the system. | Sonnet is allowed for small diffs that touch no whitelisted method, DocType `permissions` array, `hooks.py` or `audit.py`. |
| `sre` | `opus` | `high` | 30 | RCA across gunicorn and RQ worker logs, redis queue backlog, `RQ Job` and `Error Log` excerpts, Postgres slow-query logs, and code (the N+1 in `lastn`). Runs only in incident and performance steps; time-to-cause matters. | Sonnet is allowed for routine performance reviews of a single diff. |
| `orchestrator` | `sonnet` | `medium` (optional) | 100 (optional) | Sequencing, gate checks, report assembly; runs as the main thread (`claude --agent orchestrator`) for the whole workflow, so it has the most turns. Its budget is the run-level `--max-turns` / `--max-budget-usd`. | Opus multiplies cost across the longest session for little gain; the reasoning happens in the agents it calls. |

Model resolution order (per-call `model` on the Agent call, then frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model) is covered in module 05-agent-roster. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces the env model on all subagents: use it in CI smoke runs, never for release reviews.

The project `ask` rule `Agent(model:opus)` prompts when the main session tries to upgrade a subagent to Opus **per call** (it matches the literal `model: "opus"` on the Agent tool call). Agents whose own frontmatter says `opus` are not affected by that rule; they are covered by this policy instead.

## Budget controls (real mechanisms)

| Control | Where | What happens at the limit |
|---|---|---|
| `maxTurns` | subagent frontmatter | The agent stops; its output is marked partial. The orchestrator sets the handoff `status: blocked`. |
| `--max-turns N` | `claude -p` | Run ends with `subtype: "error_max_turns"` and a non-zero exit. |
| `--max-budget-usd X` | `claude -p` | Run ends with `subtype: "error_max_budget_usd"`. Subagent spend counts toward the budget. |
| `total_cost_usd`, `num_turns`, `modelUsage` | `--output-format json` result | Saved per step; aggregated by `cost-report.mjs` against a run budget. Client-side estimate. |
| `/usage` (aliases `/cost`, `/stats`) | interactive session | Shows session usage; check it before and after a workflow run. |
| `effort` / `--effort` / `effortLevel` | agent frontmatter / CLI / settings | Lower effort = fewer thinking tokens. Tune effort before switching model. |

`--max-turns`, `--max-budget-usd` and `--json-schema` are print-mode (`-p`) flags only.

## Default run budgets

| Workflow | `--max-budget-usd` (whole run) | Largest single step |
|---|---|---|
| `feature` (architect, developer, tester, reviewer, security) | 10.00 | developer, 4.00 |
| `bug-fix` (developer, tester, reviewer) | 5.00 | developer, 3.00 |
| `incident` (sre, then developer if a patch is approved) | 8.00 | sre, 3.00 |
| single review (`/code-review`, `/security-review`) | 2.00 | n/a |

A Frappe run is dominated by the developer's test loop: every `bench run-tests --module` result is read back into context. Point the developer at one module (`--module spice_lite.tests.test_fhir_api`) while iterating and at `--app spice_lite` once at the end; that keeps both wall time and tokens down.

These are starting values for this repo size. Review them monthly against the real `total_cost_usd` history; raise a budget only with a note in this file's changelog.

## Headless invocation template

```bash
RUN_ID=2026-09-30-feat-spice-231
mkdir -p ".ai-sdlc/runs/$RUN_ID/costs"
claude -p "Review the diff on this branch against main. Write findings to .ai-sdlc/runs/$RUN_ID/06-reviewer.md." \
  --agent reviewer --max-turns 25 --max-budget-usd 2.00 \
  --output-format json > ".ai-sdlc/runs/$RUN_ID/costs/06-reviewer.json"
node scripts/governance/cost-report.mjs ".ai-sdlc/runs/$RUN_ID/costs" --budget-usd 10
```

## Changelog

- 2026-09-30: initial policy (module 10-governance).
