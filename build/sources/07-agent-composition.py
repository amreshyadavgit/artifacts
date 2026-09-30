# Generator for content/modules/07-agent-composition.json. Run: python3 build/sources/07-agent-composition.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = pathlib.Path(__file__).resolve().parent / "07-agent-composition-data"
def f(p): return (ROOT / p).read_text()
def d(name): return (DATA / name).read_text()

mod = {
 "id": "07-agent-composition",
 "level": 5,
 "title": "Agent Composition: Specialists, Execution Modes and Real Nesting Limits",
 "summary": "Decide when one agent is enough and when a roster of specialists pays for itself, then compose them the way Claude Code actually executes subagents: sequential, conditional and parallel launches from the main thread, background vs foreground, fork mode, the concurrency limit, and results that come back as a summary. Finish with the real nesting rules (default depth 3, CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, Agent withheld at the limit, the Agent(type) allowlist only for `claude --agent` main threads) and the one sanctioned depth-2 pattern.",
 "prerequisites": ["05-agent-roster", "06-mcp-and-tooling-architecture", "Claude Code v2.1.219 or later (`claude --version`) for the default nesting depth of 3", "Node 22 for the lint and budget scripts"],
 "concepts": [
  {"heading": "One large agent or a roster: what actually changes",
   "body_md": "A single agent with every tool and every skill looks simpler. On the sample app it fails in predictable ways, recorded in `AI-SDLC/workflows/composition/one-vs-many.md`:\n\n- **It reviews its own work.** The agent that wrote `PatientController.search` is the worst possible reviewer of it. Independence is the main reason code review exists; an agent that shares the author's context shares its blind spots.\n- **Context is paid on every launch.** A subagent starts with its file body, the CLAUDE.md hierarchy, git status and the *full content* of every skill in its `skills:` list. A monolith that preloads seven skills pays for all seven on a one-line fix. `node workflows/composition/context-budget.mjs` estimates this per agent.\n- **Tool surface is the union.** If one agent needs `Edit`, `Bash` and an MCP server, every task gets them, and one prompt injection in a ticket reaches all of them. The security agent in module 05 has `Read, Grep, Glob` only; it *cannot* change what it reviews.\n- **No intermediate artifacts.** A monolith fails as a whole. A roster fails one step at a time, and each completed step left a handoff you can resume from.\n\nSpecialists are not free: you need an orchestrator, a handoff format, and gates. That cost is paid once, in module 08, and reused by every workflow.\n\n**Rule of thumb:** split when the parts need different tools, different models, or independent judgement, or when you want to evaluate them separately (module 09). Keep a single agent, or just the main session, for small tasks with one judgement and no separate review, like `/explain-endpoint`.\n\nSo in practice: the six-agent roster plus one orchestrator is the course default, and every new capability starts by asking which existing agent owns it before creating another."},
  {"heading": "How a subagent is launched and what comes back",
   "body_md": "Delegation is one tool call. The main session (or an agent running as the main thread) calls the **`Agent` tool** (renamed from `Task` in v2.1.63; `Task(...)` still works as an alias) with a `prompt`, a `description` and a `subagent_type` such as `reviewer`. An optional `model` parameter overrides the agent's frontmatter `model` for that one launch.\n\nThe subagent starts with a **fresh context**:\n\n- its own system prompt (the agent file body), not the Claude Code system prompt;\n- the task message the caller wrote;\n- the CLAUDE.md hierarchy and git status;\n- the full content of its preloaded `skills`.\n\nIt does **not** receive the caller's conversation history, output style, or auto memory. Anything the subagent needs must be in the task message or in a file it can read.\n\nWhat returns to the caller is the subagent's **final message**, as a summary. The rest (files read, commands run, dead ends) stays in its own transcript under `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`. A finished subagent can be continued with `SendMessage` to its agent id or name; each new launch is a new instance.\n\nThree consequences drive the rest of this course:\n\n1. **Write the task message like a ticket**: run id, step, input *paths*, goal, output format. Do not paste earlier handoffs into it; give paths and let the agent read them.\n2. **Make the final message the artifact.** Course convention (module 08): the final message *is* the handoff document, or ends with `HANDOFF: <path>`. Then the summary is exactly what you need, not a lossy paraphrase.\n3. **Handoffs go through files.** Because every subagent starts fresh, the next step reads `.ai-sdlc/runs/<run-id>/NN-<agent>.md`, never the previous agent's context."},
  {"heading": "Sequential, conditional and parallel execution",
   "body_md": "Three shapes cover every workflow in this course. All three are decided by the caller (the main thread), not by the subagents.\n\n**Sequential**: step B needs A's output. The caller launches A, waits for its result, then launches B with the path of A's handoff. Requirements, architecture review and implementation plan are sequential because each consumes the previous one.\n\n**Conditional**: the caller reads an earlier handoff and decides whether a step runs. In the feature workflow the security step runs only if the developer's `## Artifacts` list touches `api/`, `config/`, `error/`, `audit/`, `src/main/resources/`, `k8s/`, `pom.xml` or `Dockerfile`. The decision and its reason are written to the run report. A condition evaluated from a file is deterministic and auditable. \"Use the security agent if it seems relevant\" is neither.\n\n**Parallel**: independent steps are launched **in the same turn**. After the developer, tester and security both read the same diff; tester writes under `sample-app/src/test/`, security writes nothing. Claude Code runs them concurrently, and they count against the concurrent-subagent limit (default 20, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).\n\nParallel safety is a course rule, not a Claude Code feature:\n\n- no two parallel agents edit the same files;\n- each parallel agent gets a pre-assigned step number and handoff file (`05-tester.md`, `06-security.md`);\n- the caller evaluates gates only after *all* parallel results are in.\n\nSo in practice: draw the dependency graph first. Anything without an arrow between them can run in parallel if their write sets do not overlap. Everything else is sequential, and every \"maybe\" becomes an explicit condition on a handoff field."},
  {"heading": "Foreground, background, fork mode and the concurrency limit",
   "body_md": "Where a subagent runs changes what the caller sees, not what the subagent can do.\n\n- **Interactive sessions**: fork mode is on by default (v2.1.232+), so subagents run in the **background** and the main session is notified as each one finishes. `Ctrl+B` backgrounds a task that is running in the foreground.\n- **`claude -p` and the Agent SDK**: fork mode is off, so subagents run in the **foreground**.\n- **Overrides**: `CLAUDE_CODE_FORK_SUBAGENT=1|0`; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` forces foreground; frontmatter `background: true` always backgrounds that agent.\n- **Permission prompts** from a background subagent surface in the main session. Human gates built on permission `ask` rules still reach the human (module 08).\n- **Background tool set**: background subagents keep MCP tools but only a fixed list of built-ins (Read, Grep, Glob, Bash, Edit, Write, WebFetch, Skill, SendMessage and a few more).\n- **Waiting**: interactively, a subagent that launched background children waits for them. Under `-p` or the SDK it does not. This matters as soon as you nest.\n- **Concurrency**: 20 running subagents by default; the next launch fails with `Concurrent subagent limit reached`.\n\n**A fork is not the same as fork mode.** A fork (`/subtask <task>`, or subagent type `fork`) inherits the caller's *full conversation*, system prompt, tools and model. That is useful for trying something in a side branch of your current context. It is wrong for workflow steps: a forked \"reviewer\" shares the author's context, carries every token of the conversation, and cannot spawn further forks.\n\nSo in practice: workflow steps use named roster agents with fresh context; forks are for your own exploratory side-questions."},
  {"heading": "Nesting: the real limits",
   "body_md": "Older Claude Code documentation said subagents cannot spawn subagents. **Current docs say they can**, and your design has to account for that:\n\n- By default a subagent can spawn subagents of its own, **up to three layers below the main conversation** (v2.1.219+; versions before 2.1.172 allowed no nesting, and some versions in between used other limits).\n- `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes the limit (`\"2\"`, or `\"1\"` to turn nesting off). It can be set in a settings file's `env` block.\n- **At the depth limit Claude Code withholds the `Agent` tool** from every subagent except a fork, so that subagent does the work itself and returns one summary.\n- An agent that **omits `tools` inherits every tool, including `Agent`**. To stop an agent delegating, list its tools without `Agent`, or add `Agent` to `disallowedTools`.\n- `Agent(architect, developer)` in `tools` is an **allowlist of spawnable types only when that agent is the main thread** (`claude --agent <name>` or the `agent` setting). In a subagent definition the parenthesised list is **ignored**: it simply grants `Agent`.\n- `permissions.deny: [\"Agent(general-purpose)\"]` in settings blocks a type at every depth.\n\nThe design consequence for this course: the only place a spawnable-type allowlist is enforced is the main thread, so the orchestrator runs there (`claude --agent orchestrator`), and the six roster agents list explicit `tools` without `Agent`. `node workflows/composition/check-roster-flat.mjs` fails the build if any roster agent can delegate, if one omits `tools`, or if the orchestrator names a non-roster type. It also warns when a subagent definition contains an `Agent(...)` list, because that list restricts nothing."},
  {"heading": "The one sanctioned depth-2 pattern, and why the roster stays flat",
   "body_md": "There is one situation where nesting is worth it: you are already in an ordinary interactive session and want to hand a whole workflow to the orchestrator without restarting. Launch the orchestrator **as a subagent** (`@agent-orchestrator ...`). Main session = depth 0, orchestrator = depth 1, roster = depth 2.\n\nRun it with `claude --settings workflows/composition/depth-2.settings.json`:\n\n- `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: \"2\"` puts the roster at the limit, so `Agent` is withheld from them even if someone later adds it to a roster file.\n- `permissions.deny: [\"Agent(general-purpose)\"]` compensates for the lost allowlist: as a subagent, the orchestrator's `Agent(...)` list is ignored.\n- `permissions.ask: [\"Agent(developer)\"]` keeps gate G1. The prompt surfaces in the main session.\n\nWhat you give up, and why this stays the exception (`workflows/composition/hierarchy-and-depth.md`):\n\n1. **Allowlist lost**: only deny rules constrain which types the orchestrator launches.\n2. **Summaries of summaries**: roster results reach the orchestrator as summaries, and its result reaches you as a summary of those. Read the run folder, not the chat.\n3. **Waiting semantics**: under `-p` or the SDK the orchestrator does not wait for background children. Never run depth 2 headless.\n4. **Split audit trail**: delegations live in the orchestrator's subagent transcript, not in your main transcript.\n\nWhy the roster itself never delegates: every delegation should be a visible `Agent` call by the orchestrator plus a handoff file; the allowlist is enforceable only at the main thread; each level multiplies launches and start-up context; and a nested failure surfaces two levels up as a vague summary instead of a `blocked` handoff with evidence. Since every subagent starts fresh, the next step needs a file anyway. Once you have files, nesting buys nothing that sequencing in the orchestrator does not."}
 ],
 "diagrams": [
  {"title": "Main thread composing specialists: sequential, conditional, parallel",
   "mermaid": "sequenceDiagram\n  participant H as Human\n  participant O as Orchestrator (main thread)\n  participant A as architect\n  participant D as developer\n  participant T as tester\n  participant S as security\n  participant F as Run folder\n  O->>A: Agent call, step 02, input 01-requirements.md\n  A->>F: writes 02-architect.md\n  A-->>O: final message (summary)\n  O->>H: Agent(developer) ask prompt, gate G1\n  H-->>O: approve\n  O->>D: Agent call, step 04, input 03-implementation-plan.md\n  D->>F: writes 04-developer.md\n  D-->>O: final message\n  Note over O: 04 Artifacts touch api/ so security runs\n  par same turn\n    O->>T: Agent call, step 05\n  and\n    O->>S: Agent call, step 06\n  end\n  T-->>O: 05 handoff\n  S-->>O: 06 handoff (inline)\n  O->>F: saves 06-security.md"},
  {"title": "Depth: the course default and the one sanctioned depth-2 pattern",
   "mermaid": "flowchart TD\n  subgraph DEF[\"Default: claude --agent orchestrator\"]\n    M0[\"depth 0: orchestrator as main thread<br/>Agent(architect, developer, ...) allowlist enforced\"] --> R1[\"depth 1: roster agents<br/>no Agent in tools\"]\n  end\n  subgraph D2[\"Sanctioned depth 2: depth-2.settings.json\"]\n    N0[\"depth 0: plain main session\"] --> N1[\"depth 1: orchestrator as subagent<br/>Agent(...) list ignored, deny rules apply\"]\n    N1 --> N2[\"depth 2: roster agents<br/>Agent withheld (limit 2)\"]\n  end\n  N2 -. \"would need depth 3\" .-> X[\"further delegation blocked\"]"}
 ],
 "comparisonTables": [
  {"title": "One large agent vs specialised agents",
   "columns": ["Dimension", "One large agent", "Specialised roster + orchestrator", "How to check in this repo"],
   "rows": [
    ["Context size", "CLAUDE.md + imports + every preloaded skill on every launch (the monolith preloads 7 skills)", "CLAUDE.md + imports + short body + 1-2 skills; fresh context per launch", "`node workflows/composition/context-budget.mjs`"],
    ["Tool surface", "Union of every need: Edit, Write, Bash, MCP", "Per role; security has Read, Grep, Glob only", "`node workflows/composition/check-roster-flat.mjs` prints each agent's tools"],
    ["Auditability", "One interleaved transcript, no artifact per decision", "One validated handoff per step in `.ai-sdlc/runs/<run-id>/`; each delegation is an `Agent` call", "`node .claude/hooks/check-handoff.mjs <run-folder>`"],
    ["Cost", "Fewer launches; large context re-read every turn; one model for all", "More launches, each small; model per role (opus architect/security, sonnet developer/tester/reviewer)", "`total_cost_usd` in `claude -p --output-format json` (module 09)"],
    ["Failure isolation", "Any failure loses the run; no resume point", "Failed step retried alone; completed handoffs reused", "Rerun `/feature` with the same ticket: completed steps are skipped"],
    ["Review independence", "Author reviews itself", "Reviewer and security never wrote the code and cannot edit it", "reviewer `tools` has no Edit/Write"],
    ["Latency", "Strictly sequential", "Independent steps in parallel (tester and security)", "Timestamps of `05-tester.md` and `06-security.md`"]
   ]},
  {"title": "Where delegation is actually constrained",
   "columns": ["Mechanism", "Where it applies", "Effect", "Pitfall"],
   "rows": [
    ["`Agent(type1, type2)` in `tools`", "Only an agent run as main thread (`claude --agent`, `agent` setting)", "Allowlist of spawnable subagent types", "In a subagent file the list is ignored and just grants `Agent`"],
    ["Omit `Agent` from `tools` / `disallowedTools: Agent`", "Any subagent definition", "That agent cannot delegate", "Omitting `tools` entirely inherits `Agent`"],
    ["`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`", "Whole session (env or settings `env`)", "At the limit `Agent` is withheld (except forks)", "Default is 3 layers below the main conversation, not 1"],
    ["`permissions.deny: [\"Agent(name)\"]`", "Settings (all depths)", "Type cannot be launched anywhere", "Also blocks the main session from using it"],
    ["`permissions.ask: [\"Agent(developer)\"]`", "Settings (all depths)", "Human approves each launch; prompt surfaces in the main session", "Only meaningful in a mode where prompts are shown (module 10)"]
   ]}
 ],
 "exercises": [
  {"id": "07-split-the-monolith",
   "title": "Measure a monolith against the roster and record the decision",
   "objective": "Install a deliberately monolithic `sdlc-monolith` agent, measure its start-up context and tool surface against the six roster agents with the budget and lint scripts, then write the decision record that justifies the split. You leave with numbers, not opinions.",
   "startingFiles": [
    {"path": "AI-SDLC/.claude/agents/sdlc-monolith.md", "content": d("sdlc-monolith.md")}
   ],
   "requiredStructure": "AI-SDLC/\n├── .claude/agents/\n│   ├── architect.md developer.md reviewer.md tester.md security.md sre.md   # module 05\n│   ├── orchestrator.md                                                    # module 08\n│   └── sdlc-monolith.md                                                   # temporary, delete at the end\n└── workflows/composition/\n    ├── context-budget.mjs          # estimates start-up tokens per agent\n    └── one-vs-many.md              # decision record with the measured numbers",
   "implementation": [
    {"path": "AI-SDLC/workflows/composition/context-budget.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/workflows/composition/one-vs-many.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\n# 1. install the starting file as .claude/agents/sdlc-monolith.md, then:\nnode workflows/composition/context-budget.mjs\nnode workflows/composition/check-roster-flat.mjs\n# 2. ask the monolith and the roster the same review question and compare\nclaude -p \"Use the sdlc-monolith subagent to review sample-app/src/main/java/org/example/fhir/api/PatientController.java for security issues. Findings only.\" --output-format json | jq '{cost: .total_cost_usd, turns: .num_turns}'\nclaude -p \"Use the security subagent to review sample-app/src/main/java/org/example/fhir/api/PatientController.java. Findings only.\" --output-format json | jq '{cost: .total_cost_usd, turns: .num_turns}'",
   "expectedOutput": "CLAUDE.md + imports (every agent): ~2198 tokens\nagent           body skills  total  preloaded skills\narchitect       1267   1276   4740  architecture-review\ndeveloper       1230    756   4184  run-tests\norchestrator    1330      0   3528  -\nreviewer        1636   1322   5156  code-review\nsdlc-monolith    145   8700  11040  architecture-review, code-review, test-strategy, security-review, performance-review, production-rca, run-tests\nsecurity        1384   1406   4987  security-review\nsre             1283   2650   6130  performance-review, production-rca\ntester          1159   2050   5400  test-strategy, run-tests\n\n...lint:\nsdlc-monolith (tools omitted: inherits all)\nERROR .claude/agents/sdlc-monolith.md: \"sdlc-monolith\" omits tools, so it inherits every tool including Agent; list tools explicitly or add disallowedTools: Agent\n\n1 error(s)\n\n(Your token numbers differ as the skills evolve; the monolith is roughly 2x the start-up context of any specialist, and it is the only agent that can Edit, Bash and delegate at once.)",
   "testCases": [
    {"name": "Budget script runs and lists every agent", "input": "node workflows/composition/context-budget.mjs | grep -cE '^(architect|developer|reviewer|tester|security|sre|orchestrator|sdlc-monolith) '", "expected": "8"},
    {"name": "Monolith is the largest start-up context", "input": "node workflows/composition/context-budget.mjs | tail -n +3 | sort -k4 -n | tail -1 | awk '{print $1}'", "expected": "sdlc-monolith"},
    {"name": "Lint rejects the monolith's inherited Agent tool", "input": "node workflows/composition/check-roster-flat.mjs; echo exit=$?", "expected": "An ERROR line naming sdlc-monolith.md and `exit=1`."},
    {"name": "Budget script unit test", "input": "node workflows/composition/composition.test.mjs | grep 'context budget'", "expected": "PASS  context budget counts body, preloaded skill and CLAUDE.md import"},
    {"name": "Cleanup restores a flat roster", "input": "rm .claude/agents/sdlc-monolith.md && node workflows/composition/check-roster-flat.mjs | tail -1", "expected": "OK  roster is flat: only the orchestrator delegates (7 agent files)"}
   ],
   "evaluationCriteria": [
    "The decision record cites measured numbers from `context-budget.mjs`, not estimates from memory.",
    "Each trade-off row (context size, tool surface, auditability, cost, failure isolation) names a way to check it in this repo.",
    "The record states when a single agent (or the main session) is still the right choice.",
    "The monolith is removed at the end and the lint exits 0."
   ],
   "improvements": [
    "Add a `--json` flag to `context-budget.mjs` and track the numbers per release in `evaluations/` (module 09).",
    "Include MCP tool definitions in the estimate for agents that inherit MCP tools.",
    "Run the paired `claude -p` comparison on three golden tasks and add cost per finding to the decision record."
   ]},
  {"id": "07-parallel-and-conditional",
   "title": "Run tester and security in parallel, and skip security when the diff does not need it",
   "objective": "Apply a small labelled change to the sample app, have the main session launch the tester and security subagents in the same turn, observe that they run concurrently in the background and return only summaries, then apply a service-only refactor and show that the conditional rule skips security with a recorded reason.",
   "startingFiles": [
    {"path": "AI-SDLC/workflows/composition/fixtures/api-count.patch", "content": f("AI-SDLC/workflows/composition/fixtures/api-count.patch")},
    {"path": "AI-SDLC/workflows/composition/fixtures/service-refactor.patch", "content": f("AI-SDLC/workflows/composition/fixtures/service-refactor.patch")}
   ],
   "requiredStructure": "AI-SDLC/\n├── workflows/composition/\n│   ├── execution-modes.md                 # sequential / conditional / parallel, background vs foreground\n│   └── fixtures/\n│       ├── api-count.patch                # labelled EXERCISE-DEFECT(07-parallel) in PatientController\n│       └── service-refactor.patch         # PatientService only: no security-scoped path\n└── .ai-sdlc/runs/2026-09-30-feat-count-param/   # 05-tester.md, 06-security.md written during the exercise",
   "implementation": [
    {"path": "AI-SDLC/workflows/composition/execution-modes.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\npatch -p1 < workflows/composition/fixtures/api-count.patch\nclaude\n# in the session:\nRun id 2026-09-30-feat-count-param. The change is the current git diff. In parallel, in this same turn: launch the tester subagent for step 05 (cover _count: default, 0, -1, 101) and the security subagent for step 06. Both return their handoff in the format of workflows/README.md. Save 06 to .ai-sdlc/runs/2026-09-30-feat-count-param/06-security.md. Wait for both before summarising.",
   "expectedOutput": "Two background tasks start together: \"tester: step 05 _count tests\" and \"security: step 06 review\".\n\n06-security.md (excerpt):\n| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| SEC-1 | medium | security | sample-app/src/main/java/org/example/fhir/api/PatientController.java:39 | `@RequestParam(name = \"_count\", defaultValue = \"20\") int count` with `// EXERCISE-DEFECT(07-parallel): _count has no lower or upper bound check.` | Reject `_count < 1` or `> 100` with `FhirApiException.badRequest` (api-standards: max 100). |\n| SEC-2 | low | security | sample-app/src/main/java/org/example/fhir/api/PatientController.java:42 | `.stream().limit(count)` | A negative `_count` throws `IllegalArgumentException`, mapped to 500 by `GlobalExceptionHandler.handleUnexpected`; return 400 instead. |\n\n05-tester.md (excerpt):\n[ERROR] Tests run: 29, Failures: 3, Errors: 0, Skipped: 0\n[ERROR]   PatientApiTest.searchCountAbove100Is400:201 Status expected:<400> but was:<200>\n[ERROR]   PatientApiTest.searchCountZeroIs400:209 Status expected:<400> but was:<200>\n[ERROR]   PatientApiTest.searchNegativeCountIs400:217 Status expected:<400> but was:<500>\nstatus: blocked\n\nSecond part (service-refactor.patch only):\n06 security: skipped (no security-scoped path in changed files: sample-app/src/main/java/org/example/fhir/service/PatientService.java)",
   "testCases": [
    {"name": "Patch applies and the existing suite still passes", "input": "patch -p1 --dry-run < workflows/composition/fixtures/api-count.patch && patch -p1 < workflows/composition/fixtures/api-count.patch && (cd sample-app && mvn -q -B test); echo exit=$?", "expected": "`checking file sample-app/src/main/java/org/example/fhir/api/PatientController.java`, then exit=0 with 25 tests: the defect is only visible once the tester adds boundary tests."},
    {"name": "Both handoffs exist and overlap in time", "input": "ls .ai-sdlc/runs/2026-09-30-feat-count-param/ && grep -h '^agent:' .ai-sdlc/runs/2026-09-30-feat-count-param/0[56]-*.md", "expected": "05-tester.md 06-security.md; agent: tester, agent: security. Both background tasks appeared in the task list at the same time."},
    {"name": "Security finds the labelled defect", "input": "grep -E 'SEC-[0-9]+ \\| (medium|high)' .ai-sdlc/runs/2026-09-30-feat-count-param/06-security.md", "expected": "A finding at PatientController.java citing `_count` without bounds."},
    {"name": "Handoffs are valid", "input": "node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-count-param", "expected": "PASS for 05-tester.md and 06-security.md, exit 0."},
    {"name": "Conditional skip for a service-only diff", "input": "git checkout -- sample-app && patch -p1 < workflows/composition/fixtures/service-refactor.patch && git diff --name-only", "expected": "Only sample-app/src/main/java/org/example/fhir/service/PatientService.java: no path matches the security list in execution-modes.md, so the main session records `06 security: skipped` and launches only the tester."}
   ],
   "evaluationCriteria": [
    "Both launches happen in one turn, and the caller summarises only after both results arrive.",
    "The tester and security write disjoint paths; only the main session writes 06-security.md.",
    "The skip decision is made from the list of changed paths and written down with the reason.",
    "The learner can explain why the transcript shows only a summary per subagent and where the full subagent transcript lives."
   ],
   "improvements": [
    "Repeat the parallel run with `claude -p` and compare: subagents run in the foreground there (fork mode off).",
    "Set `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=1` and observe the second launch fail with `Concurrent subagent limit reached`.",
    "Resume the security subagent with SendMessage and ask it to re-check after the fix instead of launching a new one."
   ]},
  {"id": "07-depth-limits",
   "title": "Prove the nesting limits and keep the roster flat",
   "objective": "Lint the agent topology, then use a diagnostic `depth-probe` agent that launches one child probe to observe the real rules: with the default limit both levels have the Agent tool; with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` (from `depth-2.settings.json`) the child two layers down loses it; with `1` nesting is off. Then show that the lint stops a roster agent from gaining Agent, and finish with a clean lint.",
   "startingFiles": [
    {"path": "AI-SDLC/.claude/agents/depth-probe.md", "content": d("depth-probe.md")}
   ],
   "requiredStructure": "AI-SDLC/workflows/composition/\n├── check-roster-flat.mjs        # topology lint (exit 1 on errors)\n├── composition.test.mjs         # 11 unit tests for the lint and budget scripts\n├── depth-2.settings.json        # depth limit 2 + deny general-purpose + ask developer\n└── hierarchy-and-depth.md       # limits, the depth-2 pattern, why the roster is flat",
   "implementation": [
    {"path": "AI-SDLC/workflows/composition/check-roster-flat.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/workflows/composition/composition.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/workflows/composition/depth-2.settings.json", "language": "json", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/workflows/composition/hierarchy-and-depth.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode workflows/composition/composition.test.mjs\n# install the starting file .claude/agents/depth-probe.md, then run the same prompt twice:\nclaude -p \"Use the depth-probe subagent with the task message: recurse\" --output-format json | jq -r '.result'\nclaude -p \"Use the depth-probe subagent with the task message: recurse\" --settings workflows/composition/depth-2.settings.json --output-format json | jq -r '.result'",
   "expectedOutput": "PASS  splitTools keeps the Agent(...) list together\nPASS  CLI lint of the real .claude/agents exits 0\n\n11/11 passed\n\nRun 1 (default limit, 3 layers):\nprobe tools: Agent, Bash, Edit, Glob, Grep, Read, Skill, WebFetch, Write (list shortened)\nAgent tool available: yes\nchild:\nprobe tools: Agent, Bash, Edit, Glob, Grep, Read, Skill, WebFetch, Write (list shortened)\nAgent tool available: yes\n\nRun 2 (depth-2.settings.json, limit 2):\nprobe tools: Agent, Bash, Edit, Glob, Grep, Read, Skill, WebFetch, Write (list shortened)\nAgent tool available: yes\nchild:\nprobe tools: Bash, Edit, Glob, Grep, Read, Skill, WebFetch, Write (list shortened)\nAgent tool available: no\n\nThe child runs 2 layers below the main conversation. With the limit at 2 it is at the limit, so Claude Code withholds Agent from it. In run 1 the child could still have delegated once more.",
   "testCases": [
    {"name": "Unit tests pass", "input": "node workflows/composition/composition.test.mjs; echo exit=$?", "expected": "11/11 passed, exit=0"},
    {"name": "Lint flags the probe (tools omitted)", "input": "node workflows/composition/check-roster-flat.mjs | grep depth-probe", "expected": "ERROR .claude/agents/depth-probe.md: \"depth-probe\" omits tools, so it inherits every tool including Agent; list tools explicitly or add disallowedTools: Agent"},
    {"name": "Agent withheld at the limit", "input": "Run 2 of the exampleInput", "expected": "The line after `child:` reports `Agent tool available: no`."},
    {"name": "Default limit keeps Agent one level deeper", "input": "Run 1 of the exampleInput", "expected": "Both the probe and its child report `Agent tool available: yes`."},
    {"name": "Nesting off", "input": "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 claude -p \"Use the depth-probe subagent with the task message: recurse\" --output-format json | jq -r '.result'", "expected": "The first probe reports `Agent tool available: no` and has no `child:` section."},
    {"name": "Roster agent with Agent fails the lint", "input": "cp .claude/agents/reviewer.md /tmp/reviewer.bak && sed -i 's/^tools: Read, Grep, Glob, Bash$/tools: Read, Grep, Glob, Bash, Agent/' .claude/agents/reviewer.md && node workflows/composition/check-roster-flat.mjs; echo exit=$?; cp /tmp/reviewer.bak .claude/agents/reviewer.md", "expected": "ERROR .claude/agents/reviewer.md: \"reviewer\" can spawn subagents (Agent); roster agents stay at depth 1, remove Agent from tools; exit=1"},
    {"name": "Cleanup", "input": "rm .claude/agents/depth-probe.md && node workflows/composition/check-roster-flat.mjs | tail -1", "expected": "OK  roster is flat: only the orchestrator delegates (7 agent files)"}
   ],
   "evaluationCriteria": [
    "The learner states the default limit (3 layers below the main conversation) and how to change it, without claiming nesting is impossible.",
    "The learner shows that the `Agent(...)` list only restricts a `claude --agent` main thread.",
    "depth-2.settings.json uses only documented keys (`env`, `permissions.ask`, `permissions.deny`).",
    "The final lint exits 0 and no roster agent lists Agent."
   ],
   "improvements": [
    "Add the lint to CI next to `mvn -q -B test` (module 10) so a roster change that adds Agent fails the PR.",
    "Try `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` and confirm the orchestrator-as-subagent pattern stops working at all.",
    "Add a `SubagentStart` hook that logs `agent_type` and `agent_id` for each launch to build a delegation tree for audits."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`node workflows/composition/check-roster-flat.mjs` exits 0: only the orchestrator lists `Agent`, and every roster agent has explicit `tools`.",
  "`node workflows/composition/composition.test.mjs` passes (11 tests).",
  "`node workflows/composition/context-budget.mjs` shows every roster agent below the monolith's start-up context.",
  "`workflows/composition/one-vs-many.md` records measured numbers for context size, tool surface, auditability, cost and failure isolation.",
  "You can name what a subagent receives (body, task message, CLAUDE.md, git status, preloaded skills) and what it does not (history, system prompt, output style, auto memory).",
  "Parallel steps are launched in one turn, write disjoint paths, and gates are evaluated only after all results return.",
  "Conditional steps are decided from a handoff field (changed paths), and skips are recorded with a reason.",
  "You can state the default nesting depth (3), the env var that changes it, and that `Agent` is withheld at the limit.",
  "You can explain why the `Agent(type)` allowlist only works for `claude --agent` main threads and how the depth-2 settings compensate.",
  "No diagnostic agents (`sdlc-monolith`, `depth-probe`) remain in `.claude/agents/`."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/07-agent-composition.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
