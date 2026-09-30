# Changelog: architecture-review skill (Frappe edition)

Semantic versioning: a change to the ADR structure is major, a new check, decision axis or golden case is minor, wording is a patch.

## 1.0.0 - 2026-09-30
### Added
- `SKILL.md`: five-step procedure (requirement analysis, existing-architecture inspection including Frappe source checks, options, risks, ADR), `argument-hint`, `allowed-tools: Read Grep Glob Bash(git log *)`.
- `frappe-options.md`: decision axes (core vs country app vs integration app vs extension point; controller vs `doc_events`; sync vs `frappe.enqueue`; read-path permissions; data and rollout).
- `ADR_TEMPLATE.md` aligned with `docs/adr/0000-template.md`, plus Requirement, Current architecture (evidence) and Risks sub-sections.
- `checklist.md` (structure, requirement, architecture, Frappe options, risks, decision).
- `examples/0002-national-health-id-integration-app.md`: reference ADR (4 options, 7 risks, 26 citations that resolve with `--repo` and `--bench`).
- `scripts/validate-adr.mjs` (with `--bench` for Frappe-source citations) and 10 tests.
- Golden cases `tests/cases.json` (7 requirements: national health ID, cursor pagination, telephony integration app, ERPNext billing event, set-based `lastn`, country-scoped visibility, conformant FHIR server).
