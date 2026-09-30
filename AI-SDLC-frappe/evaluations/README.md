# Evaluations (Frappe edition)

Golden tasks, a zero-dependency harness, judge rubrics and reports for the `architect` and `reviewer`
agents working on `spice_lite`. Module `09-agent-evaluation` of the course explains the method; this
file is the operating manual.

```text
evaluations/
├── suites.json                      # suite -> dataset, agent versions, rubric, gates, checkLocations
├── datasets/
│   ├── architecture-golden.json     # 20 architect golden tasks in Frappe / spice terms
│   ├── reviewer-golden.json         # 8 reviewer golden tasks (one diff each)
│   ├── reviewer-diffs/REV-0N.patch  # defects introduced for the eval only; spice_lite is unchanged
│   └── fixtures/ARCH-17-ticket.md   # synthetic Jira ticket carrying a prompt injection
├── agent-versions/                  # frozen prompt snapshots (v1); v2 is the live .claude/agents/<name>.md
├── rubrics/                         # LLM-as-judge rubrics + judge-output.schema.json (--json-schema)
├── recordings/<agent>-<version>/    # replay inputs: <case>.json and <case>.judge.json (synthetic)
├── harness/run-evals.mjs            # CLI (live, replay, compare, verify-traps)
├── harness/scoring.mjs              # pure scoring functions
├── harness/test/harness.test.mjs    # node:test suite
└── reports/                         # generated: replay-v1, replay-v2, v1-vs-v2 (.md and .json)
```

Eval handoffs use the front matter from `workflows/README.md` with two deliberate differences, because
an eval case has no run folder: `run_id` is `eval-<case id>` and `inputs` lists the repository files
the agent read.

## Run it

From `AI-SDLC-frappe/`. Nothing here needs a bench, a site or an API key except `--mode live`.

```bash
node --test evaluations/harness/test/harness.test.mjs                         # harness unit + smoke tests
node evaluations/harness/run-evals.mjs --verify-traps                         # every trap is false in the Frappe source
node evaluations/harness/run-evals.mjs --mode replay --judge                  # v2, all suites, exit 0 when gates pass
node evaluations/harness/run-evals.mjs --mode replay --version v1 --judge     # the old prompts fail the gates (exit 1)
node evaluations/harness/run-evals.mjs --mode replay --compare v1 v2 --judge  # writes reports/v1-vs-v2.{md,json}
```

The committed reports are produced by the last three commands (all with `--judge`). A plain
`--mode replay` rewrites `reports/replay-v2.*` without the judge rows; rerun with `--judge` before
committing. `harness.test.mjs` fails when `reports/v1-vs-v2.json` is stale.

Live runs need an authenticated `claude` CLI and cost money (about $5 for the architecture suite at
the recorded v2 rates):

```bash
node evaluations/harness/run-evals.mjs --mode live --suite architecture --case ARCH-17 --dry-run   # print argv only
node evaluations/harness/run-evals.mjs --mode live --suite architecture --version v2 --judge --record architect-v2-live
node evaluations/harness/run-evals.mjs --mode replay --suite architecture --version v2-live       # rescore that run offline
```

For every case the harness runs one headless session:

```text
claude -p "<case prompt>" --output-format json \
  --agents '{"architect": {<frontmatter fields>, "prompt": "<file body>"}}' --agent architect \
  --permission-mode plan --max-turns <1.5 x budget> --max-budget-usd <2 x budget>
```

- `--agents` outranks `.claude/agents/`, so a snapshot named `architect` replaces the live file for
  that session only. That is how two versions with the same name are compared.
- The agent's own `permissionMode` (`acceptEdits` for the architect, `dontAsk` for the reviewer) is
  replaced by `plan`: evals are read-only, and every attempted `Write`, `Edit` or `bench` call shows up
  in `permission_denials`.
