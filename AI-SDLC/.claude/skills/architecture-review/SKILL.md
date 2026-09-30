---
name: architecture-review
description: Analyse a requirement against the existing FHIR-lite architecture and code, compare at least two options with trade-offs and risks, and draft an ADR in the format of docs/adr/0000-template.md with status proposed. Use when a change adds or changes an endpoint contract, the data model, a dependency, or a cross-cutting concern such as security, pagination, ids, or error handling.
when_to_use: Before implementation of any change that touches more than one layer of sample-app; when asked "how should we build X", "is this design OK", or "write an ADR"; when the architect agent starts work.
argument-hint: "[requirement text or path to a requirements handoff]"
allowed-tools: Read Grep Glob Bash(git log *)
---

# Architecture review and ADR

Requirement to review: $ARGUMENTS

If the argument is a path to an existing file (for example `.ai-sdlc/runs/<run-id>/01-requirements.md`), Read it and treat its content as the requirement. If the argument is empty, ask for the requirement and stop.

You produce one ADR draft. You do not change code under `sample-app/`.

## Procedure

### 1. Requirement analysis
Restate the requirement in your own words, then list:
- functional requirements (what the API must do, with example requests),
- non-functional requirements (limits, latency, PHI, security, portability between PostgreSQL and H2),
- acceptance criteria a tester can turn into MockMvc tests,
- open questions. If an open question changes the decision, state the assumption you make and flag it for the human gate.

### 2. Inspect the existing architecture
Read these first, in this order:
1. `context/architecture/overview.md` (components, data model, endpoints, known constraints).
2. `docs/adr/` (Glob `docs/adr/*.md`; read every ADR whose title relates to the requirement). A new decision must not silently contradict an accepted ADR; if it does, it must say "supersedes ADR-XXXX".
3. The standards that apply: `context/standards/api-standards.md` for anything on the wire, `context/standards/coding-standards.md` for layering, `context/standards/testing-standards.md` for verification, `context/security/phi-and-secrets-policy.md` and `context/security/threat-model.md` for anything touching patient data or auth.
4. The code path end to end. For an endpoint that is controller → service → repository → entity → migration (`sample-app/src/main/resources/db/migration/`) and the tests that cover it (`sample-app/src/test/java/org/example/fhir/`). Use Grep to find every caller of a type you plan to change (for example `Bundle.searchset`).

Record each fact you will rely on as `path:line` with a short verbatim quote. Claims about current behaviour without a `path:line` are not allowed in the ADR.

### 3. Options and trade-offs
Give at least two real options plus, when it is plausible, "minimal change". For each: how it works in this codebase (which classes change), pros, cons, and the main risk. Prefer options that keep the FHIR-lite wire shapes from `context/domain/fhir-lite-glossary.md`.

### 4. Risks
List risks in the canonical findings format (`id | severity | category | location | evidence | recommendation`, ids `AR-001`...), severities `critical|high|medium|low|info`. Include migration and rollout risks, test-data risks, and database portability (H2 in PostgreSQL mode backs tests and the `local` profile; `V1__init.sql` is written to run on both).

### 5. Decision and ADR
- Pick one option and say why, in terms of the forces from step 1.
- Fill [ADR_TEMPLATE.md](ADR_TEMPLATE.md). Keep the section headings of `docs/adr/0000-template.md` exactly (Context, Options considered, Decision, Consequences, Verification); put requirement analysis and evidence under `### ` sub-headings inside Context, and the risk table under `### Risks` inside Consequences.
- Number: Glob `docs/adr/[0-9][0-9][0-9][0-9]-*.md`, take the highest number and add one. File name: `docs/adr/NNNN-kebab-case-title.md`.
- Status is always `proposed`. Only a human changes it to `accepted` (human gate: the ADR is reviewed in the pull request that adds it).
- Verification names concrete tests (class and method names that follow `testing-standards.md`), metrics, or review checks.

### 6. Self-check before you finish
Walk [checklist.md](checklist.md). Every item must be true. Then write the ADR file (writes outside `docs/adr/` are out of scope for this skill) and reply with:
1. the ADR path,
2. a five-line summary: decision, top two risks, follow-up tickets,
3. the command a human runs to validate the structure: `node .claude/skills/architecture-review/scripts/validate-adr.mjs <adr-path> --repo .`

## Rules
- Never invent classes, endpoints, config keys or tables. If you did not find it with Read or Grep, it does not exist yet; call it "new".
- No PHI in examples. Use synthetic values (`MRN-000123`, family name `Test`).
- Keep the ADR under 150 lines. Link to files instead of pasting code blocks longer than 10 lines.
- An ADR records a decision; do not write the implementation plan here (that is the implementation-plan skill, module 07).
