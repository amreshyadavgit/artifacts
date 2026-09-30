# Claude Code Facts (verified against official docs)

Fetched: 2026-09-30. Source base: https://code.claude.com/docs/en/<page> (raw markdown via `<page>.md`; docs.claude.com redirects here). Page index: https://code.claude.com/docs/llms.txt
Docs describe Claude Code up to roughly v2.1.28x. Many behaviors carry "requires vX or later" notes; the facts below reflect the current (latest) docs.

Pages fetched successfully (HTTP 200): sub-agents, skills, slash-commands, hooks, hooks-guide, mcp, memory, settings, settings-reference, iam, permissions, permission-modes, headless, cli-reference, commands, plugins (overview), plugins-reference (= plugins/manifest-reference), plugins/components, output-styles, model-config, costs, agent-teams, env-vars, managed-settings, agent-sdk/typescript.

---

## 1. Subagents
Source: https://code.claude.com/docs/en/sub-agents

### File locations & priority (same `name` -> higher priority wins)
| Priority | Location | Scope |
|---|---|---|
| 1 (highest) | Managed settings dir `.claude/agents/` | Org-wide |
| 2 | `--agents` CLI flag (JSON) | Current session |
| 3 | `.claude/agents/` | Current project (walks up from cwd to repo root; closest wins) |
| 4 | `~/.claude/agents/` | All your projects |
| 5 (lowest) | Plugin `agents/` dir | Where plugin enabled; named `plugin-name:agent` (subfolders become `plugin:sub:agent`) |

- Dirs are scanned recursively; subfolders do not affect identity (identity = frontmatter `name`), except in plugins.
- Files are hot-reloaded (watcher) except: first agent in a newly created `agents` dir needs restart; `--add-dir` agents dirs not watched.
- Format: Markdown with YAML frontmatter; body = the subagent's system prompt. "Subagents receive only this system prompt plus basic environment details like the working directory, not the Claude Code system prompt."

