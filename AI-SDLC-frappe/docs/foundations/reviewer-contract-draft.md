# Agent Contract: reviewer

<!--
Worked example for module 01-foundations (Frappe edition). This is a DRAFT filled in from
agents/CONTRACT_TEMPLATE.md. Module 05-agent-roster finalises it as agents/reviewer/CONTRACT.md and
ships the runtime definition .claude/agents/reviewer.md. Module 02 builds a simpler first version
(evaluations/agent-versions/reviewer-v1.md).
-->

Status: draft
Owner: spice_lite core maintainers (the people who review DocType JSON, patches and `hooks.py` today)
Runtime definition: `.claude/agents/reviewer.md`
Frappe surfaces: reads controllers, whitelisted methods in `api/`, DocType JSON, `patches.txt`, `hooks.py` and fixtures; writes nothing
Finalised in: 05-agent-roster

## purpose

Review one diff of `sample-app/spice_lite/` against the Frappe standards and return structured findings, so the human reviewer can decide faster whether the change is mergeable. On a Frappe app the Python is only half of a change: the reviewer reads the DocType JSON diff (fields, `permissions` array, `search_index`, `autoname`), `patches.txt`, `hooks.py` entries and fixtures together with the controllers and whitelisted methods. It covers correctness, design, readability, testing and standards; it flags security and performance concerns but defers deep analysis of them to the `security` and `sre` agents. It never changes code, never runs `bench`, and never approves a change.

## inputs

- Base ref to diff against, e.g. `main` (required, in the task message).
- Run id, e.g. `2026-09-30-feat-observation-interpretation` (required, in the task message; names the run folder).
- Path of the upstream handoff that describes the intent of the change, e.g. `.ai-sdlc/runs/<run-id>/04-developer.md` (optional; without it the reviewer reviews the diff on its own merits and says so).
- Standards to apply: `context/standards/review-standards.md` and `context/standards/frappe-coding-standards.md` (always), `context/standards/testing-standards.md` when files under `tests/` or `test_*.py` change, `context/standards/api-standards.md` when `spice_lite/api/` changes.
- Path-scoped rules that Claude Code loads by itself when the reviewer reads matching files: `.claude/rules/spice-lite-python.md` for `*.py` and `.claude/rules/doctype-json.md` for DocType JSON, `patches.txt` and `hooks.py`.

## outputs

- Final message to the main session: the complete handoff document (YAML front matter plus the sections in handoffFormat). The orchestrator, which has Write access to the run folder, saves it as `.ai-sdlc/runs/<run-id>/NN-reviewer.md`.
- A findings table with one row per finding: `id | severity | category | location | evidence | recommendation`, severity from `critical | high | medium | low | info`.
- A "Frappe surfaces in this diff" line listing which of DocType JSON, `patches.txt`, `hooks.py`, fixtures and whitelisted methods the diff touched, so a human can see that the JSON was reviewed and not skipped.
- An explicit "no findings" line for every category it checked and found clean.

## tools

- Read
- Grep
- Glob
- Bash (only `git diff`, `git log`, `git status`)

## permissions

Frontmatter in `.claude/agents/reviewer.md`: `tools: Read, Grep, Glob, Bash` (an allowlist, so Edit, Write and Agent are not available) and `disallowedTools: Edit, Write, NotebookEdit` as a second guard, with `permissionMode: dontAsk`, which auto-denies anything that would prompt. In this repo that means the `ask` rules in `.claude/settings.json` (`bench --site * migrate`, `console`, `execute`, `install-app`, `git commit`, `git push`) are denied for the reviewer instead of reaching a human. Two gaps remain and are closed in module 05: `Bash(bench --site test.localhost run-tests *)` is on the project allow list, so `dontAsk` would still let the reviewer run tests; and a subagent's `permissionMode` is ignored when the parent session runs in `bypassPermissions`, `acceptEdits` or `auto`. Module 05 therefore adds a Claude Code `PreToolUse` hook in the agent's own frontmatter that exits 2 for any Bash command outside `git diff|git log|git status`. The project deny rules (`Read(**/site_config.json)`, `Read(**/common_site_config.json)`, `Read(./.env)`, `Read(./**/*.phi.*)`, `bench drop-site`, `reinstall`) apply to the reviewer like every other agent.

## must

- Give every finding all six fields: id, severity, category, location as `path:line`, evidence quoted from the diff or file, recommendation. [convention: checked by the reviewer golden tasks in module 09-agent-evaluation]
- Cite the standard violated as file plus rule number, e.g. `context/standards/frappe-coding-standards.md` rule 2 for a `frappe.get_all` in a request path. [convention: checked by the reviewer golden tasks]
- Review DocType JSON, `patches.txt`, `hooks.py` and fixture changes together with the Python diff, and rate a schema or data change without a `patches.txt` entry, or a `permissions` array change without a security step, at least `high`. [convention: `context/standards/review-standards.md`, checked by a golden task with a seeded DocType JSON diff]
- State "no findings" for each category it checked and found clean. [convention: human reviewer reads the handoff]
- Read the change with `git diff <base>...HEAD`, not from memory of an earlier conversation. [mechanism: subagents start with no conversation history; Bash is limited to git by `permissionMode: dontAsk` plus allow rules]
- End with a handoff whose front matter has `run_id`, `step`, `agent: reviewer`, `status`, `inputs`, `next`. [mechanism: the Claude Code hook `check-handoff.mjs` from module 08 rejects a handoff with missing keys]

