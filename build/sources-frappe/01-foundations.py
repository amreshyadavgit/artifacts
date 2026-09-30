# Generator for content-frappe/modules/01-foundations.json (Frappe edition).
# Run: python3 build/sources-frappe/01-foundations.py
import json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()
R = "AI-SDLC-frappe/"
FD = R + "docs/foundations/"

# The module's agentContracts entry is produced from the worked draft by the validator itself,
# so the markdown contract and the JSON entry cannot drift apart.
reviewer_contract = json.loads(subprocess.run(
    ["node", "docs/foundations/validate-contract.mjs", "--json", "docs/foundations/reviewer-contract-draft.md"],
    cwd=ROOT / "AI-SDLC-frappe", check=True, capture_output=True, text=True).stdout)

# Real validator output on the shipped first attempt, so expectedOutput is what the learner sees.
first = subprocess.run(
    ["node", "docs/foundations/validate-contract.mjs", "docs/foundations/reviewer-contract-first-attempt.md"],
    cwd=ROOT / "AI-SDLC-frappe", capture_output=True, text=True)
assert first.returncode == 1, first
first_out = first.stderr.strip()

# Real grader output on the example attempt.
graded = subprocess.run(
    ["node", "docs/foundations/grade-classification.mjs", "docs/foundations/example-answers.json"],
    cwd=ROOT / "AI-SDLC-frappe", capture_output=True, text=True)
assert graded.returncode == 0, graded
graded_out = graded.stdout.strip()

# Starting file for exercise 01-classify-primitives: every need from the answer key, answers blank.
needs = []
for line in f(FD + "classification-answer-key.md").splitlines():
    if line.startswith("| N") and line[3:5].isdigit():
        cells = [c.strip() for c in line.strip("|").split(" | ")]
        needs.append((cells[0], cells[1].replace("\\|", "|")))
assert len(needs) == 12, needs
blank = {i: {"need": n, "answer": "", "why": ""} for i, n in needs}

