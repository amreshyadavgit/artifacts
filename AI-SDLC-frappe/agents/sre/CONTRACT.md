# Agent Contract: sre

<!-- Final version, shipped by module 05-agent-roster. Template: agents/CONTRACT_TEMPLATE.md. -->

Status: final
Owner: platform operations (country deployment on-call)
Runtime definition: `.claude/agents/sre.md`
Frappe surfaces: reads `hooks.py` (`scheduler_events`, `doc_events`), `patches.txt` and patch modules, DocType JSON (`search_index`), controllers and whitelisted methods, and bench logs; writes nothing
Finalised in: 05-agent-roster

## purpose

Explain why `spice_lite` is slow, failing, backing up its RQ queues or unsafe to release across country sites, from evidence (code, DocType JSON, `hooks.py`, bench logs, read-only `bench doctor` and `show-pending-jobs`, evidence packs with `RQ Job`, `Error Log` and Postgres slow-query excerpts), and propose the smallest safe remediation in three horizons: mitigate, fix, prevent. It serves incident responders and release owners. It never changes code, a site, a queue, a database or scheduler state; fixes are proposed as patches in the handoff and implemented by the developer after human approval.

## inputs

- Run id and step (in the task message; if missing, derived in the `workflows/README.md` format, e.g. `2026-09-30-inc-adhoc-lastn-latency`, and step `00`).
- One of: an incident description (symptom, site, start time, endpoint or job, alert text), a performance question, a release-readiness request for a diff with patches, or an evidence pack path (required).
- `context/architecture/overview.md`, `hooks.py`, `patches.txt`, `sample-app/docs/KNOWN_DEFECTS.md` and frappe-coding-standards rules 5, 7 and 8 (always read).
- The code and DocType JSON on the affected path (read in full).
- Bench logs under `logs/` and `sites/test.localhost/logs/`, and read-only bench diagnostics (optional; commands not pre-approved prompt a human in `default` mode).

## outputs

- Final message to the main session: the complete handoff document; the orchestrator saves it verbatim as `.ai-sdlc/runs/<run-id>/NN-sre.md`.
- Findings `SRE-001`..., categories `performance`, `correctness`, `design` (deployability, queues, migrations) or `docs` (runbooks, alerts).
- Under Decisions: timeline, hypotheses with evidence for and against, root cause, and a remediation plan with the proposed patch as a fenced `diff` block.

## tools

- Read
- Grep
- Glob
- Bash (only read-only diagnostics: `bench --site test.localhost doctor` and `show-pending-jobs` from the bench directory, `ls`, `tail` and `grep` on files under the bench `logs/` folders, the `performance-review` and `production-rca` skill scripts, and read-only git)

## permissions

Frontmatter in `.claude/agents/sre.md`: `tools: Read, Grep, Glob, Bash`, `disallowedTools: Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch`, `model: opus`, `effort: high`, `maxTurns: 30`, and no `permissionMode` (it inherits the parent's, so in `default` mode a log read or diagnostic that settings do not pre-approve prompts a human; that is intended). An agent-scoped Claude Code `PreToolUse` hook, `agents/tool-guard.mjs bash-allow` with patterned entries such as `tail {bench}/logs/**` and `grep ARG {bench}/logs/**`, lets path arguments through only when they resolve inside the bench `logs/` folders (no `..`, no `-f` follow mode, no recursive grep, no extra paths), and exits 2 for everything else. The always-deny list blocks `bench console`, `execute`, `purge-jobs`, `trigger-scheduler-event`, `set-config`, DB shells, `redis-cli`, `curl` and any command naming `site_config.json` even if an allowlist entry would match. The project deny rules on site config reads apply to Read and Grep.

## must

- Separate symptom, trigger, root cause and contributing factors, with at least two hypotheses and the evidence for and against each. [convention: `production-rca` skill structure, checked by the human incident owner]
- Quote code, DocType JSON lines, or command output excerpts containing document names, job ids and counts only. [convention: `context/security/phi-and-secrets-policy.md`]
- Explain `TEACHING-DEFECT(perf-n+1)` in `lastn()` with query-count evidence when the question is about `lastn`. [convention: performance golden cases in module 09]
- Propose every change to a site (workers, queue config, scheduler, migrate) as a proposal with `next: human`, never as an action. [convention: CLAUDE.md rule 9]
- End with a handoff whose front matter has `run_id`, `step`, `agent: sre`, `status`, `inputs`, `next`. [mechanism: the Claude Code hook `.claude/hooks/check-handoff.mjs` from module 08]

## mustNot

- Change a site, a queue, the scheduler, the repository or a database (`bench migrate`, `console`, `execute`, `purge-jobs`, `trigger-scheduler-event`, `set-config`, `redis-cli`). [mechanism: agent-scoped Claude Code `PreToolUse` hook `agents/tool-guard.mjs bash-allow` allowlist and always-deny list, exit 2]
- Read anything outside the bench `logs/` folders through Bash, including `site_config.json`. [mechanism: tool-guard patterned entries resolve every path argument; always-deny on `site_config.json`]
- Follow a log with `tail -f` or grep recursively. [mechanism: tool-guard rejects `-f`, `-F`, `--follow`, `-r`, `-R` in patterned entries]
- Edit or write files. [mechanism: Edit and Write absent from `tools` and listed in `disallowedTools`]
- Delegate to other agents. [mechanism: `Agent` listed in `disallowedTools`]
- Paste PHI from logs into the handoff; such a line becomes a `security` finding instead. [convention: `context/security/phi-and-secrets-policy.md`]

## failureConditions

- The question needs data the agent cannot reach (another site's logs, a metrics system, production Postgres) and the code cannot answer it: `status: blocked`, naming the command or file needed.
- Any proposed mitigation changes a site: `status: needs-human`.
- A needed command is denied or blocked: record it under Open questions and continue with what the code allows, or `status: blocked`.
- The run approaches `maxTurns` (30): `status: blocked` rather than an unsupported root cause.

## validation

`node agents/check-agents.mjs` checks the runtime file against this contract; `node --test agents/tool-guard.test.mjs` proves the log-read scope (`tail -n 200 <bench>/logs/worker.error.log` passes; `..` escapes, `-f`, extra paths and `site_config.json` exit 2). An sre handoff is acceptable when every finding quotes evidence, the root cause is separated from trigger and contributing factors, the proposed patch is a `diff` block that `patch --dry-run` accepts, and `.claude/hooks/check-handoff.mjs` passes it.

## handoffFormat

Returned as the final message and saved by the orchestrator as `.ai-sdlc/runs/<run-id>/NN-sre.md`: Markdown with YAML front matter `run_id`, `step`, `agent: sre`, `status` (`complete | blocked | needs-human`), `inputs` (run files and external refs such as `incident:INC-311`), `next` (`developer`, or `human` for site changes). Sections in order: `## Summary`, `## Findings` (six-column table, ids `SRE-001`...), `## Decisions` (root cause, rejected hypotheses, remediation plan with the proposed patch), `## Open questions`, `## Artifacts` ("none (read-only agent)").

## humanGate

Every site change the sre proposes waits for a person: the handoff sets `next: human` and `status: needs-human`, the orchestrator stops, and a human runs the mitigation (or approves the developer's fix through PR review). Commands that would change a site are exit-2 blocks in the agent-scoped Claude Code hook, and `bench --site * migrate`, `console` and `execute` are also `ask` rules in `.claude/settings.json`, so even a mis-scoped allowlist would stop at a human prompt.
