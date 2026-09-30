# Move the system to your real bench: a checklist

The system in `AI-SDLC-frappe/` is built around one reference app on one course bench: `spice_lite` in `sample-app/`, bench `/home/user/frappe-bench`, site `test.localhost`, Frappe v15 on PostgreSQL 16, and an invented Kenya deployment in the incident pack. Most of it does not depend on that: the roster, the handoff format, the orchestrator and its gates, the Claude Code hooks, `tool-guard.mjs`, the eval harness and `verify-system.mjs` carry over unchanged. What changes is what the agents know (paths, DocTypes, apps, sites) and which bench commands they may run.

Worked target below: a `spice_next_core`-style bench. Replace the example values with yours:

| Course value | Example target value (replace with yours) |
|---|---|
| app `spice_lite` in `sample-app/spice_lite/` | core app `spice_next_core` in `apps/spice_next_core/` of your repo |
| bench `/home/user/frappe-bench`, user `frappe` | bench `/opt/spice/frappe-bench`, user `frappe` |
| site `test.localhost` | a disposable dev site `dev.spice.localhost` with `allow_tests` set, on PostgreSQL 16, never a copy of a country site |
| no other apps | country apps (for example `spice_ke`) and integration apps (for example `spice_telephony` with `required_apps = ["spice_next_core"]`) |

Order matters: each step's check can only pass once the steps before it are done. Evaluation comes last, because golden tasks written before the context pack and agents are updated would measure the old system.

## Step 0: measure what still encodes the reference system

```bash
cd AI-SDLC-frappe
node scripts/capstone/stack-inventory.mjs --files > /tmp/inventory-before.md     # 242 files at the time of writing
node scripts/capstone/verify-system.mjs --bench /opt/spice/frappe-bench --site dev.spice.localhost \
  --app-dir apps/spice_next_core                                                  # expect FAIL rows: that is the to-do list
```

- [ ] Record the baseline file count in your PR description.
- [ ] Write `scripts/capstone/terms.mybench.json` with the course terms that must disappear (for example `{"course": ["\\bspice_lite\\b", "test\\.localhost", "/home/user/frappe-bench", "\\bSL (Patient|Encounter|Observation)\\b"]}`) and rerun the inventory with `--terms` after every step. You are done when only the files you chose to keep (course docs, the old example runs) still match.

## Step 1: CLAUDE.md, bench and site (module 00)

- [ ] Layout: replace `sample-app/spice_lite/` with your core app path, and list every app on the bench with one line each: core, country apps, integration apps and their `required_apps`.
- [ ] Bench line: `Default bench: /opt/spice/frappe-bench, site dev.spice.localhost (PostgreSQL 16)`. `verify-system --bench` warns when CLAUDE.md names a different bench than the one you check.
- [ ] Personal differences go to `CLAUDE.local.md` (git-ignored), not into the shared file: your own bench path, your own dev site.
- [ ] Commands: `bench --site dev.spice.localhost run-tests --app spice_next_core`, one module, `CI=1` when the exit code matters, and how to run pure-Python unit tests without a site if you have them.
- [ ] Rule 8: replace the teaching-defect rule with a pointer to your known-issues list, or delete it.
- [ ] Keep rules 1, 2, 5 and 9 as they are (PHI, `site_config.json`, "Frappe hook" vs "Claude Code hook", humans migrate and merge).

## Step 2: path-scoped rules for your DocType paths (module 00)

- [ ] `.claude/rules/doctype-json.md` `paths`: `apps/spice_next_core/spice_next_core/**/doctype/**/*.json`, `apps/*/*/patches.txt`, `apps/*/*/hooks.py`, and the country apps' `apps/spice_*/spice_*/fixtures/*.json` (Custom Field and Property Setter fixtures are schema changes too).
- [ ] `.claude/rules/spice-lite-python.md` becomes `spice-next-core-python.md` with `paths: apps/**/*.py`; keep only rules a reviewer can check against your code.
- [ ] Check the globs match real files: `ls apps/spice_next_core/spice_next_core/*/doctype/*/*.json | wc -l`.

## Step 3: context pack from your DocTypes (module 00)

- [ ] Generate the schema facts instead of typing them: `python3 .claude/skills/explain-endpoint/scripts/doctype_summary.py apps/spice_next_core/spice_next_core > /tmp/doctypes.txt` prints one line per DocType with naming, `search_index`, unique and required fields, Links and DocPerm rows. Run it for each country app too.
- [ ] Rewrite `context/domain/spice-lite-glossary.md` as your glossary from that output: your patient, encounter and observation DocTypes, their field names, and the business rules your controllers enforce.
- [ ] PHI table: classify every field of every patient-linked DocType, plus search parameters and whitelisted-method arguments that carry identifiers. Document names stay non-PHI only if your naming series are opaque; check `autoname` in the summary.
- [ ] `context/architecture/overview.md`: the app graph (core, each country app with what it customises, each integration app with its `required_apps`), the process model per country deployment (gunicorn workers, RQ queues and timeouts, scheduler), and ERPNext as an external integration if you have it.
- [ ] `context/security/phi-and-secrets-policy.md`: same structure; name your integration users and where their keys live.

## Step 4: country apps, integration apps and required_apps (modules 03, 05)

- [ ] For every integration app, `required_apps` in its `hooks.py` names the core app. `verify-system --app-dir apps/spice_telephony --bench ...` checks that the site lists every app in `required_apps`.
- [ ] Run `verify-system --app-dir` once per app you want agents to change: the `app-layout`, `hooks-py`, `modules`, `patches` and `doctypes` rows must be PASS for each.
- [ ] `architecture-review/frappe-options.md`: keep the core vs country app vs integration app decision table; replace the examples with one decision your team really made.
- [ ] Decide which apps agents may edit. Country apps are often owned by country teams: leave them out of the developer's write scope until that team has signed up.

