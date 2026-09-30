# Personalize the system: swap stack and domain

The system in `AI-SDLC/` is built for one service: Java 21 / Spring Boot / Maven / PostgreSQL / Kubernetes, FHIR-lite Patient and Observation, PHI. Most of it is not specific to that service: the roster, the handoff format, the orchestrator, the gates, the hooks and the eval harness carry over unchanged. What changes is the knowledge and the commands the agents are given.

Worked target used below: a **Python 3.12 / FastAPI / pytest / SQLAlchemy claims service** (`claims-api/`) that stores claim headers and lines keyed by a member id. Still healthcare, so PHI rules stay; the domain terms, the stack commands and the planted defect change.

## Step 0: measure what encodes the old assumptions

```bash
cd AI-SDLC
node scripts/capstone/stack-inventory.mjs --files > /tmp/before.md    # about 190 files at the time of writing, per component
```

Write `scripts/capstone/terms.claims.json` (a file of your own) with the terms of the **old** stack that must disappear, and run the inventory with it after every step. You are done when only the files you deliberately kept (course docs, the old example runs) still match.

## Step 1: project memory (module 00)

- [ ] `CLAUDE.md` Layout: replace `sample-app/` with `claims-api/`; keep the roster and `agents/<name>/CONTRACT.md` lines.
- [ ] `CLAUDE.md` Commands: `cd claims-api && pytest -q` replaces `cd sample-app && mvn -q -B test` (rule 2 names the same command).
- [ ] `CLAUDE.md` rule 6: list your own planted or known defects file, or delete the rule if you have none.
- [ ] `CLAUDE.md` imports: the three `@context/...` paths still resolve after step 2 (`verify-system` checks `claude-md`).
- [ ] `.claude/rules/sample-app-java.md` becomes `.claude/rules/claims-api-python.md` with `paths: ["claims-api/src/**/*.py"]` and six checkable rules (Pydantic models at the API edge, no ORM objects in responses, audit through one logger with ids only).

## Step 2: context pack (module 00)

- [ ] `context/domain/fhir-lite-glossary.md` becomes a claims glossary: Claim, ClaimLine, Member, Provider (NPI), CPT/HCPCS and ICD-10 codes, and the business rules the code enforces.
- [ ] The PHI table lists every field: member id, name, date of birth and diagnosis codes linked to a member are PHI; claim id and CPT code alone are not.
- [ ] `context/security/phi-and-secrets-policy.md`: same structure, new paths for real data (`claims-api/data/real/**`) and the same `permissions.deny` and hook references.
- [ ] `context/architecture/overview.md`, `context/standards/*.md`: FastAPI layering (router, service, repository), pytest standards, error body format (your equivalent of `OperationOutcome`).

## Step 3: agents and contracts (module 05)

- [ ] Keep the seven role names. `check-handoff.mjs`, `check-agents.mjs`, `check-roster-flat.mjs` and `verify-system.mjs` all hard-code the roster; renaming a role means editing all four.
- [ ] `developer` and `tester`: `tool-guard.mjs write-scope claims-api/src/ claims-api/tests/ .ai-sdlc/runs/` and `bash-allow 'cd claims-api' 'pytest -q' ...` instead of `mvn -q -B test`.
- [ ] `sre`: keep the read-only `kubectl` prefixes if you deploy to Kubernetes; add every script its preloaded skills run (`verify-system` row `guard-reach` fails otherwise).
- [ ] Bodies: replace class names (`ObservationService`, `SecurityConfig`) with yours; keep the run-folder and handoff-status instructions.
- [ ] Each `agents/<name>/CONTRACT.md` lists exactly the tools the agent file lists (`node agents/check-agents.mjs`).
- [ ] Models and budgets: keep `scripts/governance/agent-policy.json` unless your evals (step 7) say otherwise.

## Step 4: skills (modules 02 to 04, 06)

- [ ] `run-tests`: replace `summarize-surefire.mjs` with a summary of `pytest --junitxml=report.xml` (JUnit XML, so the parser mostly carries over); update `allowed-tools`.
- [ ] `test-strategy/tooling-map.md`: pytest, `httpx.AsyncClient`, factory fixtures instead of JUnit 5, MockMvc, H2.
- [ ] `code-review/review-checklist.md`, `security-review/checklist.md`: your framework's auth decorators, ORM injection patterns, logging calls.
- [ ] `performance-review`: count SQL statements from SQLAlchemy `echo=True` output; keep the "statements per request must not grow with input size" rule.
- [ ] `production-rca`: keep the method and template; replace the evidence pack with one of your own synthetic incidents; keep `build-timeline.mjs` as the PHI guard and extend its patterns to member ids.
- [ ] `skills/<name>/tests/cases.json` and `tests/expected/*`: re-author against the new code; bump each skill's version in its `CHANGELOG.md`.

## Step 5: workflows, MCP and settings (modules 06, 08, 10)

- [ ] `workflows/feature-delivery.md`: the security-scoped path list (today `api/`, `config/`, `error/`, `audit/`, `src/main/resources/`, `k8s/`, `pom.xml`, `Dockerfile`) becomes your routers, auth, audit and error modules, config, manifests and dependency files (`pyproject.toml`). Worked inputs name your tickets.
- [ ] `workflows/examples/`: keep the old run as a format example or replace it with one run of your own; `verify-system` validates every example folder.
- [ ] `.claude/settings.json`: `Bash(pytest -q)` and `Bash(pytest -q *)` replace the `mvn` allow rules; deny rules gain your real-data paths. Keep the three hooks.
- [ ] `.mcp.json`: replace `fhir-readonly` with a read-only claims server that returns aggregates and ids only, or remove it; `node scripts/automation/check-mcp-config.mjs` must pass.

## Step 6: prove wiring

```bash
node scripts/capstone/verify-system.mjs --with-tests       # -> WIRED, exit 0
node scripts/capstone/stack-inventory.mjs --terms scripts/capstone/terms.claims.json --files
```

## Step 7: evaluations (module 09)

- [ ] `evaluations/datasets/*-golden.json`: new golden tasks against `claims-api/` (at least 8 per suite, one per real defect class you care about, plus one injection case).
- [ ] Delete the synthetic recordings for the old app. They are not measurements of anything in your system.
- [ ] Run live once per suite and record: `node evaluations/harness/run-evals.mjs --mode live --suite reviewer --version v2 --judge --record reviewer-v2-live`, then use `--mode replay --version v2-live` in CI.
- [ ] Keep `suites.json` gates; tighten them once you have two live runs to compare.

## Step 8: first real run

- [ ] One `/feature` run and one `/incident` run on the new service, with every handoff passing `node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/<run-id>`.
- [ ] Open the PR for the whole personalization: it touches `.claude/**`, `CLAUDE.md` and `skills/**`, so G6 (`scripts/governance/check-ai-change-approval.mjs`) requires an AI-governance approval.