### Frontmatter fields (EXACT, complete list from docs table)
Only `name` and `description` are required. Multi-word names are camelCase; unknown fields are silently ignored.
| Field | Values / notes |
|---|---|
| `name` | Required. Unique id, e.g. `code-reviewer`. Cannot contain `:`. Filename need not match. Hooks see it as `agent_type`. |
| `description` | Required. When Claude should delegate. Add "use proactively" to encourage auto-delegation. |
| `tools` | Comma-separated string (`Read, Grep, Bash`) or YAML list. **Omitted => inherits every tool available to subagents** (incl. MCP tools). Allowlist. |
| `disallowedTools` | Denylist, same format; removed from inherited/specified list. A specifier like `Bash(git push *)` still removes the whole tool. |
| `model` | `sonnet`, `opus`, `haiku`, `fable`, full model ID (e.g. `claude-opus-5-5`), or `inherit`. |
| `permissionMode` | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan` (`manual` = alias of `default`). Ignored for plugin subagents. |
| `maxTurns` | Max agentic turns; output marked partial when hit. |
| `skills` | Skills to preload (full content injected at startup). Cannot preload skills with `disable-model-invocation: true`. |
| `mcpServers` | List of server-name strings (reuse configured server) or inline `{name: {type, command, args, ...}}` (stdio/http/sse/ws). Ignored for plugin subagents. |
| `hooks` | Lifecycle hooks scoped to this subagent (same format as settings hooks). `Stop` is converted to `SubagentStop`. Ignored for plugin subagents. |
| `memory` | `user` (`~/.claude/agent-memory/<name>/`), `project` (`.claude/agent-memory/<name>/`), `local` (`.claude/agent-memory-local/<name>/`). Auto-enables Read/Write/Edit; loads first 200 lines / 25KB of `MEMORY.md`. |
| `background` | `true` = always run in background. |
| `omitClaudeMd` | `true` = skip user/project/local CLAUDE.md (managed still loads). v2.1.271+. |
| `effort` | `low`, `medium`, `high`, `xhigh`, `max` (model dependent). |
| `isolation` | `worktree` = run in temporary git worktree (auto-cleaned if no changes). |
| `color` | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. |
| `initialPrompt` | Auto-submitted first user turn when agent runs as main session (`--agent`/`agent` setting). |
| `experimental` | Map; only key `cacheTtl`: `5m` or `1h`. |

Plugin agents: supported = `name, description, model, effort, maxTurns, tools, disallowedTools, skills, memory, background, omitClaudeMd, isolation, color, experimental.cacheTtl`; ignored = `permissionMode, hooks, mcpServers, initialPrompt` (source: https://code.claude.com/docs/en/plugins/components).

Minimal verified example:
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

### Tools available to subagents
- Inherit built-in + MCP tools of main conversation, minus (always): `Agent` (only at depth limit), `AskUserQuestion`, `EndConversation`, `EnterPlanMode`, `ExitPlanMode` (unless `permissionMode: plan`), `ScheduleWakeup`, `WaitForMcpServers`, `Workflow`.
- Background subagents keep all MCP tools but only these built-ins: `Read, Grep, Glob, LSP, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill, ToolSearch, EnterWorktree, ExitWorktree, Monitor, TaskStop, SendMessage, Artifact` (+ `SubagentHandback`).
- To block Skill use: omit `Skill` from `tools` or add to `disallowedTools`.

### The Agent tool (formerly Task)
- "In version 2.1.63, the Task tool was renamed to Agent. Existing `Task(...)` references in settings and agent definitions still work as aliases."
- Agent tool input fields: `prompt`, `description`, `subagent_type`, `model` (also `name`, `isolation`, `run_in_background` referenced elsewhere). Source: https://code.claude.com/docs/en/hooks#agent
- `Agent(worker, researcher)` in `tools` = allowlist of spawnable types — applies ONLY to an agent running as main thread via `claude --agent`. In a subagent definition, listing `Agent` lets it spawn subagents (depth permitting) but the parenthesized type list is ignored.
- Deny specific subagents: `"permissions": {"deny": ["Agent(Explore)", "Agent(my-custom-agent)"]}` or `--disallowedTools "Agent(Explore)"`. Deny `Agent` entirely to prevent all delegation.

### CAN SUBAGENTS SPAWN SUBAGENTS? — YES (current docs)
Quote: "By default, a subagent can spawn subagents of its own, up to three layers below the main conversation. At the depth limit, Claude Code withholds the `Agent` tool from every subagent except a fork, so a subagent at the limit does its delegated work itself and returns one summary."
- Change limit: env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (e.g. `"2"`); "Set `1` to turn nesting off."
- To stop a particular subagent spawning: omit `Agent` from its `tools` or add to `disallowedTools`.
- History note in docs: v2.1.172–v2.1.216 nesting up to 5 layers (fixed); v2.1.217–v2.1.218 default 1 (no nesting); v2.1.219+ default 3. (Older Claude Code versions before 2.1.172 did NOT allow nesting — older docs said subagents cannot spawn subagents.)
- Interactive: launching subagent waits for its background children; in `-p`/Agent SDK it does not wait.
- "A fork can't spawn further forks."
- Concurrency: default 20 running subagents max (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), error `Concurrent subagent limit reached`.

### Model resolution order
1. per-invocation `model` param on the Agent call; 2. frontmatter `model` (`inherit` = main model); 3. `CLAUDE_CODE_SUBAGENT_MODEL` env; 4. main conversation model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces env model on all subagents. Subagents inherit extended-thinking config; no per-subagent thinking setting.

### Invocation / delegation
- Automatic: Claude delegates based on `description`.
- Natural language: "Use the test-runner subagent to fix failing tests".
- @-mention: `@"code-reviewer (agent)" ...` or typed `@agent-<name>` / `@agent-my-plugin:code-reviewer`.
- Whole session: `claude --agent code-reviewer` or `{"agent": "code-reviewer"}` in `.claude/settings.json` (flag wins). Agent's prompt replaces default system prompt; CLAUDE.md still loads.
- `/agents` (v2.1.198+) only prints a reminder to ask Claude or edit `.claude/agents/` directly (source: /en/commands).

### Foreground / background / resume
- Fork mode is ON by default in interactive sessions (v2.1.232+) -> subagents run in background; OFF in `-p` and Agent SDK (`CLAUDE_CODE_FORK_SUBAGENT=1|0` overrides). Ctrl+B backgrounds a running task. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` forces foreground.
- Background permission prompts surface in main session.
- Resume: each invocation is a new instance; Claude resumes via `SendMessage` with agent ID or name as `to`. Explore and Plan are one-shot (no agent ID, cannot resume). Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`, deleted after `cleanupPeriodDays` (default 30).
- Subagents start with fresh context (no conversation history), get: own system prompt, task message, CLAUDE.md hierarchy (not Explore/Plan), git status (not Explore/Plan), preloaded skills. Output style and main auto memory never reach non-fork subagents.
- Fork (`/subtask <task>`; `fork` subagent_type): inherits full conversation, same system prompt/tools/model.

### Built-in subagents
| Agent | Model | Tools |
|---|---|---|
| `Explore` | inherits main (capped at Opus on Claude API) | read-only (Write/Edit denied); thoroughness: quick / medium / very thorough |
| `Plan` | inherits main | read-only; used in plan mode |
| `general-purpose` | `CLAUDE_CODE_SUBAGENT_MODEL` or main | all subagent tools |
| `claude`, `statusline-setup` (Sonnet), `claude-code-guide` (Haiku) | helpers | |
Disable Explore+Plan: `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`; all built-ins in -p/SDK: `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1`.

### `--agents` CLI JSON
```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```
Keys: top-level key = name; `prompt` (= body) plus `description, tools, disallowedTools, model, permissionMode, mcpServers, hooks, maxTurns, skills, initialPrompt, memory, effort, background, omitClaudeMd, isolation`. `color`/`experimental` ignored here. With `-p`, value may be a path to a JSON file (v2.1.281+). Also `--append-subagent-system-prompt[-file]` in -p mode.

---

## 2. Skills
Source: https://code.claude.com/docs/en/skills

**"Custom commands have been merged into skills."** `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`. `.claude/commands/` files keep working (older format; same frontmatter except `name` and `paths`). If a skill and a command share a name, the skill wins. https://code.claude.com/docs/en/slash-commands serves the identical Skills page.

### Locations
| Level | Path |
|---|---|
| Enterprise | `<managed settings dir>/.claude/skills/<skill-name>/SKILL.md` |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| Project | `.claude/skills/<skill-name>/SKILL.md` (also parents up to repo root) |
| Nested | `<subdir>/.claude/skills/<skill-name>/SKILL.md` (loads when Claude touches files there; clashing name -> `/subdir:skill`) |
| `--add-dir` dir | its `.claude/skills/` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` -> `/plugin-name:skill-name` |
Precedence for same name: enterprise > personal > project. Reserved folder names: `synced`, `anthropic-skills`.

