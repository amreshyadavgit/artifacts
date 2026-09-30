# Architecture review checklist (Frappe edition)

Tick every item before writing the ADR file. `scripts/validate-adr.mjs` checks the items marked (auto).

## Structure (auto)
- [ ] Title line is `# ADR-NNNN: <imperative title>` and NNNN is the next free number in `docs/adr/`.
- [ ] Metadata bullets: `Status: proposed`, `Date: YYYY-MM-DD`, `Deciders:`.
- [ ] H2 sections in template order: Context, Options considered, Decision, Consequences, Verification.
- [ ] Options table has columns `Option | Pros | Cons | Risk` and at least two option rows.
- [ ] Risks table uses the canonical findings columns and severities, ids `AR-NNN`.
- [ ] Every backticked `path:line` resolves (`--repo .` for repo paths, `--bench <bench>` for `apps/frappe/...` paths).

## Requirement analysis
- [ ] Functional and non-functional requirements are separated.
- [ ] The requirement says which country deployments (sites) it applies to.
- [ ] Every acceptance criterion is testable with `FrappeTestCase`, `unittest`, or a query counter.
- [ ] Assumptions are labelled as assumptions, not facts.

## Existing architecture
- [ ] Read `context/architecture/overview.md` and cited what it says about the area ("Known constraints and decisions", country apps).
- [ ] Checked every ADR in `docs/adr/` for conflicts; a conflict is written as "supersedes ADR-XXXX" (ADR-0001: FHIR-lite over whitelisted methods).
- [ ] Traced the full path with `path:line` evidence: whitelisted method in `api/fhir.py`, mappers, controller, DocType JSON, `hooks.py`, `patches.txt`, tests.
- [ ] Found every caller of each function the decision changes (Grep), for example all uses of `parse_token` or `PATIENT_FIELDS`.
- [ ] Checked Frappe behaviour the decision depends on in the Frappe source or `build/FRAPPE_FACTS.md`, not from memory.

## Frappe options (see frappe-options.md)
- [ ] Axis 1 decided: core change, country app (Custom Field / Property Setter fixtures), integration app with `required_apps`, or a core extension point. The rejected placements say why they lose.
- [ ] Axis 2 decided: controller method versus `doc_events`; `override_doctype_class` avoided or justified.
- [ ] Axis 3 decided: synchronous versus `frappe.enqueue` with explicit `queue`, `timeout`, `job_id`, `deduplicate`, and `enqueue_after_commit` where the job reads the triggering document.
- [ ] Read paths stay permission-aware (`frappe.get_list`); any `get_all`, `qb` or raw SQL has its own permission check.
- [ ] A new `hooks.py` key is named and documented as a contract.

## Risks
- [ ] Schema and data: patch needed? (`reqd` field, rename, retype, backfill; `[pre_model_sync]` or `[post_model_sync]`). `bench run-tests` does not migrate.
- [ ] Postgres 16 and MariaDB: filters and ordering checked against D-2 and NULL ordering.
- [ ] PHI: nothing new in logs, Error Log, `frappe.throw` messages, RQ job arguments, or MCP calls.
- [ ] Secrets: credentials live in site config (set with `bench set-config`) or an API key per integration user; never in the repo; agents never read `site_config.json`.
- [ ] Rollout: install order across apps, which sites get which app, fixtures overwritten on migrate, backwards compatibility for existing clients and tests.
- [ ] Operations: queue choice, timeouts, retries (scheduler), what happens when the external system is down.

## Decision and verification
- [ ] The decision states concrete values (field names and flags, `hooks.py` keys, queue and timeout, error codes), not "reasonable defaults".
- [ ] Follow-up work has ticket ids.
- [ ] Verification lists test names (`TestClass#test_method`) that follow `testing-standards.md`.
- [ ] Status is `proposed`. Nothing claims the ADR is accepted.
