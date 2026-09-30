# Writer briefs — Frappe edition

Repo root `/home/user/artifacts`. Frappe-edition reference repo (Claude Code project root): `/home/user/artifacts/AI-SDLC-frappe`. The Java edition (`AI-SDLC/`, `content/`) is finished and must NOT be modified.

## Read first (mandatory, in order)
1. `build/CLAUDE_CODE_FACTS.md`: only source of truth for Claude Code formats (includes the orchestrator addendum at the end).
2. `build/FRAPPE_FACTS.md`: only source of truth for Frappe APIs (verified against the Frappe v15 source cloned in `/home/user/frappe-bench/apps/frappe`; you may grep that source to verify anything else and must not invent Frappe APIs).
3. `build/STYLE_GUIDE.md`, then `build/STYLE_GUIDE_FRAPPE.md` (overrides for this edition).
4. `build/schema.json`.
5. `build/WRITER_BRIEFS.md` (Java edition): the "Key facts every writer must build on" and "Module output rules" sections apply here too, with paths changed as below.
6. The worked example `content-frappe/modules/00-example.json` and its generator `build/sources-frappe/00-example.py`.
7. The reference app: `AI-SDLC-frappe/sample-app/` (README, `spice_lite/` source, tests, `docs/KNOWN_DEFECTS.md`), plus `AI-SDLC-frappe/CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/`, `.claude/rules/`, `context/**`.
8. The Java edition's equivalent module (`content/modules/<same id>.json`) and its repo files under `AI-SDLC/`, for structure and scope parity. Adapt language-agnostic assets (Node hook scripts, harness, MCP server, validators) into `AI-SDLC-frappe/`; rewrite everything stack-specific. Never copy Java examples, findings, or outputs.

## Differences from the Java edition
- Content output: `content-frappe/modules/<id>.json`. Generators: `build/sources-frappe/<id>.py` (read implementation content from disk, like the example). Module ids and levels are identical to the Java edition.
- Every `implementation[].path` / `startingFiles[].path` starts with `AI-SDLC-frappe/`.
- Check your module: `node build/build.mjs --edition frappe 2>&1 | grep -E "<your-id>|OK"`.
- Tests: Frappe integration tests run for real: `cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite` (see `AI-SDLC-frappe/sample-app/README.md` for the exact working commands). Pure-Python unit tests: `cd AI-SDLC-frappe/sample-app/spice_lite && python -m pytest spice_lite/tests/unit`. You MUST run anything you claim runs. Do not leave the site in a modified state: if an exercise needs a patched app, apply the patch to a scratch copy of the app installed on a scratch site (e.g. `bench new-site scratch-<you>.localhost ...`), or revert with `git -C /home/user/artifacts checkout -- AI-SDLC-frappe/sample-app` / `git stash` of only your change, and drop your scratch site afterwards. Never commit.
- Claude Code permission rules for Frappe: bench commands (`Bash(bench --site test.localhost run-tests *)`), deny reads of `**/site_config.json` and `**/common_site_config.json`, `ask` for `bench --site * migrate` and `bench --site * console`, deny `bench drop-site *`, `bench --site * reinstall *`.
- Domain: spice-like clinical platform. Country deployments, integration apps with `required_apps`, ERPNext as an external integration, Postgres 16, redis queue workers (`frappe.enqueue`), scheduler events.

## Ownership (write ONLY your files)
Orchestrator-owned (read-only): `AI-SDLC-frappe/CLAUDE.md`, `.gitignore`, `context/**`, `docs/adr/0000-template.md`, `docs/adr/0001-*.md`, `.claude/rules/*.md`, `.claude/hooks/block-secrets*.mjs`, `sample-app/**` (do not modify the app; exercise changes ship as startingFiles/patches under your own folders). `.claude/settings.json` is owned by F9.

