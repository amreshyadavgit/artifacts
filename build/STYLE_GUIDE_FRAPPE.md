# STYLE GUIDE — Frappe edition

The Frappe edition follows `build/STYLE_GUIDE.md` (tone, depth, tagging, handoff format, roster, Mermaid rules) with the differences below. Where this file and STYLE_GUIDE.md disagree, this file wins for the Frappe edition. `build/CLAUDE_CODE_FACTS.md` is the source of truth for Claude Code formats; `build/FRAPPE_FACTS.md` is the source of truth for Frappe APIs (verified in the cloned Frappe v15 source).

## 1. Audience
- A **senior Frappe engineer** on a healthcare platform modelled on `spice_next_core`: Frappe v15, Python 3.11, PostgreSQL 16, Redis (cache, queue, socketio), bench, one deployment per country, integration apps declared with `required_apps` (for example a telephony integration), and ERPNext only as an external integration target. They know DocTypes, controllers, `hooks.py`, patches, fixtures, `bench`, whitelisted methods, and Frappe permissions. They are new to Claude Code agents.
- Example subject everywhere: the reference app `AI-SDLC-frappe/sample-app/spice_lite` (DocTypes `SL Patient`, `SL Encounter`, `SL Observation`; FHIR-lite whitelisted API in `spice_lite/api/fhir.py`).

## 2. Terminology additions (use exactly)
| Term | Meaning | Rule |
|---|---|---|
| **Claude Code hook** | A command in `.claude/settings.json` / frontmatter that runs on a Claude Code hook event | Always say "Claude Code hook" on first use in a section, never bare "hook" when Frappe hooks are also in scope |
| **Frappe hook** / **`hooks.py`** | Frappe app hook (`doc_events`, `scheduler_events`, `fixtures`, …) | Always "Frappe hook" or "`hooks.py` entry" |
| **DocType**, **controller**, **whitelisted method**, **patch**, **fixture**, **site**, **bench**, **app** | Frappe meanings (see FRAPPE_FACTS) | Capitalise DocType; "site" is one tenant; "app" is a Python package |
| **country app** | An app that customises the clinical core for one country deployment | Prefer Custom Fields / Property Setters / `doc_events` in the country app over editing `spice_lite` |

## 3. Frappe-specific rules agents and content must follow
- Permission-aware reads: `frappe.get_list` (respects permissions) vs `frappe.get_all` (ignores them). Flag `ignore_permissions=True` and `frappe.get_all` in request paths as security findings unless justified.
- No string-formatted SQL: `frappe.db.sql` with `%(name)s` / `%s` parameters, or `frappe.qb`. Never f-strings into SQL.
- Whitelisted methods: never `allow_guest=True` for clinical data; restrict `methods=[...]` where relevant; validate inputs.
- `site_config.json` and `common_site_config.json` hold DB credentials and encryption keys: they are secrets (deny reads in `permissions.deny`).
- Queries in loops (`frappe.get_doc` / `frappe.get_all` per item) are N+1; indexes via `search_index` or patches; caching via `frappe.cache`.
- Background work goes through `frappe.enqueue` with explicit `queue`, `timeout`, and idempotency.
- Tests: Frappe integration tests (class and import path per FRAPPE_FACTS) run with `bench --site test.localhost run-tests --app spice_lite`; pure-Python mapper unit tests run with `python -m unittest discover -s spice_lite/tests/unit -t .` (no site needed).
- PHI: never in `frappe.logger`, Error Log, `frappe.throw` messages returned to clients, Version diffs sent to external tools, prompts, or eval data. Synthetic only.

## 4. Repository layout (Frappe edition)
Same shape as STYLE_GUIDE §6 but rooted at `AI-SDLC-frappe/`:
```
AI-SDLC-frappe/
├── CLAUDE.md, .mcp.json, .gitignore, README.md
├── .claude/{settings.json, agents/, skills/, hooks/, rules/}
├── agents/<agent>/CONTRACT.md, agents/CONTRACT_TEMPLATE.md
├── skills/<skill>/{README.md, CHANGELOG.md, tests/}
├── workflows/, context/{architecture,standards,security,domain}/, evaluations/, docs/, mcp/, scripts/
└── sample-app/spice_lite/        # real Frappe v15 app (source of truth); bench lives outside the repo
```
All content paths start with `AI-SDLC-frappe/`. The bench used for tests lives at `/home/user/frappe-bench` (outside the repo); learners create their own with `AI-SDLC-frappe/sample-app/scripts/setup-bench.sh`.

## 5. Parity with the Java edition
- Same 12 module ids, levels, and exercise count per module (± 1), same roster, same skills names, same handoff format, so the two editions can be compared side by side.
- Do not copy Java-edition prose. Re-derive every example, finding, and expected output from the real `spice_lite` code, Frappe behaviour, and the spice platform shape (country deployments, `required_apps` integrations, Postgres 16, redis queue workers).
- Reuse *language-agnostic* repo assets from `AI-SDLC/` by adapting them (Claude Code hook scripts in Node, the eval harness, the MCP server pattern, governance validators), but every file you ship lives under `AI-SDLC-frappe/`, is re-tested there, and has Frappe-appropriate content.