## Step 5: PostgreSQL 16 on Frappe v15 (modules 02, 04)

- [ ] Confirm the dev site is on Postgres (a human checks, for example with the DB host's `psql --version`; agents never read `site_config.json`).
- [ ] Re-check the three v15 + Postgres defects this course found, on your bench: the `("is", "set")` Datetime filter (D-2), `search_index` indexes that are never created (D-6, the `pg_indexes` query in `.claude/skills/performance-review/checklist.md`), and `assertQueryCount` raising `TypeError` (D-10). Record the result in your known-issues list; the performance and test-strategy skills depend on it.
- [ ] Point the eval traps at your Frappe source: `FRAPPE_SRC=/opt/spice/frappe-bench/apps/frappe node evaluations/harness/run-evals.mjs --verify-traps` (also run by `verify-system --bench`).

## Step 6: agents, tool guards and settings (modules 05, 10)

- [ ] Keep the seven role names. `check-handoff.mjs`, `check-agents.mjs`, `check-roster-flat.mjs` and `verify-system.mjs` all hard-code the roster.
- [ ] Every `bash-allow` entry that names `test.localhost` names your dev site; `{bench}` follows `SPICE_BENCH_DIR`, so set that in your shell or in `CLAUDE.local.md` instructions rather than editing the guard.
- [ ] Developer write scope: your app packages (`apps/spice_next_core/spice_next_core/`), protected folders for already-applied patches; tester write scope: test files only.
- [ ] `.claude/hooks/guard-bench.mjs` reads its no-prompt test site from `SPICE_TEST_SITE` (default `test.localhost`): export it in the shell that starts `claude`, or set `"env": {"SPICE_TEST_SITE": "dev.spice.localhost"}` in `.claude/settings.json` (applies once the folder is trusted), instead of editing the hook, then `node .claude/hooks/guard-bench.test.mjs`.
- [ ] `.claude/settings.json`: `Bash(bench --site dev.spice.localhost run-tests *)` replaces the `test.localhost` allow rules; keep every `ask` and `deny` rule, including `Read(**/site_config.json)` and `Read(**/common_site_config.json)`.
- [ ] Each `agents/<name>/CONTRACT.md` lists exactly the tools its agent file lists: `node agents/check-agents.mjs`.

## Step 7: workflows, MCP and the handoff checks (modules 06, 07, 08)

- [ ] `workflows/composition/security-scope.mjs` rule 2 fires on changed `@frappe.whitelist` or `allow_guest` lines and on any file under an `api/` folder. If your whitelisted modules are files such as `clinical/api.py`, add that pattern, then `node workflows/composition/composition.test.mjs`.
- [ ] `workflows/incident-response.md` triage table: your real queues, timeouts and log locations per country deployment.
- [ ] `.mcp.json` `spice-site`: point `SPICE_SITE_URL` and `SPICE_SITE_HOST` at your dev site with a read-only API user (`mcp/spice-site-server/scripts/provision_api_user.py`), never at a country site; `node scripts/automation/check-mcp-config.mjs`.
- [ ] Keep `workflows/examples/` as a format example or replace it with one run of your own; `verify-system` validates every example folder.

## Step 8: evaluations re-seeded from your own incidents and diffs (module 09)

- [ ] Architect suite: at least 8 golden tasks from decisions your team made (a country customisation, an integration app, a scheduler job, a report), each with must-mention facts and forbidden claims.
- [ ] Reviewer suite: 8 real diffs from your history that had a defect (a `get_all` in a request path, a schema change without a patch, an f-string SQL), with synthetic data only.
- [ ] Add an `sre` suite from your own incidents: build each evidence pack like `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` (redacted exports, time zones stated in the brief), run `build-timeline.mjs` on it (exit 0 means no PHI), and write the golden RCA a human signed off.
- [ ] Delete the synthetic recordings (`"_synthetic": true`); they measure nothing in your system. Record one live run per suite and replay that in CI.

## Step 9: CODEOWNERS and the merge gate (module 10)

- [ ] Copy `docs/governance/CODEOWNERS.example` to `.github/CODEOWNERS` with your paths: `**/doctype/**`, `**/patches.txt`, `**/patches/**`, `**/hooks.py`, `**/fixtures/**`, `**/modules.txt` to your schema owners; each country app folder to its country team; `.claude/`, `CLAUDE.md`, `.mcp.json`, `agents/`, `skills/`, `workflows/`, `evaluations/` to your AI governance group.
- [ ] Enable branch protection with "Require review from Code Owners" and the required check from `docs/governance/ai-change-gate.yml.example`; set `AI_GOVERNANCE_APPROVERS` and `SCHEMA_APPROVERS`.
- [ ] Add `node scripts/capstone/verify-system.mjs` and `CI=1 bench --site dev.spice.localhost run-tests --app spice_next_core` as required checks.

## Step 10: prove it, then run it

```bash
node scripts/capstone/verify-system.mjs --app-dir apps/spice_next_core \
  --bench /opt/spice/frappe-bench --site dev.spice.localhost --with-tests          # -> WIRED, exit 0
node scripts/capstone/stack-inventory.mjs --terms scripts/capstone/terms.mybench.json --max 10
```

- [ ] One `/feature` run and one `/incident` run (on an evidence pack from a past incident) on your bench, with every handoff passing `node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/<run-id>`.
- [ ] Open the PR for the whole move: it touches `.claude/**`, `CLAUDE.md` and `skills/**`, so the AI-config category of the gate requires an AI-governance approval.
