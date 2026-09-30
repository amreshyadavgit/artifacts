# Architecture review checklist

Tick every item before writing the ADR file. `scripts/validate-adr.mjs` checks the items marked (auto).

## Structure (auto)
- [ ] Title line is `# ADR-NNNN: <imperative title>` and NNNN is the next free number in `docs/adr/`.
- [ ] Metadata bullets: `Status: proposed`, `Date: YYYY-MM-DD`, `Deciders:`.
- [ ] H2 sections in template order: Context, Options considered, Decision, Consequences, Verification.
- [ ] Options table has columns `Option | Pros | Cons | Risk` and at least two option rows.
- [ ] Risks table uses the canonical findings columns and severities.
- [ ] Every backticked `path:line` resolves to an existing file and line (with `--repo`).

## Requirement analysis
- [ ] Functional and non-functional requirements separated.
- [ ] Every acceptance criterion is testable with MockMvc or a query-count assertion.
- [ ] Assumptions are labelled as assumptions, not facts.

## Existing architecture
- [ ] Read `context/architecture/overview.md` and cited what it says about the area ("Known constraints and decisions").
- [ ] Checked every existing ADR for conflicts; any conflict is written as "supersedes ADR-XXXX".
- [ ] Traced the full code path (controller, service, repository, entity, migration, tests) with `path:line` evidence.
- [ ] Found every caller of each type the decision changes (for example all uses of `Bundle.searchset`).

## Options
- [ ] At least two genuine options; each names the classes it changes.
- [ ] Each option's risk is specific to this codebase, not generic.
- [ ] The FHIR-lite wire shapes (`Bundle`, `OperationOutcome`) are preserved or the change is called out as breaking.

## Risks
- [ ] Database portability: works on H2 2.x in PostgreSQL mode and PostgreSQL 14+ (tests and `local` use H2).
- [ ] Test data: `ApiTestSupport` shares one in-memory database across test classes and never cleans it; new tests must not depend on global row counts.
- [ ] Security and PHI: auth coverage in `SecurityConfig`, no PHI in logs or `OperationOutcome.diagnostics`, `AuditLogger` still records access.
- [ ] Rollout: backward compatibility for existing clients and existing tests.

## Decision and verification
- [ ] The decision states concrete values (defaults, maxima, error codes), not "reasonable limits".
- [ ] Follow-up work has ticket ids.
- [ ] Verification lists test names that follow `testing-standards.md` naming (`returns400WhenCountIsZero`).
- [ ] Status is `proposed`. Nothing claims the ADR is accepted.
