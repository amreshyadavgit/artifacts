# Model, effort and cost policy

Owner: AI governance group. Enforced by `scripts/governance/check-agent-policy.mjs` (policy file `scripts/governance/agent-policy.json`) and, for headless runs, by `--max-turns` / `--max-budget-usd` plus `scripts/governance/cost-report.mjs`.

## Principles

1. **Pay for reasoning where a miss is expensive.** A missed authorization gap on a PHI endpoint costs more than a month of model spend. A mis-sequenced handoff costs a re-run.
2. **Every roster subagent pins `model`, `effort` and `maxTurns`** (the main-thread orchestrator pins `model`; its run is bounded by `--max-turns` / `--max-budget-usd`). `model: inherit` is forbidden: the same agent must not cost 5x more because someone started the session on a bigger model.
3. **Every agent declares `tools`.** Omitting `tools` inherits every tool, including MCP write tools. That is a cost risk (more tool calls) and a security risk.
4. **Budgets are set per run, not per month.** Headless runs always pass `--max-turns` and `--max-budget-usd`. A run that stops on a limit (`subtype` `error_max_turns` or `error_max_budget_usd`) is a human decision point, not something to retry blindly.

## Per-agent model selection

| Agent | model | effort | maxTurns (ceiling) | Why this model | Why not the alternative |
|---|---|---|---|---|---|
| `architect` | `opus` | `high` | 30 | Trade-off analysis across packages (`api` / `service` / `repository`), ADR options, and risks such as unbounded searches need the strongest reasoning. Runs once per feature, so volume is low. | Sonnet produces plausible but shallower option sets; the ADR is the most reused artifact of a run. |
| `developer` | `sonnet` | `medium` | 60 | Implements an approved plan; most turns are edit, run `mvn -q -B test`, read the failure, fix. Throughput and cost per turn dominate. | Opus costs more per turn on the longest-running agent; the plan already carries the hard reasoning. Raise effort to `high` for a hard bug, not the model. |
| `reviewer` | `sonnet` | `high` | 25 | Reads one diff against `context/standards/review-standards.md`; `high` effort buys more careful evidence per finding. | Opus is allowed by policy for large or security-sensitive diffs; the golden-task scores in module 09-agent-evaluation decide whether the upgrade pays. |
| `tester` | `sonnet` | `medium` | 40 | Test design from a plan and MockMvc tests that follow existing patterns in `PatientApiTest` / `SecurityTest`. | Test writing is pattern-heavy, not reasoning-heavy. |
| `security` | `opus` | `high` | 30 | PHI exposure and authN/Z gaps (for example a new route outside `.requestMatchers("/fhir/**")` in `SecurityConfig`) are `critical` findings; false negatives are the costliest error in the system. | Sonnet is allowed for small diffs that touch no `config/`, `audit/` or `error/` code. |
| `sre` | `opus` | `high` | 30 | Production RCA (log lines, query counts, `kubectl` output, k8s manifests) has to connect symptoms to code across layers, for example tracing `$lastn` latency to the loop in `ObservationService.lastN`. It runs only in incident and performance steps, so volume is low and time-to-cause matters. | Sonnet is allowed for routine performance reviews of a single diff. |
| `orchestrator` | `sonnet` | `medium` (optional) | 100 (optional) | Sequencing, gate checks and report assembly; runs as the main thread (`claude --agent orchestrator`) for the whole workflow, so it has the most turns. Its budget is the run-level `--max-turns` / `--max-budget-usd`, so `effort` and `maxTurns` in its frontmatter are optional. | Opus here multiplies cost across the longest session for little gain; the reasoning happens in the agents it calls. |

Model resolution (Claude Code docs, model-config and sub-agents): per-invocation `model` on the Agent call, then frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces the env model on all subagents: use it in CI to run the whole roster on a cheaper model for smoke tests, never for release reviews.

The project settings `ask` rule `Agent(model:opus)` makes Claude Code prompt when the main session tries to override a subagent's model to Opus per call. Agents whose own frontmatter says `opus` are not affected by that rule; they are covered by this policy instead.

## Budget controls (real mechanisms)

| Control | Where | What happens at the limit |
|---|---|---|
| `maxTurns` | subagent frontmatter | The agent stops; its output is marked partial. The orchestrator must set the handoff `status: blocked`. |
| `--max-turns N` | `claude -p` | Run ends with `subtype: "error_max_turns"` and a non-zero exit. |
| `--max-budget-usd X` | `claude -p` | Run ends with `subtype: "error_max_budget_usd"`. Subagent spend counts toward the budget. |
| `total_cost_usd`, `num_turns`, `modelUsage` | `--output-format json` result | Saved per step; aggregated by `cost-report.mjs` against a run budget. Client-side estimate. |
| `/usage` (aliases `/cost`, `/stats`) | interactive session | Shows session usage; check it before and after a workflow run. |
| `effort` / `--effort` / `effortLevel` | agent frontmatter / CLI / settings | Lower effort = fewer thinking tokens. Tune effort before switching model. |

## Default run budgets

| Workflow | `--max-budget-usd` (whole run) | Largest single step |
|---|---|---|
| `feature` (architect, developer, tester, reviewer, security) | 10.00 | developer, 4.00 |
| `bug-fix` (developer, tester, reviewer) | 5.00 | developer, 3.00 |
| `incident` (sre, then developer if a patch is approved) | 8.00 | sre, 3.00 |
| single review (`/code-review`, `/security-review`) | 2.00 | n/a |

These are starting values for this repo size. Review them monthly against the real `total_cost_usd` history; raise a budget only with a note in this file's changelog section.

## Headless invocation template

```bash
RUN_ID=2026-09-30-feat-observation-search
mkdir -p ".ai-sdlc/runs/$RUN_ID/costs"
claude -p "Review the diff on this branch against main. Write findings to .ai-sdlc/runs/$RUN_ID/06-reviewer.md." \
  --agent reviewer --max-turns 25 --max-budget-usd 2.00 \
  --output-format json > ".ai-sdlc/runs/$RUN_ID/costs/06-reviewer.json"
node scripts/governance/cost-report.mjs ".ai-sdlc/runs/$RUN_ID/costs" --budget-usd 10
```

## Changelog

- 2026-09-30: initial policy (module 10-governance).
