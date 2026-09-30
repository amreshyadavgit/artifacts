# Writer briefs (Phase 1)

Repo root: `/home/user/artifacts`. Reference repo (Claude Code project root): `/home/user/artifacts/AI-SDLC`.

## Read first (mandatory, in this order)
1. `build/CLAUDE_CODE_FACTS.md`: the only source of truth for Claude Code formats. Never invent keys, fields, flags, events, or modes.
2. `build/STYLE_GUIDE.md`: tone, depth, terminology, roster, repo layout, handoff format, tagging.
3. `build/schema.json`: the module schema.
4. `content/modules/00-example.json` and its generator `build/sources/00-example.py`: imitate this depth and style.
5. Skim what already exists: `AI-SDLC/CLAUDE.md`, `AI-SDLC/.claude/settings.json`, `AI-SDLC/.claude/hooks/`, `AI-SDLC/context/**`, `AI-SDLC/docs/adr/`, `AI-SDLC/sample-app/` (README, `ObservationService.java`, `SecurityConfig.java`, tests, `docs/KNOWN_DEFECTS.md`).

## Key facts every writer must build on
- **Subagents CAN spawn subagents** (current docs): up to 3 layers below the main conversation by default; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes it (`1` disables nesting). At the limit the `Agent` tool is withheld. The `Agent(type1, type2)` allowlist in `tools` only applies to an agent run as the main thread with `claude --agent <name>` (or the `agent` setting); in a subagent definition the parenthesised list is ignored, so restrict a subagent's delegation by omitting `Agent` from `tools` (or `disallowedTools: Agent`). The Task tool was renamed `Agent` (v2.1.63); `Task(...)` is an alias.
- Course design decision built on that: the **orchestrator runs as the main thread** (`claude --agent orchestrator`, tools include `Agent(architect, developer, reviewer, tester, security, sre)`) or as a main-session skill (`/feature`). Roster agents do **not** list `Agent` in `tools` (flat, auditable, depth 1). The hierarchical lesson (module 07/08) shows one sanctioned depth-2 pattern and explains the real limits and why we keep it shallow.
- Subagents get: their file body as system prompt, the task message, CLAUDE.md hierarchy, git status, preloaded `skills`. They do NOT get main-session history, the Claude Code system prompt, output style, or auto memory.
- Custom commands are merged into skills. Prefer `.claude/skills/<name>/SKILL.md` for every slash command. Skill frontmatter keys are hyphenated (`allowed-tools`, `disable-model-invocation`, `argument-hint`, …) plus `when_to_use`; subagent keys are camelCase (`disallowedTools`, `permissionMode`, `maxTurns`, `mcpServers`). `$ARGUMENTS`; `$0` is the FIRST argument.
- A project skill named `code-review` / `security-review` replaces the bundled one of the same name (verified).
- Permission modes: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. Hooks block only with exit code 2 (or JSON decision). Headless: `claude -p ... --output-format json` → fields `result`, `total_cost_usd`, `session_id`, `num_turns`, `is_error`, `subtype`, `usage`, `structured_output` (with `--json-schema`).
- No API key exists in this build container: you cannot run `claude -p` live. Anything that needs a live model is written as runnable instructions for the learner. Everything else you write that is code (Node scripts, hooks, Java, shell) you MUST actually run and test here (Node 22, Java 21, Maven available; `cd AI-SDLC/sample-app && mvn -q -B test` passes today with 25 tests).