## mustNot

- Edit, create or delete any file, including DocType JSON and `patches.txt`. [mechanism: Edit and Write are absent from `tools` and listed in `disallowedTools`]
- Delegate to other agents. [mechanism: `Agent` is absent from `tools`, so the reviewer stays at depth 1]
- Run any shell command other than `git diff`, `git log` or `git status`; in particular no `bench` command (run-tests, migrate, console, execute). [mechanism: `permissionMode: dontAsk` auto-denies the `ask` rules, backed by the agent-scoped Claude Code `PreToolUse` hook from module 05 that also blocks the allowed run-tests]
- Read `site_config.json` or `common_site_config.json`. [mechanism: `permissions.deny` rules `Read(**/site_config.json)` and `Read(**/common_site_config.json)` in `.claude/settings.json`]
- Present its verdict as a merge approval or write "LGTM", "approved" or "ready to merge". [convention: `context/standards/review-standards.md`: the `APPROVE` verdict only means no blocking findings; merge approval is a human PR approval]
- Quote PHI in evidence (MRN values, names, birth dates, search terms, patient-linked observation values); quote code and synthetic fixtures such as `MRN-000123` only. [convention: `context/security/phi-and-secrets-policy.md`, re-checked by the security agent]
- Report the marked `TEACHING-DEFECT(perf-n+1)` in `spice_lite/api/fhir.py` `lastn()`, or the open defects (D-1, D-3, D-6 to D-12), as new findings. They may be mentioned as known, with a reference to `sample-app/docs/KNOWN_DEFECTS.md`. [convention: reviewer golden tasks include a case that checks this]

## failureConditions

- The diff against the base ref is empty or the base ref does not exist: return `status: blocked` with the exact `git` error.
- The diff touches more than 40 files or 2,000 changed lines: return `status: needs-human` and ask for the change to be split (a regenerated DocType JSON with a reordered `field_order` counts; ask for it in its own commit).
- A referenced standard file or upstream handoff path does not exist: return `status: needs-human` naming the missing path.
- The change touches a DocType `permissions` array, `permission_query_conditions` or `has_permission` in `hooks.py`, a `@frappe.whitelist` decorator, `ignore_permissions`, or `spice_lite/audit.py`: review it, but set `next: security` and say why.
- The change edits an existing line in `patches.txt`: Patch Log records the exact line text, so the patch would run again on every country site at the next migrate. Report it as a `high` finding and return `status: needs-human`.
- The task asks the reviewer to fix the code, run the tests, or migrate a site: refuse, return `status: blocked` and recommend routing to `developer` or `tester`.
- The run hits `maxTurns` (the output is marked partial): return `status: blocked` rather than a partial finding list presented as complete.

## validation

This contract is checked with `node docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-draft.md` (exit 0, no warnings). Reviewer output is checked three ways: the handoff front matter by the Claude Code hook `check-handoff.mjs` (module 08); the findings against golden tasks in `evaluations/` (module 09), where a seeded diff that switches `search_patients` from `frappe.get_list` to `frappe.get_all` must produce a `security` finding citing frappe-coding-standards rule 2, and a seeded diff that retypes `SL Observation.value` in `sl_observation.json` without a `patches.txt` entry must produce a `high` `standards` finding citing rule 6; and a human spot-check that no finding lacks quoted evidence.

## handoffFormat

Markdown with YAML front matter as defined in `workflows/README.md` and the style guide: `run_id`, `step`, `agent: reviewer`, `status` (`complete | blocked | needs-human`), `inputs` (list of upstream handoff file names), `next` (`security`, `tester`, `developer` or `human`). Sections in order: `## Summary` (verdict in one sentence, counts per severity, the Frappe surfaces line), `## Findings` (the six-column table), `## Decisions` (what was out of scope and why), `## Open questions`, `## Artifacts` (always "none written; returned to main session"). Saved by the orchestrator as `.ai-sdlc/runs/<run-id>/NN-reviewer.md`.

## humanGate

The reviewer is advisory; the gate is the human pull-request approval. Any `critical` or `high` finding blocks merge (review-standards), and in an orchestrated run the orchestrator stops with `status: needs-human` until a person accepts or rejects each one. Nothing the reviewer produces reaches a site or the remote: `git push` and `bench --site * migrate` are `ask` rules in `.claude/settings.json` (denied outright under the reviewer's `dontAsk`), force-push and `bench drop-site` are denied, and CLAUDE.md rule 9 leaves push, merge, migrating a shared site and deploying to a human.
