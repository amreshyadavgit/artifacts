# Walkthrough: one feature through the whole system

Feature: **OBS-51, a controlled vocabulary for Observation codes**. Today `SL Observation.code` is free `Data`, so `8867-4`, `8867 4` and `heart rate` are all accepted. The change touches every Frappe surface at once: a new DocType `SL Observation Code` (JSON, controller, test), `SL Observation.code` from `Data` to `Link` with `code_display` fetched, a controller rule, a shipped fixture plus a `fixtures` key in `hooks.py`, and a `[post_model_sync]` patch. The committed run is `workflows/examples/feature-observation-code-vocabulary/` (module 08). This page does not repeat its handoffs; it shows which component of the system acts at each moment, which gate fires, and where evaluation and governance apply.

## 0. Before the run: is the system wired?

```bash
cd AI-SDLC-frappe
git switch -c feat/obs-51-code-vocabulary
git status --short -- sample-app                         # must be empty: /feature refuses a dirty app tree
node scripts/capstone/verify-system.mjs --bench /home/user/frappe-bench   # expect "-> WIRED" (exit 0)
node evaluations/harness/run-evals.mjs --mode replay     # architecture and reviewer suites: "gates PASS"
```

Why each one matters for this run:

- `verify-system` confirms the pieces this run depends on: `Agent(developer)` is asked (G1), the developer's guard allows `bench --site test.localhost run-tests` and asks for `migrate` (G1b), the `run-tests` parser is reachable under the developer's and tester's guards, `check-handoff.mjs` passes the committed runs, and the bench really has `spice_lite` installed on `test.localhost`.
- The eval replay matters because two agents this run uses, `architect` (step 02) and `reviewer` (step 08), are the agents module 09 evaluates. If `.claude/agents/reviewer.md` changed since the last green replay, you would be running an unevaluated reviewer on a schema change.

## 1. Start the orchestrator

```bash
claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default
```

| What happens | Component | Verified behaviour or course pattern |
|---|---|---|
| The orchestrator file body replaces the default system prompt; CLAUDE.md (bench path, rules) still loads | `.claude/agents/orchestrator.md` | verified (FACTS section 1: `claude --agent`) |
| `Agent(architect, developer, reviewer, tester, security, sre)` is enforced as the only spawnable types | orchestrator `tools` | verified: the parenthesised list applies to a main-thread agent |
| `ask: ["Agent(developer)"]` is merged into the project permissions | `workflows/gates.settings.json` via `--settings` | verified (`--settings`; array keys merge) |
| `default` mode, so `ask` rules prompt | `--permission-mode default` (also `defaultMode` in `.claude/settings.json`) | verified; do not run gated workflows in `acceptEdits`, `auto`, `dontAsk` or `bypassPermissions` |
| The orchestrator has no Bash and no Edit | orchestrator `tools` | verified; it cannot run `bench`, `git` or tests, so a deterministic diff check reaches it only through `security-scope.txt` |

## 2. Type the entry point

```text
/feature OBS-51 Controlled vocabulary for Observation codes
```

The `feature` skill (`disable-model-invocation: true`, so only you can start it) injects today's date and `git status --short -- sample-app`, registers the `SubagentStop` handoff Claude Code hook for the session, and points the orchestrator at `workflows/feature-delivery.md`.

## 3. Step by step