### Frontmatter fields (EXACT list from docs; all optional, `description` recommended; hyphenated lowercase except `when_to_use`)
| Field | Notes |
|---|---|
| `name` | Command name; defaults to directory name. |
| `description` | What/when. If omitted, first non-empty body line. `description`+`when_to_use` truncated at 1,536 chars in listing. |
| `when_to_use` | Extra trigger context appended to description. |
| `argument-hint` | Autocomplete hint, e.g. `[issue-number]`. |
| `arguments` | Named positional args (space-separated string or YAML list) for `$name` substitution. |
| `disable-model-invocation` | `true` = only user can invoke (`/name`); description not in context; can't be preloaded into subagents. Default `false`. |
| `user-invocable` | `false` = hidden from `/` menu, only Claude invokes. Default `true`. |
| `allowed-tools` | Tools pre-approved (no prompt) during the invoking turn; grant clears on next user message. Does NOT restrict available tools. Space/comma string or list. |
| `disallowed-tools` | Tools removed while skill active (clears on next message). |
| `model` | Model for rest of current turn (or forked subagent's model with `context: fork`); `inherit` allowed. |
| `effort` | `low`/`medium`/`high`/`xhigh`/`max`. |
| `context` | `fork` = run in a subagent (NOT a conversation fork; no history). |
| `agent` | Subagent type for `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom). Default `general-purpose`. |
| `background` | Only with `context: fork`; `false` = wait for result. Default `true`. |
| `hooks` | Hooks registered when skill invoked, live for rest of session; supports `once`. |
| `paths` | Globs limiting auto-activation to matching files. |
| `shell` | `bash` (default) or `powershell` for `!` injections. |
| `metadata` | Free-form map, ignored by Claude Code. |
| `license` | Accepted, not acted on. |
| `compatibility` | String <=500 chars, accepted, not acted on. |
Booleans accept true/false/yes/no/on/off/1/0. Unknown fields silently ignored.
Portability: claude.ai uploads / Skills API / `package_skill.py` accept ONLY `name, description, license, compatibility, metadata, allowed-tools` (others = hard error "Unexpected key(s) in SKILL.md frontmatter").

### String substitutions
`$ARGUMENTS` (full arg string; if no placeholder present, Claude Code appends `ARGUMENTS: <value>`), `$ARGUMENTS[N]` (0-based), `$N` (shorthand, `$0` = first), `$name` (from `arguments`), `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` & `${CLAUDE_PLUGIN_DATA}` (plugin skills only). Shell-style quoting for indexed args. Escape literal with `\$1.00`.
NOTE: `$0` is the FIRST argument, `$1` the second (0-based).

### Dynamic context injection
- Inline: `` !`gh pr diff` `` (only at line start or after whitespace). Multi-line: fenced block opened with ```` ```! ````.
- Runs before content is sent; failure (non-zero exit, except exit 1 of search/compare commands) aborts the whole invocation. Checked against permission rules; non-allow aborts outside auto mode — pre-approve via `allowed-tools`.
- Disable: `"disableSkillShellExecution": true`.
- `@` file references in a local skill body are attached as files (per synced-skill note in docs).
- `ultrathink` in skill content requests deeper reasoning.

### Supporting files
```text
my-skill/
├── SKILL.md (required)
├── reference.md (loaded when needed)
├── examples.md
└── scripts/helper.py (executed, not loaded)
```
Keep SKILL.md under 500 lines; link supporting files from it.

### Invocation & lifecycle
- `/skill-name args` or Claude auto-loads by description. Descriptions always in context (unless `disable-model-invocation`), body loads on invoke and stays in context; after compaction, re-attached (first 5,000 tokens each, 25,000 total budget).
- Stack: `/write-tests /fix-issue 123` loads both (first + up to 5 more).
- Restrict: deny `Skill` tool; `Skill(name)` / `Skill(name *)` permission rules.
- Some built-ins callable via Skill tool: `/init`, `/security-review`.

Example:
```yaml
---
name: fix-issue
description: Fix a GitHub issue
disable-model-invocation: true
allowed-tools: Bash(gh *)
argument-hint: [issue-number]
---

Fix GitHub issue $ARGUMENTS following our coding standards.
```
Forked example:
```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---
Research $ARGUMENTS thoroughly...
```

---

## 3. Slash commands (legacy `.claude/commands/`)
Source: https://code.claude.com/docs/en/skills (slash-commands page == skills page), https://code.claude.com/docs/en/commands
- `.claude/commands/<name>.md` -> `/<name>`; `~/.claude/commands/` for personal (plugin: `commands/`). Subdirectory: `.claude/commands/frontend/component.md` -> `/frontend:component` (NOTE: current docs namespace with `:`).
- Frontmatter: same as skills EXCEPT `name` and `paths` (so `description`, `argument-hint`, `allowed-tools`, `model`, `disable-model-invocation`, `context`, `agent`, etc. all work).
- Body supports `$ARGUMENTS`, `$0`/`$1`/`$ARGUMENTS[N]`, `` !`cmd` `` injection, `@file` refs.
- Prefer skills for new work (supporting files).
- In `-p` mode, user-invoked skills/commands work by including `/skill-name` in the prompt.
- Built-in commands of note: `/agents`, `/hooks`, `/mcp`, `/memory`, `/init`, `/permissions`, `/config`, `/model`, `/output-style`, `/plugin`, `/skills`, `/compact`, `/usage` (`/cost`, `/stats` aliases), `/subtask`.

---

## 4. Hooks
Source: https://code.claude.com/docs/en/hooks , https://code.claude.com/docs/en/hooks-guide

### Where
`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed policy, plugin `hooks/hooks.json`, skill frontmatter, subagent frontmatter. Hooks merge across levels. Settings hooks also fire inside subagents (with `agent_id`, `agent_type`). `/hooks` menu to view. `disableAllHooks` setting; `allowManagedHooksOnly` (managed).

### JSON shape (event -> matcher groups -> handlers)
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/check.sh", "timeout": 30 }
        ]
      }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "/path/to/lint-check.sh" } ] }
    ]
  }
}
```

### All hook events (current docs)
`SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult`, `SessionEnd`.

### Matchers
- `"*"`, `""`, or omitted = all. Only letters/digits/`_`/`-`/space/`,`/`|` = exact string or list (`Edit|Write`, `Edit, Write`). Any other char = unanchored JS regex (`^Notebook`, `mcp__memory__.*`).
- MCP: `mcp__<server>__<tool>`; `mcp__memory` alone matches nothing — use `mcp__memory__.*`. Plugin MCP: `mcp__plugin_<plugin>_<server>__<tool>`.
- What matcher filters: tool events -> tool name; SessionStart -> `startup|resume|clear|compact|fork`; SessionEnd -> `clear|resume|logout|prompt_input_exit|other`; Notification -> `permission_prompt|idle_prompt|auth_success|elicitation_dialog|...`; SubagentStart/Stop -> agent type; PreCompact/PostCompact -> `manual|auto`; ConfigChange -> `user_settings|project_settings|local_settings|policy_settings|skills`; UserPromptExpansion -> command name; no matcher: `UserPromptSubmit, PostToolBatch, Stop, TeammateIdle, TaskCreated, TaskCompleted, WorktreeCreate, WorktreeRemove, MessageDisplay, CwdChanged`.
- Per-handler `if` (tool events only): one permission rule e.g. `"Bash(git *)"`, `"Edit(*.ts)"`.

### Handler types & fields
Types: `command`, `http`, `mcp_tool`, `prompt`, `agent` (agent = experimental).
- Common: `type` (req), `if`, `timeout` (seconds; defaults 600 command/http/mcp_tool, 30 prompt, 60 agent; 30 on UserPromptSubmit/Pre/PostModelSwitch; SessionEnd shares 1.5s budget), `statusMessage`, `once` (skill frontmatter only).
- command: `command` (req), `args` (exec form, no shell), `async`, `asyncRewake`, `shell` (`bash`|`powershell`).
- prompt/agent: `prompt` (req; `$ARGUMENTS` = input JSON), `model`; prompt also `continueOnBlock`. LLM response: `{"ok": true|false, "reason": "...", "impossible": bool}`.
- All matching hooks run in parallel; identical handlers deduplicated.

### Env / placeholders
`${CLAUDE_PROJECT_DIR}` (project root), `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `$CLAUDE_CODE_REMOTE` ("true" in web), `$CLAUDE_EFFORT`. There is NO `$CLAUDE_MODEL` env var.

### Common stdin input fields
`session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode` (`default|plan|acceptEdits|auto|dontAsk|bypassPermissions`), `effort` ({level}), `hook_event_name`; inside subagent/`--agent`: `agent_id`, `agent_type`.
Event-specific: tool events `tool_name`, `tool_input`, `tool_use_id`; PostToolUse adds `tool_response`, `duration_ms`; UserPromptSubmit `prompt`; SessionStart `source`, optional `model`, `agent_type`, `session_title`; Stop `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`; SubagentStop adds `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`.
```json
{"session_id":"abc123","transcript_path":"/home/user/.claude/projects/.../transcript.jsonl","cwd":"/home/user/my-project","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm test","description":"Run test suite","timeout":120000,"run_in_background":false},"tool_use_id":"toolu_01ABC123..."}
```

### Exit codes
- `0`: success; stdout parsed as JSON if it starts `{` and ends `}`. Plain stdout added as context ONLY for `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`; otherwise debug log only.
- `2`: blocking error; stderr (or JSON reason) is the message. Blocks: PreToolUse (blocks call), UserPromptSubmit (erases prompt), UserPromptExpansion, Stop/SubagentStop (forces continue), TeammateIdle, TaskCreated, TaskCompleted, ConfigChange, PostToolBatch, PreCompact, PreModelSwitch, Elicitation, ElicitationResult. PostToolUse/PostToolUseFailure: stderr shown to Claude (tool already ran). PermissionRequest: exit 2 NOT honored (use decision JSON). Notification, Setup, InstructionsLoaded, StopFailure: ignored.
- Other (incl. 1): non-blocking error, action proceeds (unless valid JSON decides). "If your hook is meant to enforce a policy, use `exit 2`." WorktreeCreate/Remove: any non-zero fails.
- Timed-out command hook on PreToolUse does NOT block.

### JSON output
Universal: `continue` (default true; false stops Claude), `stopReason`, `suppressOutput` (no effect), `systemMessage`, `terminalSequence`. Strings capped at 10,000 chars.
Decision patterns:
- Top-level `{"decision": "block", "reason": "..."}`: UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange, PreCompact. (`"block"` is the only value.)
- PreToolUse: `hookSpecificOutput.permissionDecision` = `"allow"|"deny"|"ask"|"defer"`, `permissionDecisionReason`, `updatedInput` (replaces whole input), `additionalContext`. Precedence deny > defer > ask > allow. Deprecated top-level `approve`/`block` map to allow/deny. `defer` only honored in `-p`.
- PermissionRequest: `hookSpecificOutput.decision.behavior` = `allow|deny` (+ `updatedInput`, permission updates).
- PermissionDenied: `hookSpecificOutput.retry: true`.
- SessionStart: `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`. SubagentStart/PostModelSwitch: `additionalContext` only.
- PostToolUse: `updatedToolOutput`.
- `hookSpecificOutput` requires `hookEventName`.
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Database writes are not allowed"}}
```
Stop loop guard: check `stop_hook_active`; 8-consecutive-continuation cap. Async hooks (`"async": true`) cannot block.