| Writer | Module id (level) | Owns (all under `AI-SDLC-frappe/`) |
|---|---|---|
| F1 | `01-foundations` (1) | `agents/CONTRACT_TEMPLATE.md`, `docs/foundations/**` |
| F2 | `02-first-agent-skill-tools` (2) | `evaluations/agent-versions/reviewer-v1.md`, `.claude/skills/explain-endpoint/**` (explains a whitelisted method end to end: route `/api/method/...` → `@frappe.whitelist` → controller/doc_events → permission check → SQL), `.claude/skills/run-tests/**` (bench run-tests + a parser for its output), `docs/tutorials/level-2/**` |
| F3 | `03-skills-architecture-code-test` (3) | `.claude/skills/{architecture-review,code-review,test-strategy}/**`, `skills/{architecture-review,code-review,test-strategy}/**` |
| F4 | `04-skills-security-performance-rca` (3) | `.claude/skills/{security-review,performance-review,production-rca}/**`, `skills/{same}/**` |
| F5 | `05-agent-roster` (3) | `.claude/agents/{architect,developer,reviewer,tester,security,sre}.md`, `agents/{same}/CONTRACT.md`, `agents/check-agents.mjs`, `agents/tool-guard.mjs` (+ tests) |
| F6 | `06-mcp-and-tooling-architecture` (4) | `.mcp.json`, `mcp/**` (e.g. a zero-dependency stdio MCP server exposing PHI-safe, read-only aggregates from a synthetic dataset shaped like the spice_lite DocTypes, or backed by the Frappe REST API of the test site with a read-only API user), `scripts/automation/**` (deterministic checks that beat AI: e.g. patches.txt ordering/existence, DocType JSON lint for `search_index`/permissions, fixtures drift), `.claude/skills/ticket-intake/**`, `docs/mcp/**` |
| F7 | `07-agent-composition` (5) and `08-workflow-orchestration` (6) | `.claude/agents/orchestrator.md`, `agents/orchestrator/CONTRACT.md`, `.claude/skills/{feature,bug-fix,incident,requirements,implementation-plan}/**`, `workflows/**` (incl. `workflows/README.md` handoff front matter), `.claude/hooks/check-handoff.mjs` (+ test) |
| F8 | `09-agent-evaluation` (7) | `evaluations/**` except `evaluations/agent-versions/reviewer-v1.md` |
| F9 | `10-governance` (8) | `.claude/settings.json` (extend; keep block-secrets hook), `.claude/hooks/**` except `block-secrets*`/`check-handoff*`, `docs/governance/**`, `company-ai/**`, `skills/README.md`, `scripts/governance/**` |
| F10 | `11-capstone` (9) | `README.md`, `docs/capstone/**`, `scripts/capstone/**` |

Canonical skills, agent→skill preloads, roster, handoff format: identical to the Java edition (see `build/WRITER_BRIEFS.md`).

## Frappe-specific content each writer must cover (in addition to the Java-edition brief for the same writer number)
- F1: map agent anatomy onto a Frappe team's reality (who reviews DocType JSON diffs, patches, fixtures). Comparison table adds "Frappe hook (hooks.py)" as a row next to "Claude Code hook" and explains the naming collision.
- F2: agent/skill/tools on a bench: tool selection for `bench`, why `bench --site * console` and `execute` are dangerous tools, context injection with `!` running `bench --site test.localhost list-apps` or reading DocType JSON.
- F3: architecture-review for Frappe decisions (core change vs country app with Custom Fields/Property Setters vs new integration app with `required_apps`; `doc_events` vs controller methods; synchronous vs `frappe.enqueue`); code-review against Frappe standards (get_all vs get_list, ignore_permissions, SQL params, whitelist rules, patches for schema/data changes, fixtures); test-strategy mapped to Frappe test classes, `bench run-tests` flags, test records, `frappe.set_user`, and pure-pytest mappers.
- F4: security-review (whitelist/allow_guest, permission_query_conditions/has_permission hooks, ignore_permissions, SQL injection via frappe.db.sql, site_config secrets, API key/secret handling, PHI in Error Log/logger/Version, file attachments `is_private`); performance-review (the real N+1 in `lastn`, `search_index`, `frappe.cache`, report queries, background jobs and queue timeouts, gunicorn workers); production-rca with a synthetic evidence pack from a Frappe deployment (gunicorn/worker logs, redis queue backlog, `RQ Job`/`Error Log` excerpts, Postgres slow query log) — no PHI.
- F5: roster agents with Frappe tool scopes (developer may run `bench --site test.localhost run-tests`, `bench --site test.localhost migrate` only via ask; no console), contracts citing Frappe standards.
- F6: MCP for GitHub, Jira, and the Frappe site (Frappe REST/whitelisted methods as the "DB" boundary, read-only API user, PHI-safe aggregates); when a `bench` command or a scheduler job beats an agent.
- F7: `/feature` chain on a Frappe change (DocType JSON + controller + patch + tests + fixtures), conditional branch "touches permissions/whitelist → security step mandatory", parallel tester+security; incident workflow for a queue backlog or slow `lastn`; example run folder for a real feature on spice_lite.
- F8: 20 architecture golden scenarios in Frappe/spice terms (country customisation, integration app, ERPNext connector, multi-country deployments, scheduler jobs, reports, permissions), hallucination traps specific to Frappe (inventing `frappe.orm`, claiming `get_all` enforces permissions, claiming Frappe uses SQLAlchemy/Django, inventing hooks keys), reviewer golden set on Python/DocType diffs; harness adapted from the Java edition, re-tested.
- F9: governance for Frappe: secrets in site_config, API keys per integration user, `bench` command gates, PR review of DocType JSON/patches/fixtures (CODEOWNERS for `**/doctype/**`, `patches.txt`, `hooks.py`), prompt injection via Jira tickets and via DocType field content returned by MCP, cost/model policy.
- F10: capstone on spice_lite: one feature and one incident end to end, component map, `verify-system.mjs` adapted (also checks the bench-facing pieces: app installs, `patches.txt` entries exist), personalization checklist for moving from `spice_lite` to their real `spice_next_core` bench.

## When done
Do NOT git commit. Report in under 250 words: files created, exercise ids, tests run and results, behaviour claims you couldn't verify, and anything you needed from another writer.