| # | Who runs | What you see | Gate or control that fires | Handoff file |
|---|---|---|---|---|
| 01 | orchestrator, `requirements` skill | ACs as exact whitelisted-method calls and permission checks; migration as a non-functional requirement | `block-secrets.mjs` on the Write | `01-requirements.md` |
| 02 | `architect` (opus, preloads `architecture-review`, writes only `docs/adr/` and the run folder) | core vs country app: vocabulary lives in `spice_lite`, countries add codes by fixture in their country app; ARC-1 fixtures are force-imported on every migrate; ARC-2 `Data` to `Link` needs no DDL but needs a backfill patch | `SubagentStop` hook validates the handoff (exit 2 makes the agent fix it) | `02-architect.md` |
| 03 | orchestrator, `implementation-plan` skill | P1..P8, one row per Frappe surface (DocType JSON, controller, fixture and `hooks.py`, patch and `patches.txt`, tests, migrate), "Security scope: YES", status `needs-human` | G1 is next | `03-implementation-plan.md` |
| G1 | **you** | permission prompt for the `Agent` tool with `subagent_type: developer` | **G1**: `ask` rule. Read 01 to 03, then accept or reject | none |
| 04 | `developer` (sonnet, `acceptEdits`, `tool-guard.mjs` write scope `sample-app/spice_lite/spice_lite/` minus `patches/v0_1/`, Bash allowlist `bench --site test.localhost run-tests`, `?bench --site test.localhost migrate`, unit tests, the `run-tests` parser) | the diff in `patches/04-developer.patch`; `Ran 53 tests ... OK` | **G1b**: the migrate prompt (the developer's guard returns `permissionDecision: "ask"`); `block-secrets.mjs` on every Edit/Write; `guard-bench.mjs` on every Bash; the hook requires the quoted `Ran N tests` / `OK` because `bench run-tests` exits 0 on failures | `04-developer.md` |
| scope | `SubagentStop` Claude Code hook | `SECURITY STEP: MANDATORY (rules 1, 3, 4, 5)`: a new `permissions` array, `hooks.py`, `ignore_permissions` and `frappe.get_all` in the patch | deterministic: `workflows/composition/security-scope.mjs` on the real diff | `security-scope.txt` |
| 05 + 06 | `tester` and `security` launched in the same turn | TST-1 high (the patch is not idempotent), TST-2 high and SEC-1 high (the Clinician DocPerm row on `SL Observation Code` has `create` and `write`: one root cause seen from two sides) | parallel; orchestrator waits for both | `05-tester.md` (status `blocked`), `06-security.md` |
| G2 | **you** | orchestrator stops with `needs-human`, lists TST-1, TST-2, SEC-1 and says TST-2 and SEC-1 share one root cause | **G2** (convention: an orchestrator prompt instruction) | decision recorded in the next handoff |
| 07 | `developer`, rework 1 of 2 | both fixes; `Ran 56 tests ... OK`; migrate prompt again | **G1 again** (every developer launch prompts) and **G1b again** | `07-developer.md` |
| 08 | `reviewer` (sonnet, `dontAsk`, Bash guard `git diff`/`git log`/`git show`/`git status`) | Python, DocType JSON, `patches.txt`, `hooks.py` and the fixture reviewed together; CR-1 low, CR-2 low, CR-3 info; verdict APPROVE (no blocking findings; not a merge approval) | G2 again only on critical or high | `08-reviewer.md` |
| 09 | orchestrator | step table, open findings, human actions (PR, `bench migrate` per country site after merge); `.active` set to `none` | ends with `next: human` | `09-run-report.md` |
| G3 | **you**, outside the agents | push the branch and open the PR yourself | **G3**: `git push` is `ask`, `gh pr merge` is `deny`; CODEOWNERS on `**/doctype/**`, `patches.txt`, `hooks.py`, `fixtures/**` | PR approval |

Validate the committed run exactly as the hook would:

```bash
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary   # 9 x PASS, exit 0
node workflows/composition/security-scope.mjs workflows/examples/feature-observation-code-vocabulary/patches/04-developer.patch
```

## 4. What verify-system says about the changed app

The Frappe rows of `verify-system.mjs` check what a schema reviewer checks first. On a scratch copy of the repository with `04-developer.patch` applied (`patch -p1 < workflows/examples/feature-observation-code-vocabulary/patches/04-developer.patch`, from the copy's `AI-SDLC-frappe/`):

```text
PASS    patches        2 patches.txt entries, each resolving to a module with def execute(): spice_lite.patches.v0_1.backfill_patient_country, spice_lite.patches.v0_2.backfill_observation_codes
PASS    doctypes       5 DocType folder(s), each with __init__.py, json, controller class and test: sl_country, sl_encounter, sl_observation, sl_observation_code, sl_patient
```

Delete `test_sl_observation_code.py` in that copy, or add a `patches.txt` line whose module does not exist, and the row turns FAIL with the file and the reason. Those are the two mistakes a generic agent makes most often on a Frappe schema change.

## 5. After the run: governance and evaluation

```bash
git diff --name-only main...HEAD > /tmp/changed.txt
node scripts/governance/check-ai-change-approval.mjs --changed /tmp/changed.txt --reviews reviews.json \
  --author "$PR_AUTHOR" --head-sha "$HEAD_SHA" --schema-approvers "$SCHEMA_APPROVERS"
```

With no approving review the gate prints `FAIL  ai-change-gate` and lists nine governed paths under "Frappe schema / hooks.py / patches / fixtures" (the DocType JSON and controllers, the fixture, `hooks.py`, `patches.txt`, the patch module), exit 1. With an approval on the head commit from a schema owner who is not the author it prints `PASS  ai-change-gate`, exit 0. No `.claude/**`, `CLAUDE.md` or `skills/**` path changed, so the AI-config category (governance G7) is not involved; the schema category (G8) is.

- **Governance (module 10)** acted throughout, not only at the end: the deny rules kept `site_config.json` and `common_site_config.json` unreadable, `guard-bench.mjs` caught every bench spelling, the migrate prompts (G1b) showed exactly which site was migrated, `block-secrets.mjs` scanned every write, and `flag-injection.mjs` scanned every Read of ticket and repo text. After the merge, each country site runs `bench --site <site> migrate` in its release window: that is governance G9, never an agent.
- **Evaluation (module 09)** applies to changes of the system, not to each run. If the retro says "the reviewer would not have noticed the non-idempotent patch; the tester did", the fix is a new golden task in `evaluations/datasets/reviewer-golden.json` with the patch as its diff, plus a reviewer prompt change; that change must pass `node evaluations/harness/run-evals.mjs --mode replay` and a live `--compare v1 v2` before its PR, which touches `.claude/agents/` and therefore needs the AI-config approval (G7).
- **Cost**: in an interactive run, check `/usage` before and after. A headless run cannot pass G1 (nobody answers the prompt; with `--permission-mode dontAsk` it becomes a denial), so use `claude -p` only for read-only steps and for evals, with `--max-turns` and `--max-budget-usd`, and aggregate with `node scripts/governance/cost-report.mjs <run-dir>/costs --budget-usd 10`.