---

## 5. MCP
Source: https://code.claude.com/docs/en/mcp

### Scopes
| Scope | Stored in | Notes |
|---|---|---|
| `local` (default) | `~/.claude.json` under `projects["<path>"].mcpServers` | private, this project |
| `project` | `.mcp.json` at project root | shared via VCS; interactive approval prompt required |
| `user` | `~/.claude.json` top-level | all projects |
Precedence for duplicate names: local > project > user > plugin > claude.ai connectors (whole entry, no field merging). Managed `managedMcpServers` ranks above all.

### `.mcp.json` format
```json
{
  "mcpServers": {
    "shared-server": { "type": "http", "url": "https://example.com/mcp" },
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": { "Authorization": "Bearer ${API_KEY}" }
    },
    "local-tool": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "API_KEY": "${API_KEY}" }
    }
  }
}
```
- `type`: `stdio`, `http` (alias `streamable-http`), `sse` (deprecated), `ws`. Entry without `type` = stdio; `url` without `type` is an error. `"type": "sdk"` only for SDK hosts.
- http/ws fields: `url`, `headers`, `headersHelper`, `timeout`, `alwaysLoad`.
- Env expansion: `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`. Unset w/o default -> warning, literal text kept.
- Stdio servers get `CLAUDE_PROJECT_DIR` in their env (in `.mcp.json` command/args use `${CLAUDE_PROJECT_DIR:-.}`).

