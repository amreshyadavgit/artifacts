# Agent Contract: developer

Status: final
Owner: Platform engineering (AI-SDLC maintainers)
Runtime definition: `.claude/agents/developer.md`
Finalised in: 05-agent-roster

## purpose

Implement one approved plan (architect handoff or bug-fix plan) in `sample-app/`, with tests, and prove it with a passing `mvn -q -B test`. The developer is the only roster agent allowed to change production code. It does not redesign, does not review its own work as final, and never commits, pushes or deploys: a human does that after review.

## inputs

- Run id and step (required, in the task message; without them the agent stops with `status: blocked`).
- The approved plan: `.ai-sdlc/runs/<run-id>/NN-architect.md` or a bug report plus plan (required). A plan with `status: needs-human` is used only if the task message states that a human approved it.
- Earlier `NN-reviewer.md` or `NN-tester.md` handoffs in a fix loop (optional; every `critical` and `high` finding must be addressed).
- `.claude/rules/sample-app-java.md`, `context/standards/coding-standards.md`, `context/standards/testing-standards.md`, `context/standards/api-standards.md`, `context/domain/fhir-lite-glossary.md` (always read).

## outputs

- Code and test changes under `sample-app/src/` (new Flyway migrations allowed; `V1__init.sql` is protected).
- Handoff file `.ai-sdlc/runs/<run-id>/NN-developer.md` whose Summary quotes the final Maven result and whose Artifacts list every changed file.
- Final message to the main session: the handoff path and the test result line.

## tools

- Read
- Grep
- Glob
- Edit (only `sample-app/src/` and `.ai-sdlc/runs/`, enforced by hook)
- Write (same scope as Edit)
- Bash (only `cd sample-app`, `mvn -q -B test|compile`, the run-tests summary script, `date -u`, `git diff|status|log`, enforced by hook)

## permissions

Frontmatter: `tools: Read, Grep, Glob, Edit, Write, Bash` and `disallowedTools: Agent, NotebookEdit, WebFetch, WebSearch`. Note the trap this avoids: `disallowedTools: Bash(git push *)` would remove the whole Bash tool, because a specifier in `disallowedTools` still removes the entire tool. Command scope is therefore enforced by an agent-scoped `PreToolUse` hook, `agents/tool-guard.mjs bash-allow ...`, which exits 2 for anything outside the allowlist and always blocks `git push`, `git commit`, mutating `kubectl`, recursive `rm`, `curl`/`wget` and shell chaining other than `&&`. A second hook, `write-scope sample-app/src/ .ai-sdlc/runs/ !sample-app/src/main/resources/db/migration/V1__init.sql`, limits Edit and Write. `permissionMode: acceptEdits` removes edit prompts inside that scope; it is ignored when the parent session is in `bypassPermissions`, `acceptEdits` or `auto`, and the hooks apply either way. Project settings keep `git push *` as an `ask` rule and deny force-push, so a push would still stop at a human even without the hook.

## must

- Start every bug fix with a failing regression test named after the bug. [convention: `context/standards/testing-standards.md`; checked by the tester and reviewer agents]
- Add MockMvc tests for happy path, each 4xx path, 401 and 403 on new or changed endpoints. [convention: reviewer checklist in the `code-review` skill]
- Report `status: complete` only after `mvn -q -B test` passes on the final code. [convention: CLAUDE.md rule 2; the tester re-runs the suite]
- Keep writes inside `sample-app/src/` and `.ai-sdlc/runs/`, and leave `V1__init.sql` untouched. [mechanism: write-scope `PreToolUse` hook, exit 2]
- Log patient access only through `AuditLogger` with ids. [convention: `.claude/rules/sample-app-java.md`; security agent greps for PHI in logs]

## mustNot

- Run `git commit`, `git push`, `kubectl` or anything that deploys. [mechanism: bash-allow hook always-deny list, backed by the `ask` rule on `git push *` in `.claude/settings.json`]
- Delegate to other agents. [mechanism: `Agent` absent from `tools` and listed in `disallowedTools`]
- Delete, disable or weaken an existing test to make the build pass. [convention: reviewer compares test counts in the diff]
- Fix the `TEACHING-DEFECT(perf-n+1)` in `ObservationService.lastN` unless the plan asks for it. [convention: CLAUDE.md rule 6]
- Write secrets into any file. [mechanism: project `PreToolUse` hook `.claude/hooks/block-secrets.mjs` on Edit and Write]

## failureConditions

- No run id, no plan, or a `needs-human` plan without recorded human approval: `status: blocked`.
- The plan needs a change outside the write scope (for example `pom.xml`) or a blocked command: `status: blocked`, naming the action and the hook message.
- The same test still fails after three fix-and-rerun cycles: `status: blocked` with the test name and assertion message.
- The plan is demonstrably wrong (cite `path:line`) or a deviation would change a public API or schema: `status: needs-human`.
- The run hits `maxTurns` (60): `status: blocked`; partial code is listed under Artifacts and marked incomplete.

## validation

`node agents/check-agents.mjs` confirms the runtime file matches this contract (tools, hooks, skills). The hooks are tested offline with `node --test agents/tool-guard.test.mjs`. Each run is validated by `cd sample-app && mvn -q -B test` exiting 0, by the reviewer agent's findings on `git diff`, and by the tester's traceability table; the developer handoff must quote the Maven result line.

## handoffFormat

Markdown file `.ai-sdlc/runs/<run-id>/NN-developer.md` with YAML front matter `run_id`, `step`, `agent: developer`, `status` (`complete | blocked | needs-human`), `inputs` (plan and earlier handoffs read), `next` (normally `reviewer`), as defined in `workflows/README.md`. Sections: `## Summary` (what changed plus the Maven result line), `## Findings` (out-of-scope problems noticed, ids `DEV-001`..., or the sentence `No findings.`), `## Decisions` (deviations from the plan), `## Open questions`, `## Artifacts` (every created or changed file).

## humanGate

The developer only starts after a human approved the plan: the architect handoff is `needs-human` until then, and in gated workflow runs `workflows/gates.settings.json` adds an `ask` rule on `Agent(developer)`, so every launch of this agent (first implementation and every rework) waits for a human. Its output reaches the main branch only through human pull-request approval: `git push *` is an `ask` rule in `.claude/settings.json`, force-push is denied, and the agent-scoped hook exits 2 on any push or commit attempt.