mod = {
 "id": "01-foundations",
 "level": 1,
 "title": "Foundations: Agent Anatomy, Primitives and the Agent Contract on a Frappe Team",
 "summary": "Learn what separates an agent from a prompt or a template, take an agent apart into twelve anatomy elements and map each one to the Claude Code mechanism that implements it (or admit it is only a convention), map those elements onto who reviews DocType JSON, patches and fixtures on a Frappe team today, choose correctly between prompt, skill, agent, workflow, MCP server, Claude Code hook and Frappe hook, and write your first Agent Contract for the spice_lite reviewer, checked by a validator you run.",
 "prerequisites": ["00-example", "Node 22 (`node --version`)", "Claude Code CLI installed and authenticated (`claude --version`)", "A bench with `spice_lite` installed on `test.localhost` (`sample-app/scripts/setup-bench.sh`)", "Comfort reading a Frappe whitelisted method and a DocType JSON file"],
 "concepts": [
  {"heading": "Prompt, template, agent: what actually differs",
   "body_md": """A **prompt** is one instruction inside the conversation you are already in. It borrows everything from that conversation: its history, its tools, its permission mode, and your attention to check the answer. A **template** is a prompt you saved so you can paste it again. In Claude Code the saved, versioned form of a template is a **skill** (`.claude/skills/<name>/SKILL.md`): same idea, plus supporting files, arguments (`$ARGUMENTS`, `$0` for the first one) and an optional `/name` entry point.

An **agent** (a Claude Code subagent, `.claude/agents/<name>.md`) is different in kind, not in wording. Per `build/CLAUDE_CODE_FACTS.md` §1 it has:

- **its own context window**: it starts with its file body as system prompt, the task message, the CLAUDE.md hierarchy, git status and any preloaded `skills`. It does **not** get your conversation history, the Claude Code system prompt, your output style or auto memory;
- **its own tool boundary**: `tools` is an allowlist, `disallowedTools` a denylist;
- **its own authority**: `permissionMode`, `maxTurns`, `model`, optional `memory`, `hooks` and `isolation: worktree`;
- **a loop**: it keeps calling tools until it decides it is done, then returns **one final message** to the main session.

So the practical test is not "is the prompt long". It is: *does this job need a different context, different tools, or different authority from the conversation that asks for it?* On a bench the answer is often yes. The session that just wrote a new field into `sl_patient.json` is not an independent reviewer of that JSON. A reviewer that holds `Edit` can quietly "fix" the `permissions` array it was asked to judge. A session that may run `bench --site test.localhost console` holds an IPython shell with full database access (FRAPPE_FACTS §10). Those are problems a better prompt cannot solve and a subagent definition can.

The cost is real too: a subagent re-reads `fhir.py` and the DocType JSON that the main session already knows, and whatever you forget to put in its task message (the base ref, the run id) it simply does not have. So in practice you promote a prompt to an agent only when isolation, a tool boundary or a repeatable independent opinion is worth that cost."""},
  {"heading": "Agent anatomy: twelve elements",
   "body_md": """Every agent in this course is specified with the same twelve elements. Most failures of "it worked once in chat" prompts come from leaving one of them implicit.

1. **Responsibilities**: the one job. Two jobs (review *and* fix, or review *and* migrate) means two agents.
2. **Boundaries**: what is out of scope, even if the agent could do it.
3. **Inputs**: exactly what arrives in the task message (base ref, run id, handoff path). A subagent has nothing else from you.
4. **Outputs**: the artifact and its format, precise enough for a script to check.
5. **Tools**: the allowlist, spelled as Claude Code spells tools (`Read`, `Grep`, `Glob`, `Bash`, `mcp__server__tool`), with the Bash scope written out (`git diff` only; `bench --site test.localhost run-tests` only).
6. **Context**: which project knowledge it loads automatically (CLAUDE.md, path-scoped `.claude/rules/`, preloaded skills) and which files it must `Read` for this task (`context/standards/frappe-coding-standards.md`).
7. **Instructions**: the procedure, not a persona. "You are a senior Frappe developer" is not a step.
8. **Memory/state**: what survives between runs (the `memory` field, or handoff files) and what deliberately does not.
9. **Permissions**: what it may do without asking, what needs a human (`bench --site * migrate`), what is denied (`Read(**/site_config.json)`, `bench drop-site`).
10. **Verification**: how anyone can tell a good output from a plausible one.
11. **Failure handling**: what it does when the input is bad or the job is too big, instead of guessing.
12. **Handoffs**: the structured artifact the next step consumes.

The table *Anatomy element to Claude Code mechanism* below maps each element to the real configuration that implements it. The pattern to notice: elements 1, 5, 6, 7, 8 and 9 have first-class Claude Code fields; elements 2, 3, 4, 10, 11 and 12 are mostly **conventions** until you add a Claude Code hook, a permission rule or an eval that enforces them. Modules 05, 08, 09 and 10 exist largely to turn those conventions into mechanisms.

Exercise `01-anatomy-breakdown` applies this list to a real one-off review prompt against `spice_lite/api/fhir.py` and shows which elements it leaves undefined."""},
  {"heading": "Anatomy on a Frappe team: who reviews DocType JSON, patches and fixtures",
   "body_md": """Before you design agents, write down who does the work today. On a Frappe team modelled on `spice_next_core` a change is rarely only Python, and the review is spread over people:

- **The core maintainer** reads the DocType JSON diff: a new field without `search_index`, an `autoname` that would name documents by MRN, a widened `permissions` array. Review-standards makes a schema change without a patch, or a permissions change without security review, at least `high`.
- **Whoever owns releases** reads `patches.txt`: is the new patch in `[pre_model_sync]` or `[post_model_sync]`, is it idempotent, and did anyone edit an existing line? Patch Log records the exact line text, so an edited comment makes the patch run again on every country site (FRAPPE_FACTS §11).
- **The country lead** reads fixtures: Custom Field and Property Setter fixtures belong in the country app, not in `spice_lite` (frappe-coding-standards rule 12). Fixtures are overwritten on every migrate, so a stray one wins silently.
- **Someone with site access** runs `bench --site <site> migrate` on the shared site, after merge.

Each of those people is an implicit agent with implicit anatomy: a **responsibility** (the JSON, the patch order), a **context** (they know that `frappe.get_all` skips permissions), a **permission** (only one of them may migrate), and a **human gate** (the PR approval). Turning them into agents means writing those down:

- the `reviewer` gets the DocType JSON, `patches.txt`, `hooks.py` and fixture checks as **must** rules, and `.claude/rules/doctype-json.md` supplies that context when Claude works with those files (a path-scoped rule; the docs do not say whether a subagent's reads trigger it, so the agent body also names the file to Read);
- the `security` agent is the `next` step whenever the `permissions` array, a `@frappe.whitelist` decorator or `ignore_permissions` changes, which is a **failure condition** of the reviewer;
- `migrate` stays with a person: an `ask` rule in `.claude/settings.json` and CLAUDE.md rule 9 make it a **human gate**, not a tool of any agent.

The comparison table *Frappe review surface to agent anatomy* below lists each surface. So in practice the first draft of an Agent Contract is an interview with the people who review your DocType JSON today."""},
  {"heading": "Mechanism or convention: enforced versus requested",
   "body_md": """Module 00 stated the rule: **instructions describe intent, permissions and Claude Code hooks enforce it.** This module makes it a habit: every rule you write for an agent gets labelled as one or the other.

A **mechanism** is something Claude Code itself does regardless of what the model decides:

- `tools: Read, Grep, Glob` means `Edit` is not in the agent's toolset. It cannot be talked into editing `sl_patient.json`.
- `permissions.deny: ["Read(**/site_config.json)"]` in `.claude/settings.json` blocks the read for every agent.
- `permissionMode: dontAsk` auto-denies anything that would prompt. In this repo `bench --site * console`, `execute` and `migrate` are `ask` rules, so a `dontAsk` reviewer is refused them instead of a human being asked.
- `.claude/hooks/block-secrets.mjs` is a Claude Code `PreToolUse` hook on `Edit|Write`; it exits **2**, which blocks the call. Exit 1 would not block. Settings hooks fire inside subagents too.

A **convention** is something only a person, a script or an eval checks: the six-field finding format, "cite the standard", "never write LGTM", "review `patches.txt` with the JSON", the handoff front matter until module 08 adds `check-handoff.mjs`.

Conventions are not bad; most of a contract is convention. The failure mode is believing a convention is a mechanism. Three real traps:

- `dontAsk` denies only what would prompt. `Bash(bench --site test.localhost run-tests *)` is on the project **allow** list, so a `dontAsk` reviewer can still run the test suite. Restricting it to git needs an agent-scoped Claude Code `PreToolUse` hook (module 05).
- A subagent's `permissionMode` is **ignored** when the parent session runs in `bypassPermissions`, `acceptEdits` or `auto`. The same Claude Code hook is the durable guard.
- Skill `allowed-tools` **pre-approves** tools for the turn; it does not restrict them. Use `disallowed-tools` to remove one.

So in practice, each `must` and `mustNot` line in an Agent Contract ends with `[mechanism: ...]` or `[convention: ...]`, and `validate-contract.mjs` rejects a line that has neither. When a `mustNot` has only conventions, the validator warns you: that agent's boundaries depend entirely on the model behaving."""},
  {"heading": "Six Claude Code primitives, one Frappe hook, and how to choose",
   "body_md": """Claude Code gives you six building blocks for SDLC automation: **prompt, skill, agent, workflow, MCP server, Claude Code hook**. A Frappe team has a seventh thing called a hook that is not a Claude Code primitive at all: a **Frappe hook**, an entry in an app's `hooks.py` (`doc_events`, `scheduler_events`, `permission_query_conditions`, `fixtures`, `after_migrate`, ...). It is product code that runs inside the site, when a clinician saves a form or the scheduler ticks. A Claude Code hook runs on the developer's machine, when Claude calls a tool.

The collision is not academic. A ticket that says "add a hook that blocks secrets" can end up as a `doc_events` entry in `hooks.py`; "run a hook when an Observation is finalised" can end up as a `PostToolUse` entry in `settings.json` that fires when Claude writes a file. That is why CLAUDE.md rule 5 bans the bare word, the validator warns on it, and the grader in exercise `01-classify-primitives` scores a bare `hook` as `AMBIGUOUS`.

Use this decision order; the first "yes" wins (it is also the answer key logic):

0. **Is it behaviour of the running app on a site?** It is a **Frappe hook** or a controller method, and it ships through the normal workflow like any code change.
1. **Must it happen every time Claude acts**, whether or not the model remembers? Use a **Claude Code hook** (or a permission rule): secrets scanning, handoff validation, blocking edits to an applied line of `patches.txt`.
2. **Does it need data or actions outside the repo** (Jira, GitHub, the Frappe REST API of a site)? Use an **MCP server**, so access is a named tool (`mcp__<server>__<tool>`) that permission rules can allow or deny.
3. **Does it chain several roles with human gates** between them? Use a **workflow** in `workflows/`, run from the main session (module 08).
4. **Does it need its own context, its own tool limits, or an independent opinion?** Use an **agent**.
5. **Will the same procedure be repeated** by people or agents? Use a **skill**. Agents preload skills with the `skills` field.
6. Otherwise it is a **prompt**.

Two combinations recur: **agent + preloaded skill** (`reviewer` preloads `code-review`; `sre` preloads `production-rca`) and **workflow + Claude Code hooks** (the workflow defines order and gates; the Claude Code hooks make the gates real)."""},
  {"heading": "The Agent Contract",
   "body_md": """An **Agent Contract** is this course's specification for an agent, written before the agent file and kept next to it. It is a convention, not a Claude Code feature: Claude Code only reads `.claude/agents/<name>.md`. The contract is what that file is reviewed against, what the evals in module 09 score, and what a new team member reads first.

Eleven fields, identical to `agentContracts` in `build/schema.json`:

| Field | Question it answers |
|---|---|
| `purpose` | What single decision does the output support? |
| `inputs` / `outputs` | What arrives in the task message; what comes back and where it is saved |
| `tools` | Exact tool names, with scope ("Bash (only `git diff`, `git log`, `git status`)") |
| `permissions` | Which frontmatter and settings enforce the boundary |
| `must` / `mustNot` | Required and forbidden behaviour, each tagged mechanism or convention |
| `failureConditions` | When to stop with `blocked` or `needs-human` instead of guessing |
| `validation` | The command, eval or check that proves an output acceptable |
| `handoffFormat` | The run-folder file and its front matter |
| `humanGate` | Where a person approves, and the real mechanism that waits for them |

The reusable template is `AI-SDLC-frappe/agents/CONTRACT_TEMPLATE.md`; each roster agent's filled copy lives at `AI-SDLC-frappe/agents/<agent>/CONTRACT.md`. `AI-SDLC-frappe/docs/foundations/validate-contract.mjs` checks that all eleven `## field` headings are present and in order, that list fields are bullets, that tool names are real Claude Code tools, that every `must`/`mustNot` line names its enforcement, that `humanGate` names a real mechanism, and two Frappe rules: a Bash scope may not grant `bench console`, `execute`, `drop-site` or `reinstall`, and a `migrate` scope must say it sits behind the `ask` rule. A bare "hook" is a warning. `--json` prints the contract as a schema-shaped object.

This module ships a worked **reviewer** draft (`docs/foundations/reviewer-contract-draft.md`) and a first attempt with five planted mistakes. Module 02 builds a deliberately simple first reviewer, module 05-agent-roster finalises this contract as `agents/reviewer/CONTRACT.md` with the runtime definition, and module 09 measures the agent against it. So in practice the contract changes through review like code, and the agent file follows it."""},
  {"heading": "Handoffs and depth: why the roster stays flat",
   "body_md": """Agents in this course never talk to each other directly. Each one returns a **handoff**: a Markdown document with YAML front matter (`run_id`, `step`, `agent`, `status`, `inputs`, `next`) saved under `.ai-sdlc/runs/<run-id>/NN-<agent>.md`. The next agent reads the file, not the previous agent's conversation, because it has none.

Claude Code does allow deeper structures: per the current docs a subagent **can** spawn subagents of its own, and an `Agent(...)` type allowlist is only enforced for an agent running as the main thread. The exact limits and settings are taught in module 07-agent-composition.

This course's design decision built on those facts:

- The **orchestrator** runs as the main thread (`claude --agent orchestrator`, or the `/feature` skill in the main session). It is the only place delegation happens.
- Roster agents (`architect`, `developer`, `reviewer`, `tester`, `security`, `sre`) do **not** list `Agent` in `tools`. They run at depth 1, so every delegation is visible in one place and every handoff is a file you can audit.

On a Frappe change the flat chain has a concrete payoff. A feature that touches `sl_observation.json`, the controller, a patch and the tests produces, in order, a developer handoff, a reviewer handoff whose `next` is `security` because the `permissions` array changed, and a tester handoff with the `bench --site test.localhost run-tests` result. A human reads three files and decides; nobody has to reconstruct which nested agent ran `migrate`, because no agent can.

For the anatomy that means element 12 (handoffs) and element 2 (boundaries) meet: leaving `Agent` out of `tools` is a mechanism that keeps the handoff chain linear. The reviewer draft's `mustNot` records it as exactly that."""}
 ],
 "diagrams": [
  {"title": "Contract fields and the Claude Code mechanisms behind them",
   "mermaid": "flowchart LR\n  P[\"purpose\"] --> D[\"description field + agent file body\"]\n  I[\"inputs\"] --> TM[\"Agent tool prompt (task message)\"]\n  T[\"tools\"] --> TL[\"tools / disallowedTools\"]\n  PM[\"permissions\"] --> PS[\"permissionMode + settings allow/ask/deny (bench migrate = ask)\"]\n  MN[\"must / mustNot\"] --> HK[\"Claude Code hooks (exit 2 blocks)\"]\n  MN -.->|\"when not enforceable\"| CV[\"convention: evals, human review\"]\n  F[\"failureConditions\"] --> MT[\"maxTurns + status: blocked\"]\n  V[\"validation\"] --> EV[\"scripts, golden tasks, SubagentStop Claude Code hook\"]\n  H[\"handoffFormat\"] --> RF[\"file in .ai-sdlc/runs/RUN-ID/\"]\n  G[\"humanGate\"] --> HG[\"plan mode, ask rule, PR approval\"]"},
  {"title": "Choosing a primitive (first yes wins)",
   "mermaid": "flowchart TD\n  Q0{\"Runtime behaviour of the app on a site?\"} -->|\"yes\"| FH[\"Frappe hook in hooks.py or a controller method\"]\n  Q0 -->|\"no\"| Q1{\"Must it happen every time Claude acts?\"}\n  Q1 -->|\"yes\"| HOOK[\"Claude Code hook or permission rule\"]\n  Q1 -->|\"no\"| Q2{\"Needs a system outside the repo?\"}\n  Q2 -->|\"yes\"| MCP[\"MCP server\"]\n  Q2 -->|\"no\"| Q3{\"Several roles with human gates?\"}\n  Q3 -->|\"yes\"| WF[\"workflow\"]\n  Q3 -->|\"no\"| Q4{\"Own context, tool limits or independent opinion?\"}\n  Q4 -->|\"yes\"| AG[\"agent\"]\n  Q4 -->|\"no\"| Q5{\"Repeated procedure?\"}\n  Q5 -->|\"yes\"| SK[\"skill\"]\n  Q5 -->|\"no\"| PR[\"prompt\"]"},
  {"title": "A reviewer run on a Frappe change under its contract",
   "mermaid": "sequenceDiagram\n  participant H as Human\n  participant M as Main session (orchestrator)\n  participant R as reviewer subagent\n  participant F as Run folder .ai-sdlc/runs/RUN-ID\n  H->>M: Review the change against main\n  M->>R: Task message with base ref, run id and upstream handoff path\n  R->>R: git diff main...HEAD, including DocType JSON, patches.txt, hooks.py\n  R->>R: Read frappe-coding-standards (no Edit, no Agent, no bench)\n  R-->>M: Final message is the handoff, next is security if permissions changed\n  M->>F: Write NN-reviewer.md\n  M-->>H: status needs-human if any critical or high finding\n  H->>H: Approve the PR, then run bench migrate on the shared site"}
 ],
 "comparisonTables": [
  {"title": "Prompt, skill, agent, workflow, MCP, Claude Code hook, Frappe hook",
   "columns": ["Primitive", "Purpose", "Where it lives", "Who triggers it", "Determinism", "Example in this repo"],
   "rows": [
    ["Prompt", "One-off instruction in the current conversation", "Nowhere (typed, or `claude -p \"...\"`)", "You", "Low: model output, shares the session's history and tools", "`claude -p \"Which tests call spice_lite.api.fhir.lastn?\" --permission-mode plan`"],
    ["Skill", "Reusable procedure plus supporting files", "`.claude/skills/<name>/SKILL.md`", "You via `/name`, Claude by `description` match, or preloaded into an agent via `skills`", "Medium: loading and `!` shell injection are deterministic; execution is model-driven", "`.claude/skills/run-tests/SKILL.md` wrapping `bench --site test.localhost run-tests` (module 02)"],
    ["Agent", "Isolated worker with its own context, tools and permissions", "`.claude/agents/<name>.md`", "Main session delegation (by `description`, by name, `@agent-<name>`) or `claude --agent <name>`", "Low output determinism, deterministic boundary (`tools`, `disallowedTools`)", "`.claude/agents/reviewer.md` (module 05)"],
    ["Workflow", "Ordered composition of agents, skills and human gates", "`workflows/*.md` spec plus an entry skill such as `/feature`", "You, from the main session", "Order and gates are fixed by the spec and Claude Code hooks; each step is model-driven", "`workflows/feature-delivery.md`: DocType JSON + controller + patch + tests (module 08)"],
    ["MCP server", "Tools and data from a system outside the repo", "`.mcp.json` (project scope) or `~/.claude.json` (local, user)", "Claude calls `mcp__<server>__<tool>` when the task needs it", "The server code is deterministic; whether and how it is called is model-driven", "Read-only, PHI-safe aggregates from the test site in `mcp/` (module 06)"],
    ["Claude Code hook", "Enforce or react at a Claude Code lifecycle event", "`hooks` in `.claude/settings.json` (also agent or skill frontmatter)", "Claude Code itself, on events such as `PreToolUse`, `SubagentStop`", "High: a script; exit code 2 blocks", "`.claude/hooks/block-secrets.mjs` on `Edit|Write` (exists today)"],
    ["Frappe hook (`hooks.py`)", "App behaviour inside a site: document events, scheduled jobs, row permissions, install and migrate steps, fixtures. Not an AI-SDLC primitive; product code that agents review", "`<app>/<app>/hooks.py` (`doc_events`, `scheduler_events`, `permission_query_conditions`, `after_migrate`, ...)", "Frappe, on a document save, a scheduler tick, a request, `bench migrate`", "High: Python in the site; reviewed and tested like any code", "`after_migrate = [\"spice_lite.install.after_migrate\"]` in `spice_lite/hooks.py`"]
   ]},
  {"title": "Anatomy element to Claude Code mechanism",
   "columns": ["Element", "Claude Code mechanism", "Mechanism or convention", "Frappe reviewer example"],
   "rows": [
    ["Responsibilities", "`description` frontmatter (delegation) and file body", "Mechanism for routing; the single-job rule is convention", "\"Reviews a spice_lite diff, DocType JSON included; never edits, never runs bench\""],
    ["Boundaries", "`tools`, `disallowedTools`, `permissions.deny`", "Mechanism where a tool or rule expresses it; otherwise `mustNot` convention", "No Edit, Write or Agent; no `site_config.json` reads"],
    ["Inputs", "Agent tool `prompt` (task message); CLAUDE.md hierarchy; git status", "Mechanism for delivery; required fields are convention", "Base ref, run id, upstream handoff path"],
    ["Outputs", "Subagent final message returned to the main session", "Mechanism for return; format is convention", "Six-field findings table plus a \"Frappe surfaces in this diff\" line"],
    ["Tools", "`tools` allowlist, `disallowedTools`, `mcpServers`", "Mechanism", "`Read, Grep, Glob, Bash` (git only)"],
    ["Context", "CLAUDE.md hierarchy, path-scoped `.claude/rules/`, `skills` preload, `omitClaudeMd`", "Mechanism", "`skills: [code-review]`; `doctype-json.md` rule for DocType JSON"],
    ["Instructions", "Agent file body = the subagent's system prompt", "Mechanism (what the model reads), content is yours", "Step-by-step procedure: Python, then JSON, then `patches.txt`, then `hooks.py`"],
    ["Memory/state", "`memory: user|project|local` (`MEMORY.md`); handoff files", "Mechanism for `memory`; run state in files is convention", "No memory; state in `.ai-sdlc/runs/`"],
    ["Permissions", "`permissionMode`, settings allow/ask/deny, Claude Code hooks", "Mechanism (note: `permissionMode` ignored under `acceptEdits`, `auto`, `bypassPermissions` parents; `dontAsk` still runs allowed rules)", "`permissionMode: dontAsk` + agent-scoped `PreToolUse` Claude Code hook"],
    ["Verification", "`SubagentStop`/`PostToolUse` Claude Code hooks, scripts, evals", "Convention until a Claude Code hook runs the check", "Golden tasks with seeded `get_all` and missing-patch diffs (module 09)"],
    ["Failure handling", "`maxTurns` (output marked partial); `-p` result `subtype`, `is_error`", "Mechanism for limits; `status: blocked` is convention", "Edited line in `patches.txt` returns `needs-human`"],
    ["Handoffs", "None built in", "Convention; made a mechanism by `check-handoff.mjs` (module 08)", "`.ai-sdlc/runs/<run-id>/NN-reviewer.md`"]
   ]},
  {"title": "Frappe review surface to agent anatomy",
   "columns": ["Surface", "Who checks it today", "What they check", "Where it lands in the agent system", "Anatomy element"],
   "rows": [
    ["DocType JSON (`sl_patient.json`, ...)", "Core maintainer", "Patch for data changes, `search_index` on filtered fields, `autoname` not by PHI, `permissions` array", "`reviewer` must rule; `.claude/rules/doctype-json.md`; security as `next` when `permissions` changes", "Responsibilities, context, failure handling"],
    ["`patches.txt` and `patches/`", "Release owner", "Section (`pre_model_sync` / `post_model_sync`), idempotency, no edited existing line", "`reviewer` failure condition (`needs-human`); a `PreToolUse` Claude Code hook can block the edit", "Failure handling, boundaries"],
    ["`hooks.py` (Frappe hooks)", "Core maintainer + architect", "A new `doc_events`, `scheduler_events` or permission key has an ADR", "`architect` ADR (module 05); `reviewer` checks the ADR exists", "Handoffs, context"],
    ["Fixtures (Custom Field, Property Setter)", "Country lead", "Country-specific fixtures live in the country app, not in `spice_lite`", "`reviewer` must rule citing frappe-coding-standards rule 12", "Responsibilities"],
    ["Whitelisted methods (`api/fhir.py`)", "Senior developer + security", "`methods=[...]`, no `allow_guest`, `get_list` not `get_all`, no PHI in `frappe.throw`", "`reviewer` findings; `security` agent for any decorator change", "Responsibilities, handoffs"],
    ["`bench --site <site> migrate` on a shared site", "Person with site access, after merge", "That the merged patches and JSON apply cleanly", "Nobody's tool: `ask` rule in `.claude/settings.json` plus CLAUDE.md rule 9", "Permissions, human gate"]
   ]}
 ],
 "exercises": [
  {"id": "01-anatomy-breakdown",
   "title": "Break a one-off Frappe review prompt into agent anatomy",
   "objective": "Take the review prompt a Frappe developer pastes into chat today (it even asks the model to open `bench console` and run `migrate`), run it once in plan mode against the real `spice_lite/api/fhir.py` and `sl_patient.json`, then break it into the twelve anatomy elements. For each element record what the prompt says, the gap, and the Claude Code mechanism (or convention) that will implement it in the `reviewer` agent. Finish with the Frappe review surfaces the prompt forgot.",
   "startingFiles": [
    {"path": FD + "one-off-review-prompt.md", "content": f(FD + "one-off-review-prompt.md")}
   ],
   "requiredStructure": "AI-SDLC-frappe/docs/foundations/\n├── one-off-review-prompt.md          # given: the prompt as pasted in chat\n└── anatomy-breakdown-reviewer.md     # you write:\n                                      #   12-row table: # | element | what the prompt says | gap or risk | where it lives in Claude Code\n                                      #   (last column starts with \"Mechanism:\" or \"Convention:\")\n                                      #   \"Frappe review surfaces the prompt forgot\" table: DocType JSON, patches.txt, hooks.py, fixtures, whitelisted methods",
   "implementation": [
    {"path": FD + "anatomy-breakdown-reviewer.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\n# 1. Run the one-off prompt as-is (plan mode, so nothing is edited and no bench command runs)\nclaude -p \"$(cat docs/foundations/one-off-review-prompt.md) The changes are in sample-app/spice_lite/spice_lite/api/fhir.py and sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json.\" --permission-mode plan --output-format json | jq -r '.result'\n\n# 2. Ask for the anatomy breakdown, then compare it with your own table\nclaude -p 'Read docs/foundations/one-off-review-prompt.md. For each of these elements: responsibilities, boundaries, inputs, outputs, tools, context, instructions, memory/state, permissions, verification, failure handling, handoffs, give one table row: what the prompt says, the gap, and the Claude Code subagent field or setting that would implement it, or the word convention if none does.' --permission-mode plan --output-format json | jq -r '.result'",
   "expectedOutput": "Run 1 (the raw prompt), typical result:\n\nHere's what I found:\n1. Performance: `lastn()` in fhir.py loops over `subject_list` and calls `frappe.get_doc(\"SL Patient\", s)` and `frappe.get_all(\"SL Observation\", ..., fields=[\"*\"])` per subject, an N+1. I'd batch it with one `frappe.get_list` using `(\"in\", subjects)`.\n2. Security: that `frappe.get_all` skips permission checks on SL Observation.\n3. `create_observation` returns `str(e)` from the ValidationError as the 422 diagnostics.\n4. sl_patient.json: consider `search_index` on `mrn` for identifier searches.\n5. Style: `_iso()` in mappers.py emits datetimes without a timezone offset.\nI'd like to open `bench --site test.localhost console` to check how many observations a patient has, and I can apply fix 1 and run `bench migrate` if you exit plan mode. Otherwise LGTM.\n\nWhat is wrong with it: no severities, no `path:line`, no standard cited; findings 1 and 2 are the documented TEACHING-DEFECT(perf-n+1) and finding 5 is open defect D-3, both reported as new; finding 4 is wrong (`mrn` is `unique: 1`, which already creates an index); it never looks at `patches.txt` or the `permissions` array; it asks for `bench console` and offers to edit and migrate; it ends with LGTM, which review-standards forbids.\n\nRun 2 (anatomy), excerpt:\n\n| element | prompt says | gap | Claude Code |\n|---|---|---|---|\n| tools | \"open bench console\" | IPython with full DB access, plus every session tool incl. Edit | `tools: Read, Grep, Glob, Bash`; console is an `ask` rule |\n| inputs | \"my latest changes\" | subagent has no chat history | task message must name the base ref |\n| permissions | \"run migrate\" | changes a shared site's schema | `permissionMode`, `ask` rule on migrate |\n| handoffs | \"LGTM\" | nothing reusable | convention (handoff file) |",
   "testCases": [
    {"name": "All twelve elements present", "input": "grep -cE '^\\| (1[0-2]|[1-9]) \\|' AI-SDLC-frappe/docs/foundations/anatomy-breakdown-reviewer.md", "expected": "12"},
    {"name": "Every row says mechanism or convention", "input": "grep -E '^\\| [0-9]+ \\|' AI-SDLC-frappe/docs/foundations/anatomy-breakdown-reviewer.md | grep -vcE 'Mechanism:|Convention:'", "expected": "0 (every row names one or the other)"},
    {"name": "Real subagent fields, no invented ones", "input": "grep -oE '`(tools|disallowedTools|permissionMode|maxTurns|memory|skills|description)' AI-SDLC-frappe/docs/foundations/anatomy-breakdown-reviewer.md | sort -u | wc -l; grep -cE 'temperature|allowed-tools|timeout' AI-SDLC-frappe/docs/foundations/anatomy-breakdown-reviewer.md", "expected": "7, then 0"},
    {"name": "The Frappe surfaces are named", "input": "grep -cE '^\\| (DocType JSON|`patches.txt`|`hooks.py`|fixtures|whitelisted methods)' AI-SDLC-frappe/docs/foundations/anatomy-breakdown-reviewer.md", "expected": "5"},
    {"name": "bench console and migrate are caught as tools and permissions gaps", "input": "grep -nE 'bench console|migrate' AI-SDLC-frappe/docs/foundations/anatomy-breakdown-reviewer.md | grep -cE '^[0-9]+:\\| (5|9) \\|'", "expected": "2 (row 5 tools and row 9 permissions)"},
    {"name": "The defect the raw prompt reports as new is already pinned", "input": "cd /home/user/frappe-bench && bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_lastn_query_count_grows_with_subjects", "expected": "Ran 1 test ... OK. The N+1 at `api/fhir.py` lines 155-182 is TEACHING-DEFECT(perf-n+1), documented in sample-app/docs/KNOWN_DEFECTS.md; your breakdown lists the prompt's ignorance of that file under context."}
   ],
   "evaluationCriteria": [
    "Every one of the twelve elements has a concrete gap, quoted from the prompt where it says anything.",
    "The Claude Code column uses only fields and settings from build/CLAUDE_CODE_FACTS.md (no `temperature`, no hyphenated `allowed-tools` in an agent).",
    "Conventions are labelled as conventions, not dressed up as mechanisms.",
    "The breakdown identifies that \"Fix anything obvious\" and \"run migrate\" add two responsibilities and grant write and site authority.",
    "`bench console` is identified as an arbitrary-code tool that no reviewer holds, with the `ask` rule that already guards it.",
    "The Frappe surfaces table names DocType JSON, `patches.txt`, `hooks.py` and fixtures, and says where each rule comes from."
   ],
   "improvements": [
    "Repeat the breakdown for a one-off security prompt (\"check fhir.py for permission problems\") and compare which elements are mechanisms for `security` versus `reviewer`.",
    "Add a column: which later module turns each convention into a mechanism.",
    "Run the raw prompt three times and record how many findings differ between runs; that variance is the argument for a fixed output format."
   ]},
  {"id": "01-classify-primitives",
   "title": "Classify twelve needs into a Claude Code primitive or a Frappe hook",
   "objective": "For twelve real needs from a Frappe team's SDLC, choose the one answer that fits (`prompt`, `skill`, `agent`, `workflow`, `mcp`, `claude-code-hook`, or `frappe-hook`) and justify it in one sentence. Grade yourself with a script against the answer key, then read the justification for anything you missed. Two needs are traps built on the word \"hook\"; a bare `hook` scores zero.",
   "startingFiles": [
    {"path": FD + "my-classification.json", "content": json.dumps(blank, indent=2) + "\n"}
   ],
   "requiredStructure": "AI-SDLC-frappe/docs/foundations/\n├── my-classification.json          # you fill: answer = prompt|skill|agent|workflow|mcp|claude-code-hook|frappe-hook, why = one sentence\n├── classification-answer-key.md    # key: table N01..N12 with answer, accepted, justification, repo example\n├── grade-classification.mjs        # zero-dependency grader, exit 0 at >= 10/12; bare \"hook\" = AMBIGUOUS\n└── example-answers.json            # a realistic attempt with two mistakes",
   "implementation": [
    {"path": FD + "classification-answer-key.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": FD + "grade-classification.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": FD + "example-answers.json", "language": "json", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\nnode docs/foundations/grade-classification.mjs docs/foundations/example-answers.json",
   "expectedOutput": graded_out,
   "testCases": [
    {"name": "Grader passes the example attempt", "input": "node docs/foundations/grade-classification.mjs docs/foundations/example-answers.json; echo $?", "expected": "Last two lines: `SCORE 10/12 (pass mark 10) PASS` and `0`"},
    {"name": "Stricter pass mark fails it", "input": "node docs/foundations/grade-classification.mjs docs/foundations/example-answers.json --pass 11; echo $?", "expected": "`SCORE 10/12 (pass mark 11) FAIL` then `1`"},
    {"name": "Blank starting file scores zero", "input": "node docs/foundations/grade-classification.mjs docs/foundations/my-classification.json; echo $?   (before filling it in)", "expected": "Twelve lines with `MISSING`, then `SCORE 0/12 (pass mark 10) FAIL`, then `1`"},
    {"name": "A bare hook answer is ambiguous", "input": "echo '{\"N08\":\"hook\"}' > /tmp/h.json && node docs/foundations/grade-classification.mjs /tmp/h.json | grep N08", "expected": "`N08  AMBIGUOUS given=hook ... -> say \"claude-code-hook\" or \"frappe-hook\" (CLAUDE.md rule 5)`"},
    {"name": "Key examples point at real files", "input": "test -f .claude/hooks/block-secrets.mjs && grep -c 'after_migrate' sample-app/spice_lite/spice_lite/hooks.py && grep -c '# doc_events' sample-app/spice_lite/spice_lite/hooks.py", "expected": "1 and 1: the N01 example is the Claude Code hook that exists today, and the N11 Frappe hook example is the commented `doc_events` block in `hooks.py`."},
    {"name": "Unit tests for the grader and key", "input": "node --test docs/foundations/foundations.test.mjs", "expected": "`# tests 16`, `# pass 16`, `# fail 0`"}
   ],
   "evaluationCriteria": [
    "Score at least 10/12 with the grader.",
    "Each justification names the property that decided it (runtime app behaviour, enforcement, external system, gates, isolation, reuse), not just the primitive's name.",
    "N01, N08 and N12 are recognised as enforcement of what Claude does (Claude Code hooks), not instruction problems.",
    "N11 is recognised as a Frappe hook (`doc_events` in a country app) and N12 as a Claude Code hook, with the reason each trap is a trap.",
    "For N09, an answer of `skill` explicitly says the skill runs inside the `sre` agent's tool boundary."
   ],
   "improvements": [
    "Add five needs from your own team's backlog to the key (for example a nightly `scheduler_events` job, or a check that every DocType JSON change has a patch), with a justification each, and have a colleague grade themselves.",
    "Extend the grader to fail an answer whose `why` does not contain one of the decision-order keywords.",
    "Build the N12 guard: a `PreToolUse` Claude Code hook on `Edit` that exits 2 when `old_string` contains an existing non-comment line of `patches.txt`, with a `node --test` suite."
   ]},
  {"id": "01-contract-validate",
   "title": "Write the spice_lite reviewer Agent Contract and validate it",
   "objective": "Copy `agents/CONTRACT_TEMPLATE.md`, fill all eleven fields for the `reviewer` roster agent on `spice_lite`, tag every must and mustNot rule as mechanism or convention, and make `validate-contract.mjs` exit 0 with no warnings. See first what the validator reports on a realistic first attempt (invented tool, `bench console` in scope, untagged rule, bare \"hook\", gate without mechanism). Then export the contract as the JSON `agentContracts` entry. Module 05-agent-roster finalises this draft as `agents/reviewer/CONTRACT.md`.",
   "startingFiles": [
    {"path": FD + "reviewer-contract-draft.md", "content": f(R + "agents/CONTRACT_TEMPLATE.md")}
   ],
   "requiredStructure": "AI-SDLC-frappe/\n├── agents/\n│   └── CONTRACT_TEMPLATE.md               # 11 \"## field\" headings = build/schema.json agentContracts\n└── docs/foundations/\n    ├── reviewer-contract-draft.md         # you fill (starts as a copy of the template)\n    ├── reviewer-contract-first-attempt.md # given: five planted mistakes, do not fix\n    ├── validate-contract.mjs              # zero-dependency validator, exit 0 / 1 / 2, Frappe bench and hook checks\n    └── foundations.test.mjs               # node --test suite for the validator and grader",
   "implementation": [
    {"path": R + "agents/CONTRACT_TEMPLATE.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": FD + "reviewer-contract-draft.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": FD + "reviewer-contract-first-attempt.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": FD + "validate-contract.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": FD + "foundations.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\nnode docs/foundations/validate-contract.mjs --template agents/CONTRACT_TEMPLATE.md\nnode docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-first-attempt.md\n# fix the same mistakes in your own copy, then:\nnode docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-draft.md\nnode docs/foundations/validate-contract.mjs --json docs/foundations/reviewer-contract-draft.md | jq '{agent, tools}'",
   "expectedOutput": "OK    agents/CONTRACT_TEMPLATE.md: 11/11 contract sections (template mode)\n\n" + first_out + "\n\nOK    docs/foundations/reviewer-contract-draft.md: 11/11 contract sections\n" + json.dumps({"agent": reviewer_contract["agent"], "tools": reviewer_contract["tools"]}, indent=2),
   "testCases": [
    {"name": "Filled contract validates with no warnings", "input": "node docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-draft.md; echo $?", "expected": "`OK    docs/foundations/reviewer-contract-draft.md: 11/11 contract sections`, no `WARN` line, then `0`"},
    {"name": "First attempt is rejected for the planted mistakes", "input": "node docs/foundations/validate-contract.mjs docs/foundations/reviewer-contract-first-attempt.md 2>&1 | grep -c '^FAIL'; echo ${PIPESTATUS[0]}", "expected": "4 FAIL lines (DocTypeInspector, bench console, must[4], humanGate) plus one WARN for the bare \"hook\"; exit code 1"},
    {"name": "Unfilled template is rejected", "input": "node docs/foundations/validate-contract.mjs agents/CONTRACT_TEMPLATE.md; echo $?", "expected": "`FAIL ... agent \"<agent-name>\" is not in the roster` plus one `unreplaced <placeholder> text` line per section, then `1`"},
    {"name": "Template headings match the schema", "input": "grep -E '^## ' agents/CONTRACT_TEMPLATE.md | sed 's/## //' | paste -sd, -", "expected": "purpose,inputs,outputs,tools,permissions,must,mustNot,failureConditions,validation,handoffFormat,humanGate"},
    {"name": "Boundaries are mechanisms, not only conventions", "input": "awk '/^## mustNot$/,/^## failureConditions$/' docs/foundations/reviewer-contract-draft.md | grep -c '\\[mechanism:'", "expected": "4 (no Edit/Write, no Agent, Bash limited to git with no bench, no site_config reads)"},
    {"name": "The permissions the contract relies on exist in settings", "input": "node -e 'const s=require(\"./.claude/settings.json\").permissions; console.log(s.ask.includes(\"Bash(bench --site * console)\"), s.deny.includes(\"Read(**/site_config.json)\"), s.allow.includes(\"Bash(git diff *)\"))'", "expected": "true true true"},
    {"name": "Unit tests", "input": "node --test docs/foundations/foundations.test.mjs", "expected": "`# tests 16`, `# pass 16`, `# fail 0`"}
   ],
   "evaluationCriteria": [
    "All eleven fields filled; `validate-contract.mjs` exits 0 with no warnings.",
    "`tools` and `permissions` agree: nothing in permissions grants a tool that `tools` omits, and the Bash scope names no `bench` command.",
    "The no-edit, no-delegation, git-only Bash and no-site_config rules are enforced by mechanism, not by instruction.",
    "The `dontAsk` gap is acknowledged: `bench --site test.localhost run-tests` is on the project allow list, so an agent-scoped Claude Code `PreToolUse` hook is the backstop (and also covers the `permissionMode` caveat under `acceptEdits`, `auto`, `bypassPermissions` parents).",
    "`failureConditions` cover empty diff, oversized diff, missing inputs, a `permissions` or whitelist change (next: security), an edited `patches.txt` line, and a request to fix, test or migrate.",
    "`humanGate` names a real mechanism (PR approval, the `ask` rule on `bench --site * migrate`) and states that the reviewer never gives merge approval."
   ],
   "improvements": [
    "Fill the template for `developer` next; its `tools` include Edit, Write and Bash with `bench --site test.localhost run-tests *`, so its `mustNot` must restrict where it writes and say that `migrate` runs only behind the `ask` rule.",
    "Add a `--frontmatter` mode that prints the matching `.claude/agents/reviewer.md` frontmatter (`name`, `description`, `tools`, `disallowedTools`, `permissionMode`) from the contract, and diff it against the real file in module 05.",
    "Run the validator over `agents/*/CONTRACT.md` in CI once module 05 has written them."
   ]}
 ],
 "agentContracts": [reviewer_contract],
 "checklist": [
  "You can state, for a given job on the bench, whether it needs a different context, different tools or different authority, and therefore whether it is an agent.",
  "`docs/foundations/anatomy-breakdown-reviewer.md` has twelve rows, each ending in Mechanism: or Convention:, and a Frappe surfaces table.",
  "Every Claude Code field you cite exists in `build/CLAUDE_CODE_FACTS.md` (agent fields camelCase, skill fields hyphenated).",
  "You never write a bare \"hook\": it is a Frappe hook in `hooks.py` or a Claude Code hook in `.claude/settings.json`.",
  "`node docs/foundations/grade-classification.mjs` scores your classification at 10/12 or better, including both hook traps.",
  "`agents/CONTRACT_TEMPLATE.md` has the eleven `## field` headings in schema order and passes `--template` validation.",
  "`docs/foundations/reviewer-contract-draft.md` passes `validate-contract.mjs` with exit code 0 and no warnings.",
  "Every `must` and `mustNot` rule in the reviewer draft is tagged `[mechanism: ...]` or `[convention: ...]`.",
  "The reviewer draft omits `Agent`, `Edit` and `Write` from `tools`, grants no `bench` command, and says why.",
  "The reviewer draft routes `permissions`-array and whitelist changes to `security` and treats an edited `patches.txt` line as `needs-human`.",
  "The `humanGate` field names a real mechanism, and `bench migrate` on a shared site stays with a person.",
  "`node --test docs/foundations/foundations.test.mjs` reports 16 passing tests."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content-frappe/modules/01-foundations.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