### CLI
```bash
claude mcp add --transport http notion https://mcp.notion.com/mcp
claude mcp add --transport http secure-api https://api.example.com/mcp --header "Authorization: Bearer your-token"
claude mcp add --transport sse asana https://mcp.asana.com/sse
claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable -- npx -y airtable-mcp-server
claude mcp add --transport http shared-server --scope project https://example.com/mcp
claude mcp add-json events-server '{"type":"ws","url":"wss://mcp.example.com/socket"}'
claude mcp list | get <name> | remove <name> [--scope <scope>] | reset-project-choices
```
`--` separates Claude options from the server command. `--scope local|project|user`. In-session: `/mcp`.

### Other
- Tool naming: `mcp__<server>__<tool>` (plugin: `mcp__plugin_<plugin>_<server>__<tool>`).
- Project-server approval: prompted interactively; `-p`/SDK/cloud load without asking. Settings: `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers` (committed approvals need workspace trust).
- Output: warning > 10,000 tokens; default max 25,000 tokens; `MAX_MCP_OUTPUT_TOKENS` raises; per-tool `_meta["anthropic/maxResultSizeChars"]` up to 500,000 chars. Oversize results saved to file.
- `--mcp-config <files|json>`, `--strict-mcp-config`. `MCP_TIMEOUT` startup timeout (30s default).
- Permission rules: `mcp__puppeteer`, `mcp__puppeteer__*`, `mcp__puppeteer__puppeteer_navigate`.
- `claude mcp serve` exposes Claude Code as an MCP server.

---

