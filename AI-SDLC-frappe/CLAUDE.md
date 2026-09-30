# AI-SDLC reference repository (Frappe edition)

This repository is a working AI-assisted SDLC system for a small Frappe v15 clinical app. It contains Claude Code subagents, skills, Claude Code hooks, workflows, evaluations, and the Frappe app they operate on.

## Layout
- `sample-app/spice_lite/`: the Frappe app `spice_lite` (DocTypes `SL Patient`, `SL Encounter`, `SL Observation`, `SL Country`; FHIR-lite whitelisted API in `spice_lite/api/fhir.py`). A teaching-size slice of a `spice_next_core`-style clinical core.
- The bench is NOT in this repo. Default bench: `/home/user/frappe-bench`, site `test.localhost` (PostgreSQL 16). Create one with `sample-app/scripts/setup-bench.sh`.
- `.claude/agents/`: subagents: architect, developer, reviewer, tester, security, sre, orchestrator.
- `.claude/skills/`: skills (architecture-review, code-review, test-strategy, security-review, performance-review, production-rca, and workflow entry points).
- `agents/<name>/CONTRACT.md`: the Agent Contract each subagent must satisfy. Treat it as the spec.
- `workflows/`: feature-delivery, bug-fix, incident-response.
- `context/`: architecture, standards, security, domain. Read the relevant file before acting.
- `evaluations/`: golden datasets and the eval harness.

## Context loaded at launch
- Architecture: @context/architecture/overview.md
- Domain terms and PHI classification: @context/domain/spice-lite-glossary.md
- Security and PHI policy: @context/security/phi-and-secrets-policy.md
- Standards live in `context/standards/` (frappe-coding, testing, api, review). Read the one that matches the task; do not load all of them.

## Rules
1. Never put PHI or secrets in code, logs, Error Log entries, `frappe.throw` messages, prompts, test fixtures, commit messages, or MCP calls. Use synthetic data such as `MRN-000123`.
2. Never read `site_config.json` or `common_site_config.json`: they hold database passwords and encryption keys.
3. Every change to `spice_lite` needs tests, and `bench --site test.localhost run-tests --app spice_lite` must pass before you report completion. Schema or data changes need a patch in `patches.txt`.
4. Follow `context/standards/frappe-coding-standards.md`: permission-aware reads (`frappe.get_list`, not `frappe.get_all`, in request paths), parameterised SQL only, no `allow_guest` on clinical data, no `ignore_permissions` without a written reason.
5. "Hook" is ambiguous here. Say "Frappe hook" for `hooks.py` entries and "Claude Code hook" for `.claude/settings.json` hooks.
6. Findings use the format in `context/standards/review-standards.md` (id, severity, category, location, evidence, recommendation).
7. Agent handoffs go to `.ai-sdlc/runs/<run-id>/NN-<agent>.md` with the YAML front matter defined in `workflows/README.md`.
8. Do not fix `TEACHING-DEFECT(perf-n+1)` or the open discovered defects in `sample-app/docs/KNOWN_DEFECTS.md` unless the task explicitly asks for it; exercises depend on them.
9. Never push, merge, migrate a shared site, or deploy. A human does that after review.

## Commands (run from the bench directory, as the bench user)
- Tests (integration + unit, 46): `bench --site test.localhost run-tests --app spice_lite`
- One module: `bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api`
- Unit tests, no bench needed: `cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .`
- Apply schema/patch changes to the test site: `bench --site test.localhost migrate`
- Evals (offline replay): `node evaluations/harness/run-evals.mjs --mode replay`
