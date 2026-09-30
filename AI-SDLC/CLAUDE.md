# AI-SDLC reference repository

This repository is a working AI-assisted SDLC system for a small FHIR-lite API. It contains Claude Code subagents, skills, hooks, workflows, evaluations, and the Java service they operate on.

## Layout
- `sample-app/`: Java 21 / Spring Boot 3.5 FHIR-lite Patient/Observation API. Build and test with `mvn -q -B test` from `sample-app/`.
- `.claude/agents/`: subagents: architect, developer, reviewer, tester, security, sre, orchestrator.
- `.claude/skills/`: skills (architecture-review, code-review, test-strategy, security-review, performance-review, production-rca, and workflow entry points).
- `agents/<name>/CONTRACT.md`: the Agent Contract each subagent must satisfy. Treat it as the spec.
- `workflows/`: feature-delivery, bug-fix, incident-response.
- `context/`: architecture, standards, security, domain. Read the relevant file before acting.
- `evaluations/`: golden datasets and the eval harness.

## Context to load on demand
- Architecture: @context/architecture/overview.md
- Domain terms and PHI classification: @context/domain/fhir-lite-glossary.md
- Security and PHI policy: @context/security/phi-and-secrets-policy.md
- Standards live in `context/standards/` (coding, testing, API, review). Read the one that matches the task; do not load all of them.

## Rules
1. Never put PHI or secrets in code, logs, prompts, test fixtures, commit messages, or MCP calls. Use synthetic data such as `MRN-000123`.
2. Every change to `sample-app/` needs tests, and `mvn -q -B test` must pass before you report completion.
3. Follow the layering in `context/standards/coding-standards.md`: controllers call services, services call repositories.
4. Findings use the format in `context/standards/review-standards.md` (id, severity, category, location, evidence, recommendation).
5. Agent handoffs go to `.ai-sdlc/runs/<run-id>/NN-<agent>.md` with the YAML front matter defined in `workflows/README.md`.
6. Do not fix the `TEACHING-DEFECT(perf-n+1)` or the discovered defects D-01..D-03 listed in `sample-app/docs/KNOWN_DEFECTS.md` unless the task explicitly asks for it; exercises depend on them.
7. Never push, merge, or deploy. A human does that after review.

## Commands
- Test: `cd sample-app && mvn -q -B test`
- Run locally: `cd sample-app && mvn spring-boot:run -Dspring-boot.run.profiles=local`
- Evals (offline replay): `node evaluations/harness/run-evals.mjs --mode replay`
