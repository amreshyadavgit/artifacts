# Evaluations

Golden tasks, a zero-dependency harness, judge rubrics and reports for the `architect` and `reviewer`
agents. Module `09-agent-evaluation` of the course explains the method; this file is the operating manual.

```text
evaluations/
├── suites.json                      # suite -> dataset, agent versions, rubric, gates
├── datasets/
│   ├── architecture-golden.json     # 20 architect golden tasks against sample-app
│   ├── reviewer-golden.json         # 8 reviewer golden tasks (one diff each)
│   ├── reviewer-diffs/REV-0N.patch  # defects introduced for the eval only; sample-app is unchanged
│   └── fixtures/ARCH-17-ticket.md   # synthetic ticket carrying a prompt injection
├── agent-versions/                  # frozen prompt snapshots (v1); v2 is the live .claude/agents/<name>.md
├── rubrics/                         # LLM-as-judge rubrics + judge-output.schema.json (--json-schema)
├── recordings/<agent>-<version>/    # replay inputs: <case>.json and <case>.judge.json
├── harness/run-evals.mjs            # CLI (live, replay, compare)
├── harness/scoring.mjs              # pure scoring functions
├── harness/test/harness.test.mjs    # node:test suite
└── reports/                         # generated: replay-v1, replay-v2, v1-vs-v2 (.md and .json)
```

## Run it

From `AI-SDLC/`:

```bash
node evaluations/harness/run-evals.mjs --mode replay                          # v2, all suites, exit 0 when gates pass
node evaluations/harness/run-evals.mjs --mode replay --version v1             # the old prompts fail the gates (exit 1)
node evaluations/harness/run-evals.mjs --mode replay --compare v1 v2 --judge  # writes reports/v1-vs-v2.{md,json}
node --test evaluations/harness/test/harness.test.mjs                         # harness unit + smoke tests
```

Live runs need an authenticated `claude` CLI and cost money (about $6 for the architecture suite at the
recorded v2 rates):

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
- The agent's own `permissionMode` is replaced by `plan`: evals are read-only.
- Nested frontmatter (`hooks`, inline `mcpServers`) is not converted by the zero-dependency parser and is
  reported as a note. Hook behaviour is tested by the hook tests, not by these evals.
- `--max-turns` and `--max-budget-usd` are circuit breakers set above the budget; the budget itself is a
  scored assertion, so an overrun shows up as a failed case instead of a truncated one.
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
| must-not-mention | `forbiddenClaims` + `globalForbiddenClaims`, sentence-level, negated sentences skipped |
| severity expectations | severity of the table row that matches the finding; `maxSeverity` |
| permissions | `permission_denials` must be empty |
| budget | `num_turns`, `total_cost_usd` |

Suite metrics: pass rate, recall, precision (table rows that match an expected finding), hallucination
rate (cases with a forbidden claim), severity mismatches, tool-call violations, format failures, cost,
turns, p50/p95 latency (`duration_ms`), and with `--judge` the judge's mean scores and its agreement
with the scripted verdict. Gates per suite live in `suites.json`.

## Rules for the dataset

- Synthetic data only. No real MRNs, names or dates of birth in any case, fixture or recording.
- Every `contextFiles` path must exist; every `mustNotExist` path must not (`harness.test.mjs` checks both).
- Every diff must apply with `git apply --check` from `AI-SDLC/`.
- A case changes only with a `datasetVersion` bump and a note in the pull request, because it changes
  every historical comparison.

## About the recordings

Everything under `recordings/` is **synthetic**: hand-authored files in the shape of
`claude -p --output-format json`, each marked `"_synthetic": true`. They let the harness, the tests
and the reports run with no API key. They are not measurements of any model. Replace them with real
runs (`--mode live --record <agent>-<version>-live`) before you use a comparison to make a decision.
