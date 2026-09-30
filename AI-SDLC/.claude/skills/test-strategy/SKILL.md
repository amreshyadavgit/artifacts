---
name: test-strategy
description: Produce a risk-based test plan for a change to sample-app covering unit, integration, API, negative, edge, performance, security and regression tests, mapped to JUnit 5, Mockito, MockMvc, H2 and context/standards/testing-standards.md. Lists existing coverage, defects found while planning, and exact test class and method names.
when_to_use: Before implementing a change or after an ADR is drafted; when asked "what should we test", "write a test plan", "how do we test this endpoint"; when the tester agent starts work.
argument-hint: "[endpoint, class, ADR path, or change description]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git status *)
---

# Test strategy for a sample-app change

Change to plan tests for: $ARGUMENTS

If the argument is a path (an ADR under `docs/adr/`, a handoff under `.ai-sdlc/runs/`), Read it first. If it is empty, plan for the uncommitted diff:

!`git diff --stat HEAD -- sample-app`

## Procedure

1. **Find the change surface.** Locate every element the change touches: controller method, request parameters and their binding (`@RequestParam` types), service rules, repository queries, entity fields, migrations, security matchers in `SecurityConfig`. Record each as `path:line` plus a verbatim quote.
2. **Inventory existing coverage.** Grep `sample-app/src/test/java` for the URL, the controller method, and the service method. List every existing test that exercises the change and what it proves. Do not plan a test that already exists; reference it with status `existing`.
3. **Read the standards.** `context/standards/testing-standards.md` (required layers, naming, synthetic data), `context/standards/api-standards.md` (status codes, Bundle, OperationOutcome), and `context/domain/fhir-lite-glossary.md` business rules. Map each rule that applies to at least one test.
4. **Analyse risk.** For each element ask: what input is legal but unusual (empty, duplicate, null, boundary, case, whitespace, very large)? What happens on the error path (which `FhirApiException` factory or `GlobalExceptionHandler` method answers)? Who may call it (401, 403)? How many SQL statements does it issue for N rows? What can leak PHI? Write every defect you find as a finding (`TS-001`...) in the canonical format; if you infer behaviour from code without running it, say "reasoned from code".
5. **Design cases.** Fill [TEST_PLAN_TEMPLATE.md](TEST_PLAN_TEMPLATE.md). Use [tooling-map.md](tooling-map.md) for the tool of each category and the harness facts (shared H2 database, null ordering). Each case gets a behaviour name `TestClass#methodName`, a concrete scenario, an observable expectation (status, JSON path and value, statement count), and a status: `existing`, `new`, or `new-failing`.
6. **Cover all eight categories.** unit, integration, api, negative, edge, performance, security, regression. A category may be `N/A: <reason>` only when the change genuinely has nothing to test there (for example no role matrix beyond CLINICIAN/ADMIN means no 403 case for a read endpoint).
7. **Prioritise.** Order test cases so the ones guarding findings of severity high or above come first within their category.
8. **Hand off.** Reply with the plan. If the tester agent will implement it, end with the exact file paths to create and the command `cd sample-app && mvn -q -B test`. The run-tests skill (module 02) reports the result.

## Rules
- Only synthetic data: `ApiTestSupport.uniqueMrn()`, family names unique to the test (`Lastnundated`), LOINC codes from the glossary (`8867-4`, `8480-6`, `29463-7`).
- Never plan tests against production data, and never read `sample-app/data/real/`.
- Do not plan to fix `TEACHING-DEFECT(perf-n+1)` unless asked; plan the performance test that detects it and mark it `new-failing`.
- A `new-failing` case names the ticket or finding id it proves.
- Keep the plan structure exactly as in the template; `scripts/validate-test-plan.mjs` checks it, and with `--repo` it checks that every `existing` test really exists and every `new` test does not.
