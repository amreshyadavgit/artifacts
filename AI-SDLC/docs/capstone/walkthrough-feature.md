# Walkthrough: one feature through the whole system

Feature: **PAT-142, `_count` / `_offset` paging on `GET /fhir/Patient`**. Today `PatientController.search` returns every match in one `Bundle` and `context/architecture/overview.md` lists "No pagination yet on searches (risk: unbounded results)". The committed run for this feature is `workflows/examples/feature-patient-pagination/` (module 08); this page does not repeat its handoffs, it shows which component of the system acts at each moment and which gate fires.

## 0. Before the run: is the system wired?

```bash
cd AI-SDLC
git status --short                                   # must be empty: /feature refuses a dirty tree
node scripts/capstone/verify-system.mjs              # expect "-> WIRED" (exit 0)
node evaluations/harness/run-evals.mjs --mode replay # architect and reviewer suites: "gates PASS"
```

The eval replay matters here because two of the agents this run uses, `architect` (step 02) and `reviewer` (step 08), are the agents module 09 evaluates. If someone changed `.claude/agents/reviewer.md` since the last green replay, you would be running an unevaluated reviewer on a PHI-bearing endpoint.

## 1. Start the orchestrator

```bash
claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default
```

| What happens | Component | Verified behaviour or course pattern |
|---|---|---|
| The orchestrator file body replaces the default system prompt; CLAUDE.md still loads | `.claude/agents/orchestrator.md` | verified (FACTS section 1: `claude --agent`) |
| `Agent(architect, developer, reviewer, tester, security, sre)` is enforced as the only spawnable types | orchestrator `tools` | verified: the parenthesised list applies to a main-thread agent |
| `ask: ["Agent(developer)"]` is merged into the project permissions | `workflows/gates.settings.json` via `--settings` | verified (`--settings`, array keys merge) |
| `default` mode, so `ask` rules prompt | `--permission-mode default` (also `defaultMode` in `.claude/settings.json`) | verified; do not run gated workflows in `acceptEdits`, `auto`, `dontAsk` or `bypassPermissions` |

## 2. Type the entry point

```text
/feature PAT-142 Paginate Patient search with _count (default 20, max 100) and _offset
```

The `feature` skill (`disable-model-invocation: true`, so only you can start it) injects today's date and `git status --short`, registers the `SubagentStop` handoff hook for the session, and points the orchestrator at `workflows/feature-delivery.md`.

## 3. Step by step

| # | Who runs | What you see | Gate | Handoff file |
|---|---|---|---|---|
| 01 | orchestrator, `requirements` skill | user story, AC-1..AC-6, non-functional (PHI: counts only in audit) | none | `01-requirements.md` |
| 02 | `architect` (opus, preloads `architecture-review`, writes only ADR/run folder) | options A/B/C, ARC-1..ARC-3, ADR-0002 draft | `SubagentStop` hook validates the handoff (exit 2 makes the agent fix it) | `02-architect.md` |
| 03 | orchestrator, `implementation-plan` skill | plan P1..P6, "Security scope: YES (touches `api/`)", status `needs-human` | G1 is next | `03-implementation-plan.md` |
| G1 | **you** | Claude Code permission prompt for the `Agent` tool with `subagent_type: developer` | **G1**: `ask` rule. Read 01..03, then accept or reject | none |
| 04 | `developer` (sonnet, `acceptEdits`, `tool-guard.mjs` write-scope `sample-app/src/` and `.ai-sdlc/runs/`, Bash allowlist `mvn -q -B test` ...) | code + 2 tests, `Tests run: 27, Failures: 0` | `block-secrets.mjs` on every Edit/Write; tool-guard exit 2 on anything outside scope | `04-developer.md` |
| 05 + 06 | `tester` and `security` launched in the same turn | TST-1 **high** (`Bundle.total` is the page size), SEC-1 **medium** (`_offset` not capped) | runs in parallel; orchestrator waits for both | `05-tester.md` (status `blocked`), `06-security.md` |
| G2 | **you** | orchestrator stops with `needs-human` and lists TST-1 and SEC-1 | **G2** (convention: orchestrator prompt) | decision recorded in the next handoff |
| 07 | `developer` rework 1 of 2 | fixes both, `Tests run: 32, Failures: 0` | **G1 again**: every developer launch prompts | `07-developer.md` |
| 08 | `reviewer` (sonnet, `dontAsk`, Bash guard `git diff`/`git log`/`git show`/`git status`) | CR-1 low, CR-2 info, "approve with comments" (never merge approval) | G2 again only if critical/high | `08-reviewer.md` |
| 09 | orchestrator | step table, open findings, human actions; `.active` set to `none` | ends with `next: human` | `09-run-report.md` |
| G3 | **you**, outside the agents | push the branch and open the PR yourself | **G3**: `git push` is `ask`, `gh pr merge` is `deny`; branch protection and CODEOWNERS (module 10 G7) | PR approval |

## 4. After the run: evals and governance

```bash
node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-patient-pagination   # every handoff PASS
git diff --stat main...HEAD                                                            # only sample-app/ paths
node scripts/governance/check-ai-change-approval.mjs --changed changed.txt --reviews reviews.json \
  --author "$PR_AUTHOR" --head-sha "$HEAD_SHA"                                         # exit 0: no governed path changed
```

- **Governance (module 10)** applied throughout, not only at the end: the deny rules kept `.env` and `**/secrets/**` unreadable, `block-secrets.mjs` scanned every handoff write, `flag-injection.mjs` scanned every Read of ticket and repo text, and `guard-outbound.mjs` would have put an `ask` in front of any Jira or GitHub write. The PR itself changes only `sample-app/`, so the AI-config gate (G6) passes and the ordinary code-owner review (G7) applies.
- **Evaluation (module 09)** applies to changes of the system, not to each run. If the retro of this run says "the reviewer missed that `Bundle.total` was wrong; tester caught it", the fix is a new golden task in `evaluations/datasets/reviewer-golden.json` plus a reviewer prompt change, and that change must pass `node evaluations/harness/run-evals.mjs --mode replay` and a live `--compare v1 v2` before its PR (which G6 gates) can merge.
- **Cost**: in an interactive run, check `/usage` before and after. A headless run cannot pass G1 (nobody answers the prompt; with `--permission-mode dontAsk` it becomes an explicit denial), so use `claude -p` only for the read-only steps and for evals, with `--max-turns` and `--max-budget-usd`, and aggregate with `scripts/governance/cost-report.mjs`.