## 6. CLAUDE.md / memory
Source: https://code.claude.com/docs/en/memory
| Scope | Location |
|---|---|
| Managed policy | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL `/etc/claude-code/CLAUDE.md`; Windows `C:\Program Files\ClaudeCode\CLAUDE.md` |
| User | `~/.claude/CLAUDE.md` (+ `~/.claude/rules/*.md`) |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` (+ `.claude/rules/**/*.md`) |
| Local | `./CLAUDE.local.md` (still supported; add to `.gitignore`) |
- Loading: all files from cwd and every parent are concatenated (not overriding), root-first, so closer files read last; `CLAUDE.local.md` appended after `CLAUDE.md` in each dir. Subdirectory CLAUDE.md load on demand when Claude reads files there. Block-level HTML comments stripped. Files up to 4 MiB load; target <200 lines.
- Imports: `@path/to/file` (relative to the importing file, or absolute, `~/`); max depth 4 hops; not parsed inside code spans/blocks; escape spaces with `\ `. External imports need a one-time approval dialog.
- `.claude/rules/`: recursive `.md` files; optional frontmatter `paths:` (globs; only field read) for path-scoped rules; others load at launch.
- `AGENTS.md`: read when no CLAUDE.md/CLAUDE.local.md exists in cwd or above (v2.1.277+); otherwise import it with `@AGENTS.md`.
- `claudeMdExcludes` setting to skip files; `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` to load from `--add-dir`.
- Auto memory: `~/.claude/projects/<project>/memory/MEMORY.md` (first 200 lines/25KB loaded) + topic files; `autoMemoryEnabled`, `autoMemoryDirectory`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- `/memory`: edit CLAUDE.md files, toggle auto memory. `/init`: generate CLAUDE.md (`CLAUDE_CODE_NEW_INIT=1` for interactive flow incl. skills/hooks).

---

## 7. Settings & permissions
Sources: https://code.claude.com/docs/en/settings , https://code.claude.com/docs/en/settings-reference , https://code.claude.com/docs/en/permissions , https://code.claude.com/docs/en/permission-modes , https://code.claude.com/docs/en/managed-settings

### Files & precedence (highest first)
1. Managed: `managed-settings.json` (+ `managed-settings.d/`) at macOS `/Library/Application Support/ClaudeCode/`, Linux/WSL `/etc/claude-code/`, Windows `C:\Program Files\ClaudeCode\`; or MDM / server-managed (claude.ai console). Also `managed-mcp.json`.
2. Command line (`--settings <file-or-json>`, flags)
3. `.claude/settings.local.json` (project local)
4. `.claude/settings.json` (shared project)
5. `~/.claude/settings.json` (user)
Array keys like `permissions.allow` MERGE across files. `~/.claude.json` holds MCP local/user config & state (not settings.json).

### Permissions block
```json
{
  "permissions": {
    "allow": ["Bash(npm run *)", "Bash(git commit *)", "Read(~/.zshrc)"],
    "ask": ["Bash(git push *)"],
    "deny": ["Read(./.env)", "Read(./secrets/**)", "WebFetch", "Agent(Explore)"],
    "additionalDirectories": ["../docs/"],
    "defaultMode": "acceptEdits",
    "disableBypassPermissionsMode": "disable"
  },
  "env": { "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "2" },
  "model": "claude-sonnet-5",
  "apiKeyHelper": "/bin/generate_temp_api_key.sh"
}
```
- Evaluation: deny -> ask -> allow; first match wins; specificity irrelevant. Bare-tool deny (e.g. `Bash`) removes the tool from context.
- Also: `permissions.disableAutoMode`, `permissions.blockReadsOutsideWorkingDirectories`, `allowManagedPermissionRulesOnly` (managed), `skipDangerousModePermissionPrompt`.
- `additionalDirectories` grants file access only (loads no `.claude/` config); `--add-dir` also loads that dir's skills/commands/agents.

### Rule syntax
- `Tool` or `Tool(specifier)`; `Bash(*)` == `Bash`.
- Bash: `*` wildcard anywhere; `Bash(npm run *)` (space before `*` matters: `Bash(ls *)` != `lsof`); legacy `:*` suffix equivalent (`Bash(npm run test:*)` == `Bash(npm run test *)`), only at end. Compound commands checked per subcommand.
- Read/Edit (gitignore syntax): `//abs/path`, `~/home/path`, `/relative-to-settings-source`, `path` or `./path` relative to cwd. E.g. `Read(./secrets/**)`, `Edit(/src/**/*.ts)`. Only `Read(...)`/`Edit(...)` path rules are consulted (Write/Glob path rules are never consulted). Read deny also blocks Edit/Write on that path.
- WebFetch: `WebFetch(domain:example.com)`, `WebFetch(domain:*.example.com)`.
- MCP: `mcp__server`, `mcp__server__*`, `mcp__server__tool`. Allow-globs only after literal `mcp__<server>__`.
- Agent: `Agent(Explore)`, `Agent(my-agent)`; parameter rules (deny/ask only) e.g. `Agent(model:opus)`, `Agent(isolation:worktree)`, `Bash(run_in_background:true)`.
- Skill: `Skill(name)`.
- Tool-name globs for deny/ask: `"*"`, `"mcp__*"`.

### Permission modes (exact config values)
| Mode | Behavior |
|---|---|
| `default` | "Manual" in UI; prompts on first use; `manual` accepted as alias (v2.1.200+) |
| `acceptEdits` | auto-accept file edits + `mkdir/touch/mv/cp` in working dirs |
| `plan` | read-only exploration, no source edits until plan approved |
| `auto` | classifier reviews actions in background; built-in default for new terminal sessions in recent versions (v2.1.228+ / v2.1.283 notes); requires supported model; org can disable |
| `dontAsk` | auto-deny anything that would prompt; allowed tools still run |
| `bypassPermissions` | skip prompts (deny rules and a few safety checks still apply); containers/VMs only |
- Set: `--permission-mode <mode>` (flag), `--dangerously-skip-permissions` (= bypassPermissions), `--allow-dangerously-skip-permissions` (adds to cycle), `permissions.defaultMode` in settings (`auto`/`bypassPermissions` ignored from project/local settings), subagent `permissionMode`.
- Shift+Tab cycles `default -> acceptEdits -> plan -> (bypassPermissions) -> (auto)`; `dontAsk` never in cycle. `/plan` prefix enters plan mode for one prompt.
- For `-p`, built-in starting mode is Manual (`default`) on every plan.
- Subagent `permissionMode` ignored when parent is in `bypassPermissions`, `acceptEdits`, or `auto`; a subagent can't escalate to `bypassPermissions` unless parent is.

### Other settings keys
`env` (object), `model`, `apiKeyHelper` (shell cmd; output sent as `X-Api-Key` and `Authorization: Bearer`), `agent`, `outputStyle`, `effortLevel`, `fallbackModel`, `availableModels`, `hooks`, `disableAllHooks`, `enabledPlugins`, `autoMemoryEnabled`, `cleanupPeriodDays`, `disableSkillShellExecution`, `sandbox` ({`enabled`, `autoAllowBashIfSandboxed`, `excludedCommands`, `allowUnsandboxedCommands`, `filesystem`: {`allowWrite`,`denyWrite`,`denyRead`,`allowRead`}, `network`: {`allowedDomains`, `allowUnixSockets`...}, `credentials`...}). `/sandbox` command. `/permissions`, `/config`.

---

## 8. Headless / CLI (`claude -p`)
Sources: https://code.claude.com/docs/en/headless , https://code.claude.com/docs/en/cli-reference , https://code.claude.com/docs/en/agent-sdk/typescript
Flags (verified in cli-reference):
- `-p`, `--print`
- `--output-format text|json|stream-json` (default text); stream needs `--verbose`; `--include-partial-messages`
- `--input-format text|stream-json`
- `--json-schema '<schema>'` -> result in `structured_output` field (print mode)
- `--allowedTools` / `--allowed-tools` (auto-approve; permission rule syntax, e.g. `"Bash(git diff *)" "Read"` or `"Bash,Read,Edit"`)
- `--disallowedTools` / `--disallowed-tools` (deny rules)
- `--tools` (restrict available built-ins: `""`, `"default"`, `"Bash,Edit,Read"`)
- `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions|manual`
- `--permission-prompt-tool <mcp tool>`, `--permission-prompts none` (v2.1.259+)
- `--dangerously-skip-permissions`
- `--max-turns N` (print mode; errors when hit), `--max-budget-usd <amt>` (print mode; subagent spend counts)
- `--model <alias|id>`, `--fallback-model a,b`, `--effort low|medium|high|xhigh|max|ultracode`
- `--system-prompt`, `--system-prompt-file` (replace); `--append-system-prompt`, `--append-system-prompt-file` (append)
- `--mcp-config <files/json>`, `--strict-mcp-config`
- `--agents '<json>'` (or file path with -p), `--agent <name>`, `--append-subagent-system-prompt[-file]`
- `--continue`/`-c`, `--resume`/`-r <id|name|path.jsonl>`, `--fork-session`, `--session-id <uuid>`, `--no-session-persistence`
- `--settings <file|json>`, `--setting-sources user,project,local`, `--add-dir`, `--plugin-dir`, `--bare` (skip hooks/skills/commands/subagents/plugins/MCP/auto memory/CLAUDE.md; recommended for scripts), `--verbose`, `--forward-subagent-text`
Exit code 0 success, non-zero on failure.

### JSON result shape (`--output-format json`; also final `result` message in stream-json)
From SDKResultMessage: `type: "result"`, `subtype` (`"success"` | `"error_max_turns"` | `"error_during_execution"` | `"error_max_budget_usd"` | `"error_max_structured_output_retries"`), `uuid`, `session_id`, `duration_ms`, `duration_api_ms`, `is_error`, `num_turns`, `result` (string, success), `stop_reason`, `total_cost_usd`, `usage`, `modelUsage` (per-model), `permission_denials`, `structured_output?`, `deferred_tool_use?`, `terminal_reason?`, plus optional timing fields.
```bash
claude -p "Summarize this project" --output-format json | jq -r '.result'
session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
claude -p "Continue that review" --resume "$session_id"
```
Stream-json: subagent messages carry `parent_tool_use_id`; `system/init` event includes `mcp_server_errors`.

---

## 9. Models
Source: https://code.claude.com/docs/en/model-config
- Aliases: `default` (clears override), `best`, `fable`, `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opus[1m]`, `opusplan` (opus in plan mode, sonnet for execution). Anthropic API: `opus` -> Opus 5.5, `sonnet` -> Sonnet 5.5. Example full IDs in docs: `claude-opus-5-5`, `claude-sonnet-5`, `claude-opus-5`.
- Subagent `model` field accepts `sonnet`, `opus`, `haiku`, `fable`, full ID, or `inherit` (not documented there: `opusplan`, `default`).
- Priority: `/model` in session > `--model` > `ANTHROPIC_MODEL` > settings `model` > `ANTHROPIC_DEFAULT_MODEL`.
- Env: `ANTHROPIC_DEFAULT_OPUS_MODEL` (and family equivalents), `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`.
- Effort: `low|medium|high|xhigh|max` (`/effort`, `--effort`, `effortLevel`); `ultrathink` keyword.

---

## 10. Plugins
Sources: https://code.claude.com/docs/en/plugins , https://code.claude.com/docs/en/plugins-reference , https://code.claude.com/docs/en/plugins/components
- Manifest (optional): `<plugin-root>/.claude-plugin/plugin.json`; only `name` required (kebab-case). Other keys: `displayName, version, description, author{name,email,url}, homepage, repository, license, keywords, metadata, defaultEnabled, dependencies, settings, userConfig, channels, skills, commands, agents, hooks, mcpServers, lspServers, outputStyles, workflows, experimental{themes,monitors,evals}`.
- Standard layout (at plugin root, NOT inside `.claude-plugin/`): `skills/<name>/SKILL.md`, `commands/*.md`, `agents/*.md`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `workflows/`, `themes/`, `monitors/monitors.json`, `bin/` (on PATH), `settings.json` (only `agent`, `subagentStatusLine`).
- Namespacing: `/plugin-name:skill`, agents `plugin-name:agent`. Plugin-root `CLAUDE.md` is NOT loaded.
- Paths: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`.
- Manage: `/plugin`, marketplaces; `claude --plugin-dir ./my-plugin` for session; `claude plugin validate`; `claude plugin eval`. A skill folder with `.claude-plugin/plugin.json` loads as plugin `<name>@skills-dir`.
```json
{ "name": "deploy-tools", "version": "1.2.0", "description": "Deployment commands", "author": { "name": "Example Team" } }
```

### Output styles (brief)
Source: https://code.claude.com/docs/en/output-styles
Files in `~/.claude/output-styles`, `.claude/output-styles`, managed dir. Frontmatter: `name`, `description`, `keep-coding-instructions` (default false), `force-for-plugin` (plugin only). Built-ins: Default, Proactive, Concise, Explanatory, Learning. Select via `/output-style`, `/config`, `outputStyle` setting. Not applied to non-fork subagents.

### Costs (brief)
Source: https://code.claude.com/docs/en/costs — `/usage` (aliases `/cost`, `/stats`); `total_cost_usd` in -p JSON (client-side estimate).

### Agent teams (brief)
Source: https://code.claude.com/docs/en/agent-teams — experimental, off by default; enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Distinct from subagents (separate sessions that message each other).

---

## 11. NOT SUPPORTED / DO NOT INVENT
- Do NOT claim subagents cannot spawn subagents — in current docs they CAN (default depth 3, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). Only forks can't spawn forks, and at the depth limit `Agent` is withheld.
- `Agent(type1, type2)` allowlist in `tools` works only for `claude --agent` main-thread agents; ignored in subagent definitions.
- No subagent frontmatter fields: `temperature`, `max_tokens`, `top_p`, `thinking`, `system_prompt`, `prompt` (in files; body is prompt), `allowed-tools` (hyphenated is SKILL syntax; subagents use `tools`), `allowedTools`, `timeout`, `context`, `version`, `author`, `tags`, `priority`, `subagents`, `parent`. Unknown fields are silently ignored — typos fail silently.
- Subagent field names are camelCase (`disallowedTools`, `permissionMode`, `maxTurns`, `mcpServers`, `initialPrompt`, `omitClaudeMd`); skill field names are hyphenated (`allowed-tools`, `disallowed-tools`, `argument-hint`, `disable-model-invocation`, `user-invocable`) plus `when_to_use`. Do not mix.
- No per-subagent extended-thinking setting.
- Skill `allowed-tools` does NOT restrict tools (it pre-approves); use `disallowed-tools` to remove.
- Skill `context: fork` does NOT inherit conversation history.
- `$1` in skills is the SECOND argument (`$0` is the first).
- Subagents do NOT receive the Claude Code system prompt, conversation history, output style, or main auto memory.
- Plugin subagents ignore `hooks`, `mcpServers`, `permissionMode` (and `initialPrompt`).
- No hook events named `PreAgent`, `PostAgent`, `OnError`, `BeforeEdit`, `AfterEdit`, `PreCommit`, `PostResponse`. Use the listed events only.
- Hook exit code 1 does NOT block (only 2 does). PermissionRequest ignores exit 2. Top-level `decision` only value is `"block"` (no `"allow"`/`"approve"` for top-level decision; PreToolUse's `approve`/`block` are deprecated).
- No `$CLAUDE_MODEL` env var in hooks.
- MCP matcher `mcp__server` (no `__.*`) matches nothing in hooks (but IS valid in permission rules).
- `.mcp.json` has no `scope`, `enabled`, or `disabled` keys per server (use settings `disabledMcpjsonServers` / `/mcp disable`). An entry with `url` needs `type`.
- MCP scope names are `local`, `project`, `user` (not `global`/`workspace`).
- Permission mode names: only `default` (alias `manual`), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. No `readOnly`, `yolo`, `strict`, `acceptAll`.
- Path rules on `Write(...)`, `Glob(...)`, `NotebookEdit(...)` are never consulted — use `Edit(...)`/`Read(...)`.
- A single leading `/` in Read/Edit rules is NOT filesystem-absolute (use `//`).
- `permissions.additionalDirectories` does NOT load skills/agents/commands/CLAUDE.md from those dirs.
- Rules files (`.claude/rules/*.md`) only read the `paths` frontmatter field.
- `/agents` no longer opens an interactive editor (v2.1.198+).
- No `--max-tokens`, `--temperature`, `--timeout`, `--quiet`, `--yes` CLI flags documented. `--max-turns`, `--max-budget-usd`, `--json-schema` are print-mode only.
- Plugin components go at plugin root, not inside `.claude-plugin/`; plugin-root CLAUDE.md is not loaded.
- claude.ai/Skills API only accept 6 skill frontmatter keys (`name, description, license, compatibility, metadata, allowed-tools`).

## Unverified
- Nothing requested failed to fetch. Not independently verified by running the CLI: the exact JSON printed by `claude -p --output-format json` (shape taken from the Agent SDK `SDKResultMessage` type, which the docs say mirrors the result message). `~/.claude/commands/` as personal command location is inferred from the skills "Command files" rules plus the enterprise/personal/project pattern; the docs table explicitly lists `.claude/commands/`.