## Module output rules
- Output `content/modules/<id>.json` validating against `build/schema.json`. Recommended method: write a generator `build/sources/<id>.py` (like the example) that reads implementation file content from disk, so `implementation[].content` is byte-identical to the file. Alternatively run `node build/embed.mjs content/modules/<id>.json`.
- Check your module: `node build/build.mjs 2>&1 | grep -E "<your-id>|OK"` (other writers' modules may be mid-write; ignore their errors, fix all of yours). Warnings about placeholders or < 3 test cases must be fixed too.
- Every `implementation[].path` and `startingFiles[].path` begins `AI-SDLC/`. Every implementation file must exist on disk.
- All nine exercise fields concrete. `expectedOutput` must be a realistic excerpt of real output (findings against the real sample app code — read the code and cite real file paths, class names and line-level details). No TODO/TBD/placeholder text.
- Tag each implementation: `verified-format` (Claude Code config files: agent md, SKILL.md, settings.json, .mcp.json, CLAUDE.md, rules md, plugin.json) or `illustrative` (everything else).
- `agentContracts[].agent` must be one of: architect, developer, reviewer, tester, security, sre, orchestrator.
- Mermaid: flowchart / sequenceDiagram / stateDiagram-v2, quoted labels with punctuation, no HTML except `<br/>`.
- Do not duplicate another module's core content: reference it by module id (e.g. "see module 05-agent-roster").

## Ownership (write ONLY your files; reference others by path)
Shared files owned by the orchestrator (read-only for you unless your brief says otherwise): `AI-SDLC/CLAUDE.md`, `AI-SDLC/.gitignore`, `AI-SDLC/context/**`, `AI-SDLC/docs/adr/0000-template.md`, `AI-SDLC/docs/adr/0001-*.md`, `AI-SDLC/.claude/rules/sample-app-java.md`, `AI-SDLC/.claude/hooks/block-secrets*.mjs`, `AI-SDLC/sample-app/**` (do not modify the app; exercises that change it ship the change as a startingFile/patch or a file under your own folder). `AI-SDLC/.claude/settings.json` is owned by W9.

| Writer | Module id(s) (level) | Owns |
|---|---|---|
| W1 | `01-foundations` (1) | `AI-SDLC/agents/CONTRACT_TEMPLATE.md`, `AI-SDLC/docs/foundations/**` |
| W2 | `02-first-agent-skill-tools` (2) | `AI-SDLC/evaluations/agent-versions/reviewer-v1.md` (first agent: a simple verified-format reviewer, kept as the v1 snapshot that module 09 compares against), `AI-SDLC/.claude/skills/explain-endpoint/**`, `AI-SDLC/.claude/skills/run-tests/**`, `AI-SDLC/docs/tutorials/level-2/**` |
| W3 | `03-skills-architecture-code-test` (3) | `AI-SDLC/.claude/skills/{architecture-review,code-review,test-strategy}/**`, `AI-SDLC/skills/{architecture-review,code-review,test-strategy}/**` (README.md, CHANGELOG.md, tests/cases.json) |
| W4 | `04-skills-security-performance-rca` (3) | `AI-SDLC/.claude/skills/{security-review,performance-review,production-rca}/**`, `AI-SDLC/skills/{security-review,performance-review,production-rca}/**` |
| W5 | `05-agent-roster` (3) | `AI-SDLC/.claude/agents/{architect,developer,reviewer,tester,security,sre}.md`, `AI-SDLC/agents/{architect,developer,reviewer,tester,security,sre}/CONTRACT.md` |
| W6 | `06-mcp-and-tooling-architecture` (4) | `AI-SDLC/.mcp.json`, `AI-SDLC/mcp/**` (e.g. a zero-dependency stdio MCP server for read-only FHIR-lite data), `AI-SDLC/scripts/automation/**`, `AI-SDLC/.claude/skills/ticket-intake/**`, `AI-SDLC/docs/mcp/**` |
| W7 | `07-agent-composition` (5) and `08-workflow-orchestration` (6) | `AI-SDLC/.claude/agents/orchestrator.md`, `AI-SDLC/agents/orchestrator/CONTRACT.md`, `AI-SDLC/.claude/skills/{feature,bug-fix,incident,requirements,implementation-plan}/**`, `AI-SDLC/workflows/**` (incl. `workflows/README.md` defining the handoff front matter referenced by CLAUDE.md), `AI-SDLC/.claude/hooks/check-handoff.mjs` (+ its test) |
| W8 | `09-agent-evaluation` (7) | `AI-SDLC/evaluations/**` EXCEPT `evaluations/agent-versions/reviewer-v1.md` (read it; do not write it) |
| W9 | `10-governance` (8) | `AI-SDLC/.claude/settings.json` (extend; keep the existing block-secrets hook and rules working), `AI-SDLC/.claude/hooks/**` except `block-secrets*` and `check-handoff*`, `AI-SDLC/docs/governance/**`, `AI-SDLC/company-ai/**` (skill library / plugin packaging example), `AI-SDLC/skills/README.md`, `AI-SDLC/scripts/governance/**` |
| W10 | `11-capstone` (9) | `AI-SDLC/README.md`, `AI-SDLC/docs/capstone/**`, `AI-SDLC/scripts/capstone/**` |

Canonical skill names (others may reference these): `explain-endpoint`, `run-tests` (W2); `architecture-review`, `code-review`, `test-strategy` (W3); `security-review`, `performance-review`, `production-rca` (W4); `ticket-intake` (W6); `feature`, `bug-fix`, `incident`, `requirements`, `implementation-plan` (W7).
Agents preload skills via the subagent `skills:` field: architect→architecture-review; reviewer→code-review; tester→test-strategy, run-tests; security→security-review; sre→performance-review, production-rca; developer→run-tests.

## When done
Do NOT git commit. Report back in under 250 words: files created, exercise ids, anything tagged illustrative that makes a Claude Code behaviour claim, anything you could not verify, and any file you needed from another writer.
