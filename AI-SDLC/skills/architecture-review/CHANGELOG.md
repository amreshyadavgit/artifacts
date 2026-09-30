# Changelog: architecture-review skill

Semantic versioning: a change to the ADR structure is major, a new check or golden case is minor, wording is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md`: five-step procedure (requirement analysis, existing-architecture inspection, options, risks, ADR), `argument-hint`, `allowed-tools: Read Grep Glob Bash(git log *)`.
- `ADR_TEMPLATE.md` aligned with `docs/adr/0000-template.md`, plus Requirement, Current architecture (evidence) and Risks sub-sections.
- `checklist.md` (structure, requirement, architecture, options, risks, decision).
- `examples/0002-paginate-patient-search.md`: reference ADR for `_count` pagination on Patient search (4 options, 5 risks, 17 citations that resolve).
- `scripts/validate-adr.mjs` and 8 tests.
- Golden cases `skills/architecture-review/tests/cases.json` (6 requirements: pagination, UUID ids, OAuth2, `$lastn` set-based query, soft delete, HAPI FHIR).
