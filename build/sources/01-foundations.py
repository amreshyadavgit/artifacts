# Generator for content/modules/01-foundations.json. Run: python3 build/sources/01-foundations.py
import json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

# The module's agentContracts entry is produced from the worked draft by the validator itself,
# so the markdown contract and the JSON entry cannot drift apart.
reviewer_contract = json.loads(subprocess.run(
    ["node", "docs/foundations/validate-contract.mjs", "--json", "docs/foundations/reviewer-contract-draft.md"],
    cwd=ROOT / "AI-SDLC", check=True, capture_output=True, text=True).stdout)

# Starting file for exercise 01-classify-primitives: every need from the answer key, answers blank.
needs = []
for line in f("AI-SDLC/docs/foundations/classification-answer-key.md").splitlines():
    if line.startswith("| N") and line[3:5].isdigit():
        cells = [c.strip() for c in line.strip("|").split(" | ")]
        needs.append((cells[0], cells[1].replace("\\|", "|")))
blank = {i: {"need": n, "answer": "", "why": ""} for i, n in needs}

mod = {
 "id": "01-foundations",
 "level": 1,
 "title": "Foundations: Agent Anatomy, Primitives and the Agent Contract",
 "summary": "Learn what separates an agent from a prompt or a template, take an agent apart into twelve anatomy elements and map each one to the Claude Code mechanism that implements it (or admit it is only a convention), choose correctly between prompt, skill, agent, workflow, MCP server and hook, and write your first Agent Contract, validated by a script you run.",
 "prerequisites": ["00-example", "Node 22 (`node --version`)", "Claude Code CLI installed and authenticated (`claude --version`)", "Comfort reading a Spring Boot service layer"],
 "concepts": [
  {"heading": "Prompt, template, agent: what actually differs",
   "body_md": """A **prompt** is one instruction inside the conversation you are already in. It borrows everything from that conversation: its history, its tools, its permission mode, and your attention to check the answer. A **template** is a prompt you saved so you can paste it again. In Claude Code the saved, versioned form of a template is a **skill** (`.claude/skills/<name>/SKILL.md`): same idea, plus supporting files, arguments (`$ARGUMENTS`, `$0` for the first one) and an optional `/name` entry point.

An **agent** (a Claude Code subagent, `.claude/agents/<name>.md`) is different in kind, not in wording. Per `build/CLAUDE_CODE_FACTS.md` §1 it has:

- **its own context window**: it starts with its file body as system prompt, the task message, the CLAUDE.md hierarchy, git status and any preloaded `skills`. It does **not** get your conversation history, the Claude Code system prompt, your output style or auto memory;
- **its own tool boundary**: `tools` is an allowlist, `disallowedTools` a denylist;
- **its own authority**: `permissionMode`, `maxTurns`, `model`, optional `memory`, `hooks` and `isolation: worktree`;
- **a loop**: it keeps calling tools until it decides it is done, then returns **one final message** to the main session.

So the practical test is not \"is the prompt long\". It is: *does this job need a different context, different tools, or different authority from the conversation that asks for it?* A code review written by the same context that wrote the code is not independent. A reviewer that holds `Edit` can quietly fix what it was asked to judge. Those are problems a better prompt cannot solve and a subagent definition can.

The cost is real too: a subagent re-reads files the main session already knows, and whatever you forget to put in its task message it simply does not have. So in practice you promote a prompt to an agent only when isolation, a tool boundary or a repeatable independent opinion is worth that cost."""},
  {"heading": "Agent anatomy: twelve elements",
   "body_md": """Every agent in this course is specified with the same twelve elements. Most failures of \"it worked once in chat\" prompts come from leaving one of them implicit.

1. **Responsibilities**: the one job. Two jobs (review *and* fix) means two agents.
2. **Boundaries**: what is out of scope, even if the agent could do it.
3. **Inputs**: exactly what arrives in the task message (base ref, run id, handoff path). A subagent has nothing else from you.
4. **Outputs**: the artifact and its format, precise enough for a script to check.
5. **Tools**: the allowlist, spelled as Claude Code spells tools (`Read`, `Grep`, `Glob`, `Bash`, `mcp__server__tool`).
6. **Context**: which project knowledge it loads automatically (CLAUDE.md, preloaded skills) and which files it must `Read` for this task.
7. **Instructions**: the procedure, not a persona. \"You are a senior reviewer\" is not a step.
8. **Memory/state**: what survives between runs (the `memory` field, or handoff files) and what deliberately does not.
9. **Permissions**: what it may do without asking, what needs a human, what is denied.
10. **Verification**: how anyone can tell a good output from a plausible one.
11. **Failure handling**: what it does when the input is bad or the job is too big, instead of guessing.
12. **Handoffs**: the structured artifact the next step consumes.

The table *Anatomy element to Claude Code mechanism* below maps each element to the real configuration that implements it. The pattern to notice: elements 1, 5, 6, 7, 8 and 9 have first-class Claude Code fields; elements 2, 3, 4, 10, 11 and 12 are mostly **conventions** until you add a hook, a permission rule or an eval that enforces them. Modules 05, 08, 09 and 10 exist largely to turn those conventions into mechanisms.

Exercise `01-anatomy-breakdown` applies this list to a real one-off review prompt and shows which elements it leaves undefined."""},
  {"heading": "Mechanism or convention: enforced versus requested",
   "body_md": """Module 00 stated the rule: **instructions describe intent, permissions and hooks enforce it.** This module makes it a habit: every rule you write for an agent gets labelled as one or the other.

A **mechanism** is something Claude Code itself does regardless of what the model decides:

- `tools: Read, Grep, Glob` means `Edit` is not in the agent's toolset. It cannot be talked into editing.
- `permissions.deny: [\"Read(./.env)\"]` in `.claude/settings.json` blocks the read for every agent.
- `.claude/hooks/block-secrets.mjs` is a `PreToolUse` hook on `Edit|Write`; it exits **2**, which blocks the call. Exit 1 would not block. Settings hooks fire inside subagents too.
- A `SubagentStop` hook that exits 2 forces the subagent to keep working.

A **convention** is something only a person, a script or an eval checks: the six-field finding format, \"cite the standard\", \"never write LGTM\", the handoff front matter until module 08 adds `check-handoff.mjs`.

Conventions are not bad; most of a contract is convention. The failure mode is believing a convention is a mechanism. Two real traps from the docs:

- A subagent's `permissionMode` is **ignored** when the parent session runs in `bypassPermissions`, `acceptEdits` or `auto`. `permissionMode: dontAsk` on the reviewer is a mechanism only when the parent is in `default` or `plan`; the durable guard is an agent-scoped `PreToolUse` hook.
- Skill `allowed-tools` **pre-approves** tools for the turn; it does not restrict them. Use `disallowed-tools` to remove one.

So in practice, each `must` and `mustNot` line in an Agent Contract ends with `[mechanism: ...]` or `[convention: ...]`, and `validate-contract.mjs` rejects a line that has neither. When a `mustNot` has only conventions, the validator warns you: that agent's boundaries depend entirely on the model behaving."""},
  {"heading": "Six primitives and how to choose",
   "body_md": """Claude Code gives you six building blocks for SDLC automation. They overlap, and most bad designs use the wrong one: an agent where a hook was needed, a prompt where a skill would have been reused fifty times.

Use this decision order; the first \"yes\" wins (it is also the answer key logic for exercise `01-classify-primitives`):

1. **Must it happen every time**, whether or not the model remembers? Use a **hook** (or a permission rule). Secrets scanning, handoff validation and blocking `kubectl delete` are not suggestions.
2. **Does it need data or actions outside the repo** (Jira, a running FHIR server, GitHub)? Use an **MCP server**, so access is a named tool (`mcp__<server>__<tool>`) that permission rules can allow or deny.
3. **Does it chain several roles with human gates** between them? Use a **workflow**: a documented sequence in `workflows/`, run from the main session (module 08).
4. **Does it need its own context, its own tool limits, or an independent opinion?** Use an **agent**.
5. **Will the same procedure be repeated** by people or agents? Use a **skill**. Agents preload skills with the `skills` field, so the procedure is written once.
6. Otherwise it is a **prompt**. Do not package a question you will ask once.

Two combinations recur so often they are worth naming:

- **Agent + preloaded skill**: the agent supplies the boundary, the skill the procedure (`reviewer` preloads `code-review`; `sre` preloads `production-rca`). Upgrading the procedure does not touch the agent's permissions.
- **Workflow + hooks**: the workflow defines order and gates; hooks make the gates real.

The comparison table *Prompt, skill, agent, workflow, MCP, hook* below gives where each lives, who triggers it and how deterministic it is."""},
  {"heading": "The Agent Contract",
   "body_md": """An **Agent Contract** is this course's specification for an agent, written before the agent file and kept next to it. It is a convention, not a Claude Code feature: Claude Code only reads `.claude/agents/<name>.md`. The contract is what that file is reviewed against, what the evals in module 09 score, and what a new team member reads first.

Eleven fields, identical to `agentContracts` in `build/schema.json`:

| Field | Question it answers |
|---|---|
| `purpose` | What single decision does the output support? |
| `inputs` / `outputs` | What arrives in the task message; what comes back and where it is saved |
| `tools` | Exact tool names, with scope (\"Bash (git diff only)\") |
| `permissions` | Which frontmatter and settings enforce the boundary |
| `must` / `mustNot` | Required and forbidden behaviour, each tagged mechanism or convention |
| `failureConditions` | When to stop with `blocked` or `needs-human` instead of guessing |
| `validation` | The command, eval or check that proves an output acceptable |
| `handoffFormat` | The run-folder file and its front matter |
| `humanGate` | Where a person approves, and the real mechanism that waits for them |

The reusable template is `AI-SDLC/agents/CONTRACT_TEMPLATE.md`; each roster agent's filled copy lives at `AI-SDLC/agents/<agent>/CONTRACT.md`. `AI-SDLC/docs/foundations/validate-contract.mjs` checks that all eleven `## field` headings are present and in order, that list fields are bullets, that tool names are real Claude Code tools, that every `must`/`mustNot` line names its enforcement, and that `humanGate` names a real mechanism. `--json` prints the contract as a schema-shaped object.

This module ships a worked **reviewer** draft (`docs/foundations/reviewer-contract-draft.md`). Module 02 builds a deliberately simple first reviewer, module 05-agent-roster finalises this contract as `agents/reviewer/CONTRACT.md` with the runtime definition, and module 09 measures the agent against it. So in practice the contract changes through review like code, and the agent file follows it."""},
  {"heading": "Handoffs and depth: why the roster stays flat",
   "body_md": """Agents in this course never talk to each other directly. Each one returns a **handoff**: a Markdown document with YAML front matter (`run_id`, `step`, `agent`, `status`, `inputs`, `next`) saved under `.ai-sdlc/runs/<run-id>/NN-<agent>.md`. The next agent reads the file, not the previous agent's conversation, because it has none.

Claude Code does allow deeper structures: per the current docs a subagent **can** spawn subagents of its own, and an `Agent(...)` type allowlist is only enforced for an agent running as the main thread. The exact limits and settings are taught in module 07-agent-composition ("Nesting: the real limits").

This course's design decision built on those facts:

- The **orchestrator** runs as the main thread (`claude --agent orchestrator`, or the `/feature` skill in the main session). It is the only place delegation happens.
- Roster agents (`architect`, `developer`, `reviewer`, `tester`, `security`, `sre`) do **not** list `Agent` in `tools`. They run at depth 1, so every delegation is visible in one place and every handoff is a file you can audit.
- Module 07 shows one sanctioned depth-2 pattern and the real limits.

For the anatomy that means element 12 (handoffs) and element 2 (boundaries) meet: leaving `Agent` out of `tools` is a mechanism that keeps the handoff chain linear. The reviewer draft's `mustNot` records it as exactly that."""}
 ],
 "diagrams": [
  {"title": "Contract fields and the Claude Code mechanisms behind them",
   "mermaid": "flowchart LR\n  P[\"purpose\"] --> D[\"description field + agent file body\"]\n  I[\"inputs\"] --> TM[\"Agent tool prompt (task message)\"]\n  T[\"tools\"] --> TL[\"tools / disallowedTools\"]\n  PM[\"permissions\"] --> PS[\"permissionMode + settings allow/ask/deny\"]\n  MN[\"must / mustNot\"] --> HK[\"hooks (exit 2 blocks)\"]\n  MN -.->|\"when not enforceable\"| CV[\"convention: evals, human review\"]\n  F[\"failureConditions\"] --> MT[\"maxTurns + status: blocked\"]\n  V[\"validation\"] --> EV[\"scripts, golden tasks, SubagentStop hook\"]\n  H[\"handoffFormat\"] --> RF[\"file in .ai-sdlc/runs/RUN-ID/\"]\n  G[\"humanGate\"] --> HG[\"plan mode, ask rule, PR approval\"]"},
  {"title": "Choosing a primitive (first yes wins)",
   "mermaid": "flowchart TD\n  Q1{\"Must it happen every time?\"} -->|\"yes\"| HOOK[\"hook or permission rule\"]\n  Q1 -->|\"no\"| Q2{\"Needs a system outside the repo?\"}\n  Q2 -->|\"yes\"| MCP[\"MCP server\"]\n  Q2 -->|\"no\"| Q3{\"Several roles with human gates?\"}\n  Q3 -->|\"yes\"| WF[\"workflow\"]\n  Q3 -->|\"no\"| Q4{\"Own context, tool limits or independent opinion?\"}\n  Q4 -->|\"yes\"| AG[\"agent\"]\n  Q4 -->|\"no\"| Q5{\"Repeated procedure?\"}\n  Q5 -->|\"yes\"| SK[\"skill\"]\n  Q5 -->|\"no\"| PR[\"prompt\"]"},
  {"title": "A reviewer run under its contract",
   "mermaid": "sequenceDiagram\n  participant H as Human\n  participant M as Main session (orchestrator)\n  participant R as reviewer subagent\n  participant F as Run folder .ai-sdlc/runs/RUN-ID\n  H->>M: Review the change against main\n  M->>R: Task message with base ref, run id and upstream handoff path\n  R->>R: git diff main...HEAD and Read standards (no Edit, no Agent)\n  R-->>M: Final message is the handoff with the findings table\n  M->>F: Write NN-reviewer.md\n  M-->>H: status needs-human if any critical or high finding\n  H->>H: Approve or reject the pull request"}
 ],
 "comparisonTables": [
  {"title": "Prompt, skill, agent, workflow, MCP, hook",
   "columns": ["Primitive", "Purpose", "Where it lives", "Who triggers it", "Determinism", "Example in this repo"],
   "rows": [
    ["Prompt", "One-off instruction in the current conversation", "Nowhere (typed, or `claude -p \"...\"`)", "You", "Low: model output, shares the session's history and tools", "`claude -p 'Which tests call $lastn?' --permission-mode plan`"],
    ["Skill", "Reusable procedure plus supporting files", "`.claude/skills/<name>/SKILL.md`", "You via `/name`, Claude by `description` match, or preloaded into an agent via `skills`", "Medium: loading and `!` shell injection are deterministic; execution is model-driven", "`.claude/skills/code-review/SKILL.md` (module 03)"],
    ["Agent", "Isolated worker with its own context, tools and permissions", "`.claude/agents/<name>.md`", "Main session delegation (by `description`, by name, `@agent-<name>`) or `claude --agent <name>`", "Low output determinism, deterministic boundary (`tools`, `disallowedTools`)", "`.claude/agents/reviewer.md` (module 05)"],
    ["Workflow", "Ordered composition of agents, skills and human gates", "`workflows/*.md` spec plus an entry skill such as `/feature`", "You, from the main session", "Order and gates are fixed by the spec and hooks; each step is model-driven", "`workflows/feature-delivery.md` (module 08)"],
    ["MCP server", "Tools and data from a system outside the repo", "`.mcp.json` (project scope) or `~/.claude.json` (local, user)", "Claude calls `mcp__<server>__<tool>` when the task needs it", "The server code is deterministic; whether and how it is called is model-driven", "FHIR-lite server in `mcp/` (module 06)"],
    ["Hook", "Enforce or react at a lifecycle event", "`hooks` in `.claude/settings.json` (also agent or skill frontmatter)", "Claude Code itself, on events such as `PreToolUse`, `SubagentStop`", "High: a script; exit code 2 blocks", "`.claude/hooks/block-secrets.mjs` (exists today)"]
   ]},
  {"title": "Anatomy element to Claude Code mechanism",
   "columns": ["Element", "Claude Code mechanism", "Mechanism or convention", "Reviewer example"],
   "rows": [
    ["Responsibilities", "`description` frontmatter (delegation) and file body", "Mechanism for routing; the single-job rule is convention", "\"Reviews a diff against the standards; never edits\""],
    ["Boundaries", "`tools`, `disallowedTools`, `permissions.deny`", "Mechanism where a tool or rule expresses it; otherwise `mustNot` convention", "No Edit, Write or Agent"],
    ["Inputs", "Agent tool `prompt` (task message); CLAUDE.md hierarchy; git status", "Mechanism for delivery; required fields are convention", "Base ref, run id, upstream handoff path"],
    ["Outputs", "Subagent final message returned to the main session", "Mechanism for return; format is convention", "Six-field findings table"],
    ["Tools", "`tools` allowlist, `disallowedTools`, `mcpServers`", "Mechanism", "`Read, Grep, Glob, Bash`"],
    ["Context", "CLAUDE.md hierarchy, `skills` preload, `omitClaudeMd`", "Mechanism", "`skills: [code-review]`"],
    ["Instructions", "Agent file body = the subagent's system prompt", "Mechanism (what the model reads), content is yours", "Step-by-step review procedure"],
    ["Memory/state", "`memory: user|project|local` (`MEMORY.md`); handoff files", "Mechanism for `memory`; run state in files is convention", "No memory; state in `.ai-sdlc/runs/`"],
    ["Permissions", "`permissionMode`, settings allow/ask/deny, hooks", "Mechanism (note: `permissionMode` ignored under `acceptEdits`, `auto`, `bypassPermissions` parents)", "`permissionMode: dontAsk` + agent-scoped `PreToolUse` hook"],
    ["Verification", "`SubagentStop`/`PostToolUse` hooks, scripts, evals", "Convention until a hook runs the check", "Golden tasks in module 09"],
    ["Failure handling", "`maxTurns` (output marked partial); `-p` result `subtype`, `is_error`", "Mechanism for limits; `status: blocked` is convention", "Empty diff returns `blocked`"],
    ["Handoffs", "None built in", "Convention; made a mechanism by `check-handoff.mjs` (module 08)", "`.ai-sdlc/runs/<run-id>/NN-reviewer.md`"]
   ]}
 ],
 "exercises": [
  {"id": "01-anatomy-breakdown",
   "title": "Break a one-off review prompt into agent anatomy",
   "objective": "Take the review prompt a developer pastes into chat today, run it once to see what it produces against the real `ObservationService`, then break it into the twelve anatomy elements. For each element record what the prompt says, the gap, and the Claude Code mechanism (or convention) that will implement it in the `reviewer` agent.",
   "startingFiles": [
    {"path": "AI-SDLC/docs/foundations/one-off-review-prompt.md", "content": f("AI-SDLC/docs/foundations/one-off-review-prompt.md")}
   ],
   "requiredStructure": "AI-SDLC/docs/foundations/\n├── one-off-review-prompt.md          # given: the prompt as pasted in chat\n└── anatomy-breakdown-reviewer.md     # you write: 12-row table\n                                      # columns: # | element | what the prompt says | gap or risk | where it lives in Claude Code\n                                      # last column starts with \"Mechanism:\" or \"Convention:\"",
   "implementation": [
    {"path": "AI-SDLC/docs/foundations/anatomy-breakdown-reviewer.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\n# 1. Run the one-off prompt as-is (plan mode so nothing is edited)\nclaude -p \"$(cat docs/foundations/one-off-review-prompt.md) The changes are in sample-app/src/main/java/org/example/fhir/service/ObservationService.java and api/ObservationController.java.\" --permission-mode plan --output-format json | jq -r '.result'\n\n# 2. Ask for the anatomy breakdown, then compare it with your own table\nclaude -p 'Read docs/foundations/one-off-review-prompt.md. For each of these elements: responsibilities, boundaries, inputs, outputs, tools, context, instructions, memory/state, permissions, verification, failure handling, handoffs, give one table row: what the prompt says, the gap, and the Claude Code subagent field or setting that would implement it, or the word convention if none does.' --permission-mode plan --output-format json | jq -r '.result'",
   "expectedOutput": "Run 1 (the raw prompt), typical result:\n\nHere's what I found:\n1. Performance: `lastN` in ObservationService loops over `subjectIds` and calls `patients.findById` and `findByPatientIdOrderByEffectiveDateTimeDesc` per subject, an N+1. I'd replace it with a single query using `IN (:ids)`.\n2. `ObservationController.lastN` accepts an unbounded `List<Long> subjects`; add a max size.\n3. `create()` doesn't check that the subject Patient is active.\n4. Style: consider extracting the code-parsing `substring(indexOf('|') + 1)` into the mapper.\nI can apply fixes 1 and 2 now if you exit plan mode. Otherwise LGTM.\n\nWhat is wrong with it: no severities, no `path:line`, no quoted evidence, no standard cited; finding 1 is the documented TEACHING-DEFECT(perf-n+1) reported as new; it offers to edit; it ends with LGTM, which review-standards forbids.\n\nRun 2 (anatomy), excerpt:\n\n| element | prompt says | gap | Claude Code |\n|---|---|---|---|\n| tools | nothing | inherits every session tool incl. Edit | `tools: Read, Grep, Glob, Bash` |\n| inputs | \"my latest changes\" | subagent has no chat history | task message must name the base ref |\n| failure handling | \"reply LGTM\" | only a success exit | `maxTurns`; otherwise convention |\n| handoffs | \"LGTM\" | nothing reusable | convention (handoff file) |",
   "testCases": [
    {"name": "All twelve elements present", "input": "grep -cE '^\\| (1[0-2]|[1-9]) \\|' AI-SDLC/docs/foundations/anatomy-breakdown-reviewer.md", "expected": "12"},
    {"name": "Every row says mechanism or convention", "input": "grep -E '^\\| [0-9]+ \\|' AI-SDLC/docs/foundations/anatomy-breakdown-reviewer.md | grep -vcE 'Mechanism:|Convention:'", "expected": "0 (every row names one or the other)"},
    {"name": "Real subagent fields, no invented ones", "input": "grep -oE '`(tools|disallowedTools|permissionMode|maxTurns|memory|skills|description)' AI-SDLC/docs/foundations/anatomy-breakdown-reviewer.md | sort -u | wc -l", "expected": "7 (and `grep -E 'temperature|allowed-tools|timeout' ` on the file prints nothing)"},
    {"name": "Approval-by-LGTM is caught", "input": "grep -n 'LGTM' AI-SDLC/docs/foundations/anatomy-breakdown-reviewer.md", "expected": "At least one row (failure handling or handoffs) explains that LGTM reads as approval, which context/standards/review-standards.md forbids."},
    {"name": "Run 1 shows the teaching defect misreported", "input": "The first exampleInput command", "expected": "The raw prompt reports the `lastN` loop at ObservationService.java line 69 as a new finding without referencing sample-app/docs/KNOWN_DEFECTS.md; your breakdown lists this under boundaries or context."}
   ],
   "evaluationCriteria": [
    "Every one of the twelve elements has a concrete gap, quoted from the prompt where it says anything.",
    "The Claude Code column uses only fields and settings from build/CLAUDE_CODE_FACTS.md (no `temperature`, no hyphenated `allowed-tools` in an agent).",
    "Conventions are labelled as conventions, not dressed up as mechanisms.",
    "The breakdown identifies that \"Fix anything obvious\" merges two responsibilities and grants write authority.",
    "Inputs are rewritten in terms a subagent with no chat history can act on (base ref, run id)."
   ],
   "improvements": [
    "Repeat the breakdown for a one-off security prompt and compare which elements are mechanisms for `security` versus `reviewer`.",
    "Add a thirteenth column: which later module turns each convention into a mechanism.",
    "Run the raw prompt three times and record how many findings differ between runs; that variance is the argument for a fixed output format."
   ]},
  {"id": "01-classify-primitives",
   "title": "Classify ten SDLC needs into prompt, skill, agent, workflow, MCP or hook",
   "objective": "For ten real needs from this repository's SDLC, choose the one primitive that fits and justify it in one sentence. Grade yourself with a script against the answer key, then read the justification for anything you missed. The point is the decision order: enforcement first, external systems second, orchestration third, isolation fourth, reuse fifth.",
   "startingFiles": [
    {"path": "AI-SDLC/docs/foundations/my-classification.json", "content": json.dumps(blank, indent=2) + "\n"}
   ],
   "requiredStructure": "AI-SDLC/docs/foundations/\n├── my-classification.json          # you fill: answer = prompt|skill|agent|workflow|mcp|hook, why = one sentence\n├── classification-answer-key.md    # key: table N01..N10 with answer, accepted, justification, repo example\n├── grade-classification.mjs        # zero-dependency grader, exit 0 at >= 8/10\n└── example-answers.json            # a realistic attempt with two mistakes",
   "implementation": [
    {"path": "AI-SDLC/docs/foundations/classification-answer-key.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/foundations/grade-classification.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/foundations/example-answers.json", "language": "json", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode docs/foundations/grade-classification.mjs docs/foundations/example-answers.json",
   "expectedOutput": "N01  CORRECT  given=hook     key=hook\nN02  CORRECT  given=prompt   key=prompt\nN03  CORRECT  given=skill    key=skill\nN04  WRONG    given=skill    key=agent  -> Needs isolation (fresh context, no author bias) and a tool boundary (`tools: Read, Grep, Glob, Bash`). Only a subagent gives both.\nN05  CORRECT  given=workflow key=workflow\nN06  CORRECT  given=mcp      key=mcp\nN07  CORRECT  given=skill    key=skill\nN08  WRONG    given=agent    key=hook  -> Enforcement at a lifecycle event: a `SubagentStop` hook that exits 2 forces the agent to continue. Asking nicely in the prompt is not a control.\nN09  ACCEPTED given=skill    key=agent  (alternative answer: check the justification names the agent it runs in)\nN10  CORRECT  given=mcp      key=mcp\nSCORE 8/10 (pass mark 8) PASS",
   "testCases": [
    {"name": "Grader passes the example attempt", "input": "node docs/foundations/grade-classification.mjs docs/foundations/example-answers.json; echo $?", "expected": "Last two lines: `SCORE 8/10 (pass mark 8) PASS` and `0`"},
    {"name": "Stricter pass mark fails it", "input": "node docs/foundations/grade-classification.mjs docs/foundations/example-answers.json --pass 9; echo $?", "expected": "`SCORE 8/10 (pass mark 9) FAIL` then `1`"},
    {"name": "Blank starting file scores zero", "input": "node docs/foundations/grade-classification.mjs docs/foundations/my-classification.json (before filling it in)", "expected": "Ten lines with `MISSING`, then `SCORE 0/10 (pass mark 8) FAIL`, exit code 1"},
    {"name": "Key examples point at real files", "input": "test -f .claude/hooks/block-secrets.mjs && grep -c 'block-secrets.mjs' docs/foundations/classification-answer-key.md", "expected": "At least 1: the N01 example is the hook that exists in the repo today."},
    {"name": "Unit tests for the grader and key", "input": "node --test docs/foundations/foundations.test.mjs", "expected": "`# pass 14` and `# fail 0`"}
   ],
   "evaluationCriteria": [
    "Score at least 8/10 with the grader.",
    "Each justification names the property that decided it (enforcement, external system, gates, isolation, reuse), not just the primitive's name.",
    "N01 and N08 are recognised as enforcement problems, not instruction problems.",
    "For N09, an answer of `skill` explicitly says the skill runs inside the `sre` agent's tool boundary.",
    "No answer uses a primitive outside the six (a permission rule is noted as part of the hook answer, not as a seventh category)."
   ],
   "improvements": [
    "Add five needs from your own team's backlog to the key, with a justification each, and have a colleague grade themselves.",
    "Extend the grader to fail an answer whose `why` does not contain one of the decision-order keywords.",
    "Ask Claude to classify the same ten needs with `claude -p` and grade its answers; note where it picks `agent` for enforcement problems."
   ]},
  {"id": "01-contract-validate",
   "title": "Write the reviewer Agent Contract and validate it",
   "objective": "Copy `agents/CONTRACT_TEMPLATE.md`, fill all eleven fields for the `reviewer` roster agent, tag every must and mustNot rule as mechanism or convention, and make `validate-contract.mjs` exit 0. Then export it as the JSON `agentContracts` entry. Module 05-agent-roster finalises this draft as `agents/reviewer/CONTRACT.md`.",
   "startingFiles": [
    {"path": "AI-SDLC/docs/foundations/reviewer-contract-draft.md", "content": f("AI-SDLC/agents/CONTRACT_TEMPLATE.md")}
   ],
   "requiredStructure": "AI-SDLC/\n├── agents/\n│   └── CONTRACT_TEMPLATE.md               # 11 \"## field\" headings = build/schema.json agentContracts\n└── docs/foundations/\n    ├── reviewer-contract-draft.md         # you fill (starts as a copy of the template)\n    ├── validate-contract.mjs              # zero-dependency validator, exit 0 / 1 / 2\n    └── foundations.test.mjs               # node --test suite for the validator and grader",
   "implementation": [
    {"path": "AI-SDLC/agents/CONTRACT_TEMPLATE.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/foundations/reviewer-contract-draft.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/foundations/validate-contract.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/foundations/foundations.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode docs/foundations/validate-contract.mjs --template agents/CONTRACT_TEMPLATE.md\nnode docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-draft.md   # first attempt\n# fix the reported lines, then:\nnode docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-draft.md\nnode docs/foundations/validate-contract.mjs --json docs/foundations/reviewer-contract-draft.md | jq '{agent, tools, humanGate}'",
   "expectedOutput": "OK    agents/CONTRACT_TEMPLATE.md: 11/11 contract sections (template mode)\n\nFirst attempt (tool name invented, one must rule untagged, gate with no mechanism):\nFAIL  docs/foundations/reviewer-contract-draft.md: tools: \"CodeSearch\" is not a Claude Code tool name\nFAIL  docs/foundations/reviewer-contract-draft.md: must[3]: must end with [mechanism: ...] or [convention: ...]\nFAIL  docs/foundations/reviewer-contract-draft.md: humanGate: name the real mechanism (plan mode, a permission ask rule, PR approval, or a hook that exits 2)\n\nAfter fixing:\nOK    docs/foundations/reviewer-contract-draft.md: 11/11 contract sections\n{\n  \"agent\": \"reviewer\",\n  \"tools\": [\"Read\", \"Grep\", \"Glob\", \"Bash (only `git diff`, `git log`, `git status`)\"],\n  \"humanGate\": \"The reviewer is advisory; the gate is the human pull-request approval. Any `critical` or `high` finding blocks merge (review-standards), ...\"\n}",
   "testCases": [
    {"name": "Filled contract validates", "input": "node docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-draft.md; echo $?", "expected": "`OK    docs/foundations/reviewer-contract-draft.md: 11/11 contract sections` then `0`"},
    {"name": "Unfilled template is rejected", "input": "node docs/foundations/validate-contract.mjs agents/CONTRACT_TEMPLATE.md; echo $?", "expected": "`FAIL ... agent \"<agent-name>\" is not in the roster` plus one `unreplaced <placeholder> text` line per section, then `1`"},
    {"name": "Template headings match the schema", "input": "grep -E '^## ' agents/CONTRACT_TEMPLATE.md | sed 's/## //' | paste -sd, -", "expected": "purpose,inputs,outputs,tools,permissions,must,mustNot,failureConditions,validation,handoffFormat,humanGate"},
    {"name": "Every must/mustNot rule names its enforcement", "input": "awk '/^## must$/,/^## failureConditions$/' docs/foundations/reviewer-contract-draft.md | grep '^- ' | grep -vcE '\\[(mechanism|convention):'", "expected": "0"},
    {"name": "Boundaries are mechanisms, not only conventions", "input": "awk '/^## mustNot$/,/^## failureConditions$/' docs/foundations/reviewer-contract-draft.md | grep -c '\\[mechanism:'", "expected": "3 (no Edit/Write, no Agent, Bash limited to git)"},
    {"name": "Unit tests", "input": "node --test docs/foundations/foundations.test.mjs", "expected": "`# tests 14`, `# pass 14`, `# fail 0`"}
   ],
   "evaluationCriteria": [
    "All eleven fields filled; `validate-contract.mjs` exits 0 with no warnings.",
    "`tools` and `permissions` agree: nothing in permissions grants a tool that `tools` omits.",
    "At least the no-edit and no-delegation rules are enforced by mechanism (`tools`, `disallowedTools`), not by instruction.",
    "The `permissionMode` caveat (ignored under `acceptEdits`, `auto`, `bypassPermissions` parents) is acknowledged with a backstop.",
    "`failureConditions` cover empty diff, oversized diff, missing inputs, and a request to fix code.",
    "`humanGate` names a real mechanism (PR approval, `ask` rule) and states that the reviewer never gives merge approval (its `APPROVE` verdict only means no blocking findings)."
   ],
   "improvements": [
    "Fill the template for `tester` next; its `tools` include Edit and Write, so its `mustNot` must restrict *where* it writes (tests only) and say whether that is a mechanism or a convention.",
    "Add a `--frontmatter` mode that prints the matching `.claude/agents/reviewer.md` frontmatter (`name`, `description`, `tools`, `disallowedTools`, `permissionMode`) from the contract, and diff it against the real file in module 05.",
    "Run the validator over `agents/*/CONTRACT.md` in CI once module 05 has written them."
   ]}
 ],
 "agentContracts": [reviewer_contract],
 "checklist": [
  "You can state, for a given job, whether it needs a different context, different tools or different authority, and therefore whether it is an agent.",
  "`docs/foundations/anatomy-breakdown-reviewer.md` has twelve rows, each ending in Mechanism: or Convention:.",
  "Every Claude Code field you cite exists in `build/CLAUDE_CODE_FACTS.md` (agent fields camelCase, skill fields hyphenated).",
  "`node docs/foundations/grade-classification.mjs` scores your classification at 8/10 or better.",
  "`agents/CONTRACT_TEMPLATE.md` has the eleven `## field` headings in schema order and passes `--template` validation.",
  "`docs/foundations/reviewer-contract-draft.md` passes `validate-contract.mjs` with exit code 0.",
  "Every `must` and `mustNot` rule in the reviewer draft is tagged `[mechanism: ...]` or `[convention: ...]`.",
  "The reviewer draft omits `Agent`, `Edit` and `Write` from `tools`, and says why.",
  "The `humanGate` field names a real mechanism, not \"someone looks at it\".",
  "`node --test docs/foundations/foundations.test.mjs` reports 14 passing tests.",
  "You know which parts of the reviewer contract module 05-agent-roster will finalise, and which module 09 will measure."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/01-foundations.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
