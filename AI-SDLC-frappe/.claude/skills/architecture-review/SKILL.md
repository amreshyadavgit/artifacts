---
name: architecture-review
description: Analyse a requirement against the spice_lite Frappe architecture and code, decide where the change lives (core DocType change, country app with Custom Fields and Property Setters, integration app with required_apps, or a core extension point), controller versus doc_events, and synchronous versus frappe.enqueue, compare at least two options with trade-offs and risks, and draft an ADR in the format of docs/adr/0000-template.md with status proposed.
when_to_use: Before implementing a change that touches a DocType schema, hooks.py, permissions, a whitelisted method contract, background jobs, or more than one app or country deployment; when asked "how should we build X", "core or country app", "is this design OK", or "write an ADR"; when the architect agent starts work.
argument-hint: "[requirement text or path to a requirements handoff]"
allowed-tools: Read Grep Glob Bash(git log *)
---

# Architecture review and ADR (Frappe edition)

Requirement to review: $ARGUMENTS

If the argument is a path to an existing file (for example `.ai-sdlc/runs/<run-id>/01-requirements.md`), Read it and treat its content as the requirement. If the argument is empty, ask for the requirement and stop.

You produce one ADR draft. You do not change code under `sample-app/`, and you do not run bench.

## Procedure

### 1. Requirement analysis
Restate the requirement in your own words, then list:
- functional requirements (what the whitelisted method or DocType must do, with an example request such as `GET /api/method/spice_lite.api.fhir.search_patients?identifier=...`),
- non-functional requirements (which country deployments, limits, latency, PHI, permissions, Postgres 16 and MariaDB, external systems and their failure modes),
- acceptance criteria a tester can turn into `FrappeTestCase` or `unittest` tests,
- open questions. If one changes the decision, state the assumption you make and flag it for the human gate.

### 2. Inspect the existing architecture
Read these first, in this order:
1. `context/architecture/overview.md` (apps, DocTypes, permissions, known constraints, the country-app rule).
2. `docs/adr/` (Glob `docs/adr/*.md`; read every ADR whose title relates). A new decision must not silently contradict an accepted ADR; if it does, it says "supersedes ADR-XXXX".
3. The standards that apply: `context/standards/frappe-coding-standards.md` (placement, permissions, SQL, patches, background work, customisation), `context/standards/api-standards.md` for anything on the wire, `context/standards/testing-standards.md` for verification, `context/security/phi-and-secrets-policy.md` and `context/security/threat-model.md` for patient data or auth, and `.claude/rules/doctype-json.md` for schema and `hooks.py` changes.
4. The code path end to end: whitelisted method in `sample-app/spice_lite/spice_lite/api/fhir.py` → mappers in `api/mappers.py` → controller in `clinical/doctype/<name>/<name>.py` → DocType JSON → `hooks.py` and `patches.txt` → tests in `tests/` and `clinical/doctype/*/test_*.py`. Grep every caller of a function you plan to change.
5. Frappe behaviour the decision relies on: check it in `build/FRAPPE_FACTS.md` or the Frappe source of the bench (`apps/frappe/frappe/...`), never from memory. Common traps: `frappe.get_all` ignores permissions; `permission_query_conditions` affects `get_list` only; `bench run-tests` does not migrate; fixtures are overwritten on migrate; RQ job arguments are visible in desk.

Record each fact you rely on as `path:line` with a short verbatim quote. Claims about current behaviour without a `path:line` are not allowed in the ADR.

### 3. Options and trade-offs
Walk the axes in [frappe-options.md](frappe-options.md): where the change lives, controller versus `doc_events`, synchronous versus `frappe.enqueue`, read-path permissions, data and rollout. Give at least two real options plus, when plausible, "minimal change". For each: which apps and files change, pros, cons, and the main risk. Keep the FHIR-lite wire shapes from `context/domain/spice-lite-glossary.md`.

### 4. Risks
List risks in the canonical findings format (`id | severity | category | location | evidence | recommendation`, ids `AR-001`...), severities `critical|high|medium|low|info`. Include schema and patch risks, PHI in logs or job arguments, permission bypasses, Postgres/MariaDB differences, install order across apps, fixture overwrites, queue timeouts and outage behaviour, and test-harness limits.

### 5. Decision and ADR
- Pick one option and say why, in terms of the forces from step 1.
- Fill [ADR_TEMPLATE.md](ADR_TEMPLATE.md). Keep the section headings of `docs/adr/0000-template.md` exactly (Context, Options considered, Decision, Consequences, Verification); put the requirement analysis and evidence under `### ` sub-headings inside Context, and the risk table under `### Risks` inside Consequences.
- Number: Glob `docs/adr/[0-9][0-9][0-9][0-9]-*.md`, take the highest number and add one. File name: `docs/adr/NNNN-kebab-case-title.md`.
- Status is always `proposed`. Only a human changes it to `accepted` (human gate: the ADR is reviewed in the pull request that adds it).
- Verification names concrete tests (`TestClass#test_method`, following `testing-standards.md`), metrics, or review checks.

### 6. Self-check before you finish
Walk [checklist.md](checklist.md). Every item must be true. Then write the ADR file (writes outside `docs/adr/` are out of scope for this skill) and reply with:
1. the ADR path,
2. a five-line summary: decision, top two risks, follow-up tickets,
3. the command a human runs to validate it: `node ${CLAUDE_SKILL_DIR}/scripts/validate-adr.mjs <adr-path> --repo . --bench /home/user/frappe-bench --status proposed` (Claude Code expands `${CLAUDE_SKILL_DIR}` to this skill's directory; replace the bench path with yours).

## Rules
- Never invent DocTypes, fields, `hooks.py` keys, Frappe APIs or whitelisted methods. If Read or Grep did not find it, it does not exist yet; call it "new". An app-defined `hooks.py` key is allowed only as an explicit decision of this ADR.
- No PHI in examples. Synthetic values only (`MRN-000123`, a national ID such as `12345678`, family name `Test`).
- Keep the ADR under 150 lines. Link to files instead of pasting code blocks longer than 10 lines.
- An ADR records a decision; the implementation plan belongs to the implementation-plan skill (module 07).
