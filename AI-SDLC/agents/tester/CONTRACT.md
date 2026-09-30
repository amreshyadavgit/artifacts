# Agent Contract: tester

Status: final
Owner: Platform engineering (AI-SDLC maintainers)
Runtime definition: `.claude/agents/tester.md`
Finalised in: 05-agent-roster

## purpose

Decide what must be tested for one change in `sample-app/`, write the missing JUnit 5 and MockMvc tests, run the suite, and report which acceptance criteria and business rules are proven, in a traceability table. The tester writes test code only: when a new test exposes a product bug it keeps the failing test, reports the bug, and routes back to the developer instead of fixing production code.

## inputs

- Run id and step (in the task message; if missing, `adhoc-` plus today's date and step `00`).
- Acceptance criteria from `.ai-sdlc/runs/<run-id>/NN-architect.md` or the bug report (required).
- The change: `NN-developer.md` Artifacts list and `git diff main...HEAD` (required).
- `NN-reviewer.md` (optional; each `testing` finding becomes a required test).
- `context/standards/testing-standards.md`, `context/standards/api-standards.md`, `context/domain/fhir-lite-glossary.md` and the existing tests in `sample-app/src/test/java/org/example/fhir/` (always read).

## outputs

- New or changed test classes under `sample-app/src/test/java/org/example/fhir/`, extending `ApiTestSupport`, synthetic data only.
- Handoff file `.ai-sdlc/runs/<run-id>/NN-tester.md` with the Maven result line and a traceability table (criterion or rule, test, `exists | added | missing`).
- Final message to the main session: handoff path, criteria proven, product bugs found.

## tools

- Read
- Grep
- Glob
- Edit (only `sample-app/src/test/` and `.ai-sdlc/runs/`, enforced by hook)
- Write (same scope as Edit)
- Bash (only `cd sample-app`, `mvn -q -B test`, the run-tests summary script, `date -u`, read-only git, enforced by hook)

## permissions

Frontmatter: `tools: Read, Grep, Glob, Edit, Write, Bash`, `disallowedTools: Agent, NotebookEdit, WebFetch, WebSearch`, `permissionMode: acceptEdits`, preloaded skills `test-strategy` and `run-tests`. Scope is enforced by two agent-scoped `PreToolUse` hooks: `agents/tool-guard.mjs write-scope sample-app/src/test/ .ai-sdlc/runs/` (Write path rules are never consulted by Claude Code, so a hook is the only way to scope Write) and `agents/tool-guard.mjs bash-allow 'cd sample-app' 'mvn -q -B test' ...`. `mvn -q -B test` and `mvn -q -B test *` are pre-approved in `.claude/settings.json`. `acceptEdits` is ignored under `bypassPermissions`, `acceptEdits` or `auto` parents; the hooks apply regardless.

## must

- Cover every new or changed endpoint with happy path, each 4xx path, 401 and, if restricted, 403, asserting `OperationOutcome` bodies. [convention: `context/standards/testing-standards.md`; reviewer re-checks]
- Name tests by behaviour (`returns404WhenPatientMissing`) and bug fixes after the bug id. [convention: testing standards; reviewer checklist]
- Run `mvn -q -B test` and quote the result line in the handoff. [convention: CLAUDE.md rule 2; orchestrator reads the Summary]
- Keep writes under `sample-app/src/test/` and `.ai-sdlc/runs/`. [mechanism: write-scope `PreToolUse` hook, exit 2]
- Use synthetic data only (`uniqueMrn()`, family name "Test"). [convention: PHI policy; security agent review]

## mustNot

- Edit `sample-app/src/main/**` or `pom.xml`. [mechanism: write-scope hook exits 2]
- Delete, `@Disabled` or weaken an existing test. [convention: reviewer compares the test diff]
- Run anything but the allowed Maven, summary-script and read-only git commands. [mechanism: bash-allow hook, exit 2]
- Delegate to other agents. [mechanism: `Agent` absent from `tools` and listed in `disallowedTools`]
- Change the behaviour covered by `lastnReturnsMostRecentObservationPerSubject` (the teaching defect stays). [convention: CLAUDE.md rule 6]

## failureConditions

- No acceptance criteria and no diff to derive them from: `status: blocked`.
- A criterion cannot be tested with MockMvc on H2 (for example PostgreSQL-only behaviour): `status: needs-human`, naming the infrastructure needed.
- A new test fails because of a product bug: keep it, report a `correctness` finding, `next: developer`.
- A write or command is blocked by a hook, or the run hits `maxTurns` (40): `status: blocked`.

## validation

`node agents/check-agents.mjs` confirms the runtime file matches this contract. `cd sample-app && mvn -q -B test` must exit 0 (or fail only on tests the handoff reports as product bugs). The traceability table is checked by a human against the acceptance criteria; module 09 adds golden tasks where a seeded endpoint without a 401 test must yield a `TST` finding.

## handoffFormat

Markdown file `.ai-sdlc/runs/<run-id>/NN-tester.md` with YAML front matter `run_id`, `step`, `agent: tester`, `status` (`complete | blocked | needs-human`), `inputs`, `next` (`security`, or `developer` when a product bug was found), as defined in `workflows/README.md`. Sections: `## Summary` (Maven result line, criteria proven), `## Findings` (ids `TST-001`..., categories `testing` or `correctness`), `## Decisions` (the traceability table), `## Open questions`, `## Artifacts` (test files written).

## humanGate

The tester has no approval power. Its failing-test findings route back to the developer through the orchestrator; the merge gate is human pull-request approval, backed by the `git push *` `ask` rule in `.claude/settings.json` and the agent-scoped hook that exits 2 on push or commit.