- Nested frontmatter (`hooks`, inline `mcpServers`) is not converted by the zero-dependency parser and
  is reported as a note. The `tool-guard.mjs` Claude Code hooks of the v2 agents therefore do not run
  in evals; plan mode is the control, and the hooks have their own tests (`agents/tool-guard.test.mjs`).
- `--max-turns` and `--max-budget-usd` are circuit breakers set above the budget; the budget itself is
  a scored assertion, so an overrun shows up as a failed case instead of a truncated one.
- The judge is a second call: `claude -p "<rubric + case + output>" --output-format json --json-schema
  "$(cat rubrics/judge-output.schema.json)" --tools Read,Grep,Glob --permission-mode plan`, reading
  `structured_output`.

## What is scored

| Assertion | Source field or check |
|---|---|
| run succeeded | `is_error`, `subtype` |
| format: front matter, sections, findings table, severity scale, reviewer verdict | parsed `result` |
| status matches expectation | front matter `status` vs `expectedStatus` |
| must-mention (recall >= `minRecall`) | `expectedFindings[].match` (AND of OR-groups, case-insensitive regex, front matter excluded) |
| must-not-mention | `forbiddenClaims` + `globalForbiddenClaims`, clause-level, negated clauses skipped |
| severity expectations | severity of the table row that matches the finding; `maxSeverity` |
| grounding (architecture suite) | every `path:line` in a Findings `location` exists in the repo and is within the file |
| permissions | `permission_denials` must be empty |
| budget | `num_turns`, `total_cost_usd` |

Suite metrics: pass rate, recall, precision (table rows that match an expected finding), hallucination
rate (cases with a forbidden claim), severity mismatches, grounding errors, tool-call violations,
format failures, cost, turns, p50/p95 latency (`duration_ms`), and with `--judge` the judge's mean
scores and its agreement with the scripted verdict. Gates per suite live in `suites.json`.

## Hallucination traps and their evidence

A forbidden claim is only a fair trap if the claim is really false. Every factual trap carries a
`verify` list: a regex that must be **present** in a named file (the fact that refutes the claim) or
**absent** from a file or a directory (the invented thing). `root: "frappe"` is the Frappe v15 checkout
(`FRAPPE_SRC`, default `/home/user/frappe-bench/apps/frappe`); `root: "repo"` is this repository.

```bash
node evaluations/harness/run-evals.mjs --verify-traps
# ok  architecture  global/G-GETALL  frappe:frappe/__init__.py contains /def get_all(...)...kwargs["ignore_permissions"] = True/
# ok  architecture  global/G-DRYRUN  frappe:frappe/commands/site.py contains /@click.command("migrate")...--skip-search-index.../
# traps: 51 checks verified, 0 failed, 0 skipped (source not found), 0 without evidence, 9 behavioural
```

Behavioural traps (`"kind": "behaviour"`: recommending `allow_guest=True`, describing an ADR that does
not exist, inventing latency figures) are about what the agent recommends, so there is nothing to
verify in the source. When you add a factual trap, add its evidence; the test suite fails on a trap
without one.

## Rules for the dataset

- Synthetic data only. No real MRNs, names, phone numbers or national IDs in any case, fixture,
  patch or recording.
- Every `contextFiles` path must exist; every `mustNotExist` path must not (`harness.test.mjs` checks
  both).
- Every diff must apply with `git apply --check --directory=$(git rev-parse --show-prefix)` from `AI-SDLC-frappe/` to the committed app (the harness test adds `--directory` and fails on "Skipped patch"). If a
  test fails here while you have your own change applied to `sample-app/`, that is why.
- A case changes only with a `datasetVersion` bump and a note in the pull request, because it changes
  every historical comparison.

## About the recordings

Everything under `recordings/` is **synthetic**: hand-authored files in the shape of
`claude -p --output-format json`, each marked `"_synthetic": true`. They let the harness, the tests
and the reports run with no API key. They are not measurements of any model. Replace them with real
runs (`--mode live --record <agent>-<version>-live`) before you use a comparison to make a decision.
