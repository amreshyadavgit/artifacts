# Generator for content/modules/08-workflow-orchestration.json. Run: python3 build/sources/08-workflow-orchestration.py
import json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

# The orchestrator Agent Contract is parsed from the contract file itself (course validator, W1).
contract = json.loads(subprocess.run(
    ["node", "docs/foundations/validate-contract.mjs", "--json", "agents/orchestrator/CONTRACT.md"],
    cwd=ROOT / "AI-SDLC", check=True, capture_output=True, text=True).stdout)

EX = "AI-SDLC/workflows/examples/feature-patient-pagination/"
EXAMPLES = ["01-requirements.md", "02-architect.md", "03-implementation-plan.md", "04-developer.md", "05-tester.md",
            "06-security.md", "07-developer.md", "08-reviewer.md", "09-run-report.md"]

mod = {
 "id": "08-workflow-orchestration",
 "level": 6,
 "title": "Workflow Orchestration: the /feature Chain, Handoffs and Human Gates",
 "summary": "Build the orchestrator that runs the AI-SDLC workflows end to end: a main-thread agent (`claude --agent orchestrator`) whose `Agent(...)` allowlist names only the roster, `/feature`, `/bug-fix` and `/incident` entry-point skills, workflow specs with conditional and parallel steps and a failure and retry policy, a SubagentStop hook that rejects invalid handoffs with exit code 2, and three human gates built on real mechanisms (an `ask` rule on `Agent(developer)`, a needs-human stop on blocking findings, and PR review). A complete example run for Patient search pagination shows every handoff.",
 "prerequisites": ["07-agent-composition", "05-agent-roster", "03-skills-architecture-code-test", "04-skills-security-performance-rca", "Node 22, Java 21, Maven 3.9", "Claude Code CLI authenticated (`claude --version`)"],
 "concepts": [
  {"heading": "The orchestrator runs as the main thread",
   "body_md": "Module 07 established the constraint: the `Agent(type1, type2)` allowlist in `tools` is enforced **only for an agent running as the main thread**. So the orchestrator is not a subagent you call. It *is* the session:\n\n```bash\ncd AI-SDLC\nclaude --agent orchestrator --settings workflows/gates.settings.json\n```\n\n`.claude/agents/orchestrator.md` has `tools: Agent(architect, developer, reviewer, tester, security, sre), Read, Write, Grep, Glob, Skill`. With `--agent`, its body replaces the default system prompt, CLAUDE.md still loads, and it can launch exactly six subagent types. It has no `Edit` and no `Bash`: it cannot change code, run `git`, or touch the cluster. Its body is a procedure: start or resume a run, run each step, apply gate rules, apply the retry policy, and finish with a run report.\n\nThe second entry path is the **`/feature` skill** in an ordinary session. `disable-model-invocation: true` makes it user-only (Claude cannot trigger a workflow on its own), `argument-hint: \"[ticket-id] [short feature summary]\"` shows in autocomplete, and `$0` is the ticket id. The skill tells the main session to follow the orchestrator procedure. It works, but the allowlist is **not** enforced there: the main session can launch any agent type. The course default is therefore `claude --agent orchestrator`, then `/feature ...` inside it.\n\nA third path, the orchestrator *as a subagent* from a plain session, is the sanctioned depth-2 pattern from module 07. Use it only interactively and with `workflows/composition/depth-2.settings.json`.\n\nSo in practice: one command starts a gated session, one slash command starts a run, and the only way work reaches `sample-app/` is through a developer launch that a human approved."},
  {"heading": "The /feature chain and the run folder",
   "body_md": "`workflows/feature-delivery.md` is the spec; the orchestrator executes it:\n\n| step | file | who |\n|---|---|---|\n| 01 | `01-requirements.md` | orchestrator, `requirements` skill |\n| 02 | `02-architect.md` | architect (`architecture-review` preloaded) |\n| 03 | `03-implementation-plan.md` | orchestrator, `implementation-plan` skill |\n| 04 | `04-developer.md` | developer, after gate G1 |\n| 05 + 06 | `05-tester.md`, `06-security.md` | tester and security in parallel; security conditional |\n| 07.. | `07-developer.md` | rework, max 2 |\n| next | `NN-reviewer.md` | reviewer (`code-review`) |\n| last | `NN-run-report.md` | orchestrator |\n\nRun folder rules (`workflows/README.md`):\n\n- **Run id** `YYYY-MM-DD-<feat|bug|inc>-<slug>`; folder `.ai-sdlc/runs/<run-id>/` (git-ignored).\n- **File names** `NN-<agent>.md` for agent steps, `NN-<skill>.md` for the orchestrator's own skill steps. Skipped steps leave their number unused; rework takes the next free number.\n- **Who writes**: architect, developer and tester write their own handoff (their `Write` is scoped to the run folder by the module 05 guard hook). Reviewer, security and sre have no `Write`: their **final message is the handoff**, and the orchestrator saves it verbatim.\n- **Active marker**: the orchestrator writes the run id to `.ai-sdlc/runs/.active` at start and `none` at the end.\n- **Resume**: if the folder already has handoffs, the orchestrator continues from the first step without a `complete` one.\n\n`workflows/examples/feature-patient-pagination/` is a complete run for ticket PAT-142 (`_count`/`_offset` on `GET /fhir/Patient`). It is consistent with the real code: the tester catches that `Bundle.searchset(List)` sets `total` to the page size, security flags an unbounded `_offset`, and the developer fixes both in step 07."},
  {"heading": "Handoffs are the interface, and a hook enforces them",
   "body_md": "A subagent returns one final message as a summary, and the next agent starts with a fresh context. The handoff file is therefore the **only** channel between steps, so its format is enforced, not requested.\n\nThe format (STYLE_GUIDE §7, `workflows/README.md`): YAML front matter `run_id`, `step`, `agent`, `status` (`complete | blocked | needs-human`), `inputs`, `next`, then `## Summary`, `## Findings` (table `id | severity | category | location | evidence | recommendation`), `## Decisions`, `## Open questions`, `## Artifacts`.\n\n`.claude/hooks/check-handoff.mjs` runs on **`SubagentStop`** with matcher `architect|developer|reviewer|tester|security|sre` (SubagentStop matchers filter on agent type). The hook input carries `agent_type` and `last_assistant_message`. The hook looks for a handoff in this order: a `HANDOFF: <path>` line; the inline document in the final message; the newest file in the active run written by this agent. It checks field values, file prefix vs `step`, `run_id` vs folder and `.active`, that `inputs` exist and are earlier steps, the five sections, finding severities, and that `blocked`/`needs-human` come with a concrete open question.\n\nOn failure it **exits 2** with the reasons on stderr. For `SubagentStop`, exit 2 blocks the stop: the subagent continues, sees the reasons, and fixes its handoff. Exit 1 would only log a non-blocking error. The docs describe a cap of 8 consecutive forced continuations for `Stop` hooks; do not rely on it for `SubagentStop`. The orchestrator's retry policy (one retry, then `needs-human`) is the real backstop.\n\nWhere it is registered: the orchestrator's frontmatter `hooks` field, and the `feature`, `bug-fix` and `incident` skills' frontmatter `hooks` (skill hooks live for the rest of the session once the skill is invoked). `build/CLAUDE_CODE_FACTS.md` documents frontmatter hooks as scoped to that agent, but does not say whether they fire when the agent runs as the main thread with `--agent`. The skill registration covers that case. Module 10 can add the same entry to `.claude/settings.json`; identical handlers are deduplicated.\n\nOutside an active run the hook does not enforce anything, so ad-hoc `@agent-reviewer` use keeps working."},
  {"heading": "Human gates built on real mechanisms",
   "body_md": "An instruction such as \"wait for approval\" is not a gate: nothing stops the model if it decides to continue. Every gate here is backed by a mechanism Claude Code enforces or by a stop that needs a human reply.\n\n**G1, plan approval, before every developer launch.** `workflows/gates.settings.json` contains `{\"permissions\": {\"ask\": [\"Agent(developer)\"]}}`, loaded with `--settings`. Permission rules support `Agent(name)`, and `ask` makes Claude Code prompt the human before the tool call runs. The human reads `01-requirements.md`, `02-architect.md`, `03-implementation-plan.md` and accepts or rejects the prompt. Rework launches go through the same prompt, so a fix loop cannot run unattended. Background subagents' prompts surface in the main session. Run gated workflows in `default` mode. Which modes suppress prompts, and how an org pins them, is module 10-governance.\n\n**G2, findings.** After the parallel tester and security steps and after code review, the orchestrator stops with a `needs-human` summary on any `blocked` status, any `critical`/`high` finding, or a `medium` without a fix-or-ticket decision (`context/standards/review-standards.md`). The run does not continue until the human replies, and any rework needs the G1 prompt again.\n\n**G3, merge.** The run ends with `next: human`. No agent pushes or merges: CLAUDE.md rule 7, `git push` is an `ask` rule, and `gh pr merge` is denied in `.claude/settings.json`. A person reviews the PR under branch protection and CODEOWNERS (module 10-governance).\n\n**Plan mode** is the complementary gate for ad-hoc work in the main session: `--permission-mode plan`, Shift+Tab, or `/plan` keeps Claude read-only until you approve its plan. Workflows use the `ask` rule instead, because the orchestrator must still write handoffs to the run folder while the developer is gated.\n\nSo in practice: G1 is a prompt, G2 is a stop, G3 is a PR. Each leaves evidence in the transcript or on GitHub."},
  {"heading": "Conditional and parallel steps, failure and retry",
   "body_md": "**Conditional security.** The orchestrator reads the developer's `## Artifacts`. Security runs if any path is under `api/`, `config/`, `error/`, `audit/`, `src/main/resources/`, `k8s/`, or is `pom.xml` or `Dockerfile`. Otherwise it records `06 security: skipped (no security-scoped path in 04 Artifacts: ...)` in the run report. The `implementation-plan` skill predicts the same answer as \"Security scope: YES/NO\", so a human sees it at G1 and can force the step. Other conditions follow the same pattern: bug-fix runs the architect only for migration, contract or multi-layer changes; incident runs security only for auth anomalies or data exposure.\n\n**Parallel tester and security.** Both are launched in the same turn with pre-assigned files `05-tester.md` and `06-security.md`. Tester writes only under `sample-app/src/test/` (module 05 guard), and security writes nothing, so their write sets cannot collide. G2 is evaluated only after both are back.\n\n**Failure and retry policy** (every spec has a table):\n\n| failure | response |\n|---|---|\n| invalid or missing handoff | hook exit 2; then one retry with the hook's error in the task; then `needs-human` |\n| `blocked` from tester or reviewer | developer rework with the blocking finding ids, max 2 |\n| third rework needed | `needs-human`: the plan is wrong, not the code |\n| G1 prompt rejected | stop; human edits 01 or 03; completed steps are not redone |\n| agent error or empty result | retry once, then `needs-human` |\n| session interrupted | rerun the same entry point; resume from the first incomplete step |\n\nThe caps matter as much as the retries. An orchestrator that retries forever turns one bad plan into a large bill and a noisy diff."},
  {"heading": "Three workflows, one orchestrator",
   "body_md": "The orchestrator's body is workflow-agnostic. The differences live in `workflows/*.md` and in the entry-point skills:\n\n- **`/feature`**: `feature-delivery.md` (described above).\n- **`/bug-fix`**: `bug-fix.md`. Evidence comes first. The `requirements` skill runs in bug mode (observed, expected, reproduction with synthetic data, regression test name `<bugid>_<behaviour>`). The developer must show the regression test **failing** before the fix and passing after it (`context/standards/testing-standards.md`). If the reproduction passes on `main`, the run stops as `blocked` with \"cannot reproduce\". That is a correct outcome.\n- **`/incident`**: `incident-response.md`. sre leads with `production-rca`, security joins in parallel only when the symptom involves auth or exposure. The mitigation gate (G-M) is a human executing one of sre's \"mitigate now\" options: the sre agent's Bash is limited to read-only `kubectl`/`git` by its guard hook, `kubectl apply` is an `ask` rule, and `kubectl delete` is denied. Code fixes leave the incident workflow as a `/bug-fix` command in `05-bug-fix-handover.md`.\n\nAll three entry points share the same frontmatter shape: `disable-model-invocation: true` (only a human starts a workflow), an `argument-hint`, `allowed-tools` limited to `Read Grep Glob Bash(date *)` plus `Bash(git status *)` for the dynamic context lines (the skills run `date +%F` and `git status --short` at invocation), and the `SubagentStop` hook. The `requirements` and `implementation-plan` skills are model-invocable so the orchestrator can call them with the Skill tool. They also work standalone (`/requirements PAT-142`).\n\nSo in practice: adding a fourth workflow (for example dependency upgrades) is a new spec plus a new entry-point skill. The orchestrator, the hook and the gates are reused unchanged."}
 ],
 "diagrams": [
  {"title": "Feature delivery: steps, conditional security, parallel review, gates",
   "mermaid": "flowchart TD\n  S[\"/feature PAT-142\"] --> R[\"01 requirements<br/>(orchestrator)\"]\n  R --> A[\"02 architect\"]\n  A --> P[\"03 implementation plan<br/>status needs-human\"]\n  P --> G1{\"G1: Agent(developer)<br/>ask prompt accepted?\"}\n  G1 -- \"no\" --> X[\"stop, human edits 01 or 03\"]\n  G1 -- \"yes\" --> D[\"04 developer\"]\n  D --> C{\"04 Artifacts touch api, config,<br/>error, audit, resources, k8s?\"}\n  C -- \"yes\" --> PAR[\"05 tester + 06 security<br/>(same turn)\"]\n  C -- \"no\" --> T[\"05 tester only\"]\n  PAR --> G2{\"G2: blocked, critical/high,<br/>undecided medium?\"}\n  T --> G2\n  G2 -- \"fix\" --> RW[\"07 developer rework<br/>(max 2, via G1 prompt)\"]\n  RW --> CR[\"08 reviewer\"]\n  G2 -- \"clear\" --> CR\n  CR --> REP[\"09 run report\"]\n  REP --> G3[\"G3: human PR review\"]"},
  {"title": "SubagentStop hook rejecting an invalid handoff",
   "mermaid": "sequenceDiagram\n  participant O as orchestrator (main thread)\n  participant R as reviewer subagent\n  participant CC as Claude Code\n  participant H as check-handoff.mjs\n  O->>R: Agent call, step 08, inputs 03, 05, 06, 07\n  R->>CC: final message with status approved\n  CC->>H: SubagentStop JSON with agent_type and last_assistant_message\n  H-->>CC: exit 2, stderr says status approved is not allowed\n  CC->>R: continue with the hook reason\n  R->>CC: corrected handoff with status complete\n  CC->>H: SubagentStop again\n  H-->>CC: exit 0\n  CC-->>O: final message is the handoff\n  O->>O: Write 08-reviewer.md verbatim"},
  {"title": "Handoff status drives the orchestrator",
   "mermaid": "stateDiagram-v2\n  [*] --> Running\n  Running --> Complete: status complete\n  Running --> Blocked: status blocked\n  Running --> NeedsHuman: status needs-human\n  Complete --> Running: next step\n  Blocked --> Rework: fewer than 2 reworks so far\n  Blocked --> NeedsHuman: 2 reworks used\n  Rework --> Running: G1 prompt accepted\n  NeedsHuman --> Running: human decision recorded\n  NeedsHuman --> [*]: human stops the run\n  Complete --> [*]: run report, next human"}
 ],
 "comparisonTables": [
  {"title": "Three ways to run the orchestrator",
   "columns": ["Mode", "Command", "Agent(...) allowlist", "Depth of roster", "Use when"],
   "rows": [
    ["Main thread (default)", "`claude --agent orchestrator --settings workflows/gates.settings.json`, then `/feature ...`", "Enforced: only the six roster types", "1", "Every real workflow run, interactive or headless"],
    ["Main-session skill", "`claude --settings workflows/gates.settings.json`, then `/feature ...`", "Not enforced: main session can launch any type", "1", "Quick runs in an existing session; accept the weaker scope"],
    ["Orchestrator as subagent", "`claude --settings workflows/composition/depth-2.settings.json`, then `@agent-orchestrator ...`", "Ignored; `deny: Agent(general-purpose)` compensates", "2 (Agent withheld at limit 2)", "Interactive only; never headless (no waiting for background children)"]
   ]},
  {"title": "Human gates and their mechanisms",
   "columns": ["Gate", "When", "Mechanism", "Evidence it happened", "Details"],
   "rows": [
    ["G1 plan approval", "Every developer launch, including rework", "`permissions.ask: [\"Agent(developer)\"]` in `workflows/gates.settings.json`", "Permission prompt and answer in the session transcript; `03-implementation-plan.md` status `needs-human`", "This module"],
    ["G2 findings", "After tester/security and after review", "Orchestrator stops with `needs-human`; rework re-triggers G1", "Decision recorded in the next handoff and the run report", "This module; severities in `context/standards/review-standards.md`"],
    ["G3 merge", "End of run", "PR review; `git push` is `ask`, `gh pr merge` denied; branch protection and CODEOWNERS", "Approved PR by a non-author", "Module 10-governance"],
    ["Plan mode (ad hoc)", "Main-session work outside workflows", "`--permission-mode plan`, Shift+Tab, `/plan`", "Plan approval prompt", "Module 10-governance"],
    ["Handoff validity", "Every roster subagent stop during a run", "`SubagentStop` hook, exit 2", "Hook reason in the subagent transcript", "This module"]
   ]}
 ],
 "exercises": [
  {"id": "08-orchestrator-main-thread",
   "title": "Build the orchestrator agent, its contract and the gate settings",
   "objective": "Write the orchestrator as a verified-format agent meant to run as the main thread, with an `Agent(...)` allowlist naming only the six roster agents, Read/Write/Grep/Glob/Skill and no Edit or Bash, a SubagentStop hook in its frontmatter, and a body that is a procedure (start/resume, run a step, parallel steps, gate rules, retry policy, finish). Write its Agent Contract and the `workflows/gates.settings.json` that implements gate G1. Prove the allowlist is enforced in `--agent` mode.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/\n├── .claude/agents/orchestrator.md          # tools: Agent(architect, developer, reviewer, tester, security, sre), Read, Write, Grep, Glob, Skill\n├── agents/orchestrator/CONTRACT.md        # 11 contract sections, validated\n└── workflows/\n    ├── README.md                          # handoff front matter, run folder, gates (linked from CLAUDE.md rule 5)\n    └── gates.settings.json                # permissions.ask: Agent(developer)",
   "implementation": [
    {"path": "AI-SDLC/.claude/agents/orchestrator.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/agents/orchestrator/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/workflows/README.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/workflows/gates.settings.json", "language": "json", "content": "", "tag": "verified-format"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude --agent orchestrator --settings workflows/gates.settings.json -p \"Do not start a workflow and do not launch any agent. In four bullets: which subagent types can you launch, which paths may you write, what must happen before the developer runs, and how does every run end?\" --output-format json | jq -r '.result'",
   "expectedOutput": "- I can launch only architect, developer, reviewer, tester, security and sre. Built-in agents (Explore, Plan, general-purpose) and forks are not available to me for workflow steps.\n- I write only inside .ai-sdlc/runs/: handoffs for my own steps (01-requirements.md, NN-implementation-plan.md), verbatim copies of inline handoffs from reviewer, security and sre, the run report, and the .active marker. I have no Edit or Bash, so I cannot change sample-app/ or run git.\n- Before every developer launch the plan is marked needs-human (gate G1) and the launch itself triggers the Agent(developer) permission prompt; the developer runs only if a human accepts it.\n- Every run ends with NN-run-report.md, next: human, .ai-sdlc/runs/.active set to none, and a human PR review (G3). I never push or merge.",
   "testCases": [
    {"name": "Contract validates", "input": "node docs/foundations/validate-contract.mjs agents/orchestrator/CONTRACT.md", "expected": "OK    agents/orchestrator/CONTRACT.md: 11/11 contract sections"},
    {"name": "Topology lint passes", "input": "node workflows/composition/check-roster-flat.mjs | tail -1", "expected": "OK  roster is flat: only the orchestrator delegates (7 agent files)"},
    {"name": "Frontmatter uses only documented subagent fields", "input": "sed -n '2,/^---$/p' .claude/agents/orchestrator.md | grep -oE '^[a-zA-Z]+:' | sort | tr '\\n' ' '", "expected": "color: description: effort: hooks: maxTurns: model: name: tools: (every key is in the FACTS subagent field table)"},
    {"name": "Governance policy accepts the orchestrator", "input": "node scripts/governance/check-agent-policy.mjs | tail -1", "expected": "7/7 roster agents checked, 0 violation(s), 0 warning(s)"},
    {"name": "Allowlist enforced as main thread", "input": "claude --agent orchestrator -p \"Use the Explore subagent to list every Java file in sample-app.\" --output-format json | jq -r '.result'", "expected": "The orchestrator reports that Explore is not an agent type it can launch (not in its Agent(...) list) and offers to use a roster agent instead. No Explore transcript is created under ~/.claude/projects/*/*/subagents/."},
    {"name": "Gate settings are valid JSON with the ask rule", "input": "node -e \"const s=JSON.parse(require('fs').readFileSync('workflows/gates.settings.json','utf8')); console.log(s.permissions.ask)\"", "expected": "[ 'Agent(developer)' ]"}
   ],
   "evaluationCriteria": [
    "Tools are exactly the allowlisted Agent(...) plus Read, Write, Grep, Glob, Skill; no Edit, Bash or MCP tools.",
    "The body is an executable procedure with explicit stop conditions, not a persona description.",
    "Every must/mustNot in the contract names its enforcement, and the contract states honestly which rules are conventions (the run-folder Write scope).",
    "The gate settings file contains only the ask rule, so it can be layered on top of project settings without weakening them."
   ],
   "improvements": [
    "Add `initialPrompt` (verified field for main-thread agents) that lists available workflows when the session starts.",
    "Enforce the run-folder Write scope with a PreToolUse hook in the orchestrator's frontmatter, reusing `agents/tool-guard.mjs write-scope .ai-sdlc/runs/` from module 05.",
    "Put `\"agent\": \"orchestrator\"` in a dedicated settings file for workflow machines so `claude` alone starts the orchestrator."
   ]},
  {"id": "08-feature-workflow",
   "title": "Run /feature end to end for Patient search pagination",
   "objective": "Write the `feature`, `requirements` and `implementation-plan` skills and the feature-delivery spec, then run `/feature PAT-142` through all gates: approve the developer at G1, watch tester and security run in parallel, decide the findings at G2, let the rework run, and finish with a valid run folder that matches the shape of `workflows/examples/feature-patient-pagination/`.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/\n├── .claude/skills/\n│   ├── feature/SKILL.md                 # disable-model-invocation: true, argument-hint, SubagentStop hook\n│   ├── requirements/SKILL.md            # model-invocable, writes 01-requirements.md\n│   └── implementation-plan/SKILL.md     # model-invocable, writes NN-implementation-plan.md (needs-human)\n├── workflows/\n│   ├── feature-delivery.md              # mermaid, steps, conditions, parallel, gates, retry policy\n│   └── examples/feature-patient-pagination/01-requirements.md .. 09-run-report.md\n└── .ai-sdlc/runs/<today>-feat-patient-pagination/   # produced by your run (git-ignored)",
   "implementation": [
    {"path": "AI-SDLC/.claude/skills/feature/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/skills/requirements/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/skills/implementation-plan/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/workflows/feature-delivery.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ] + [{"path": EX + n, "language": "markdown", "content": "", "tag": "illustrative"} for n in EXAMPLES],
   "exampleInput": "cd AI-SDLC\ngit switch -c feat/PAT-142-patient-pagination\nclaude --agent orchestrator --settings workflows/gates.settings.json\n# in the session:\n/feature PAT-142 Paginate GET /fhir/Patient search with _count (default 20, max 100) and _offset, Bundle.total = all matches, Bundle.link self/next",
   "expectedOutput": "Run 2026-09-30-feat-patient-pagination started (.ai-sdlc/runs/.active written).\n01 requirements: complete (AC-1..AC-6).\n02 architect: complete (ARC-1 medium: Bundle.total counts the page, ARC-2 medium: add Pageable variant, ARC-3 low).\n03 implementation plan: needs-human. 6 steps, security scope YES (api/). Launching developer for step 04.\n\n  Allow Agent(developer)? \"Gate G1: the human approved 03-implementation-plan.md by accepting this launch. Run 2026-09-30-feat-patient-pagination, step 04 ...\"  [Yes] [No]\n\n04 developer: complete. Tests run: 27, Failures: 0. Artifacts include sample-app/src/main/java/org/example/fhir/api/PatientController.java, so security runs.\nLaunching tester (05) and security (06) in parallel.\n05 tester: blocked. TST-1 high: PatientApiTest.searchPageTotalCountsAllMatches expected:<25> but was:<20>.\n06 security: complete. SEC-1 medium: _offset has no upper bound.\n\nG2 needs-human: TST-1 (high) blocks; SEC-1 (medium) needs a fix-or-ticket decision. Fix both now?\n> fix both\n  Allow Agent(developer)? [Yes]\n07 developer: complete. Tests run: 32, Failures: 0.\n08 reviewer: complete. CR-1 low, CR-2 info. No blocking findings.\n09 run report written. .active set to none.\nNext (G3): open a PR from feat/PAT-142-patient-pagination and review it with .ai-sdlc/runs/2026-09-30-feat-patient-pagination/.",
   "testCases": [
    {"name": "Every handoff in your run is valid", "input": "node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/$(date +%F)-feat-patient-pagination; echo exit=$?", "expected": "PASS for every file (01 through the run report), exit=0"},
    {"name": "Example run is valid and complete", "input": "node .claude/hooks/check-handoff.mjs workflows/examples/feature-patient-pagination | grep -c PASS", "expected": "9"},
    {"name": "Run ended cleanly", "input": "cat .ai-sdlc/runs/.active && grep -h '^next:' .ai-sdlc/runs/$(date +%F)-feat-patient-pagination/*-run-report.md", "expected": "none\nnext: human"},
    {"name": "Orchestrator wrote nothing outside the run folder", "input": "git status --short | grep -v '^.. sample-app/'", "expected": "No output: only the developer and tester changed files, all under sample-app/ (.ai-sdlc/ is git-ignored)."},
    {"name": "G1 rejection stops the run", "input": "Start a new run with /feature PAT-150 Add _sort to Patient search, and answer No to the Agent(developer) prompt", "expected": "The run folder contains 01, 02 and 03 (status needs-human) and no 04-developer.md; the orchestrator asks what to change in 01 or 03."},
    {"name": "Entry point is user-only", "input": "grep -E '^(disable-model-invocation|argument-hint):' .claude/skills/feature/SKILL.md", "expected": "disable-model-invocation: true\nargument-hint: \"[ticket-id] [short feature summary]\""},
    {"name": "Sample app still green after the run", "input": "cd sample-app && mvn -q -B test; echo exit=$?", "expected": "exit=0 with more than 25 tests (the reference run ends at 32)."}
   ],
   "evaluationCriteria": [
    "Every step in the run report maps to exactly one spec step, run or skipped with a reason.",
    "Tester and security were launched in the same turn, and G2 was evaluated after both returned.",
    "Every developer launch (first and rework) went through an accepted Agent(developer) prompt.",
    "Handoffs pass check-handoff.mjs and contain no PHI (synthetic MRNs only).",
    "The final diff satisfies AC-1..AC-6 of 01-requirements.md, each proven by a named test."
   ],
   "improvements": [
    "Feed step 01 from `/ticket-intake PAT-142` (module 06) so requirements come from the real ticket through MCP with PHI redaction.",
    "Run the planning half headless (`claude --agent orchestrator -p \"/feature ...\" --max-budget-usd 3`) and stop at G1; continue interactively.",
    "Add a golden workflow task to `evaluations/` that replays the example run folder and scores gate decisions (module 09)."
   ]},
  {"id": "08-handoff-hook",
   "title": "Enforce the handoff format with a SubagentStop hook",
   "objective": "Build `check-handoff.mjs`, a SubagentStop hook that validates the latest handoff (inline final message, `HANDOFF:` pointer, or the agent's newest file in the active run) and exits 2 with reasons when it is invalid, plus a test script that runs it as a subprocess with real SubagentStop payloads. Run the tests, then feed it an invalid reviewer handoff by hand and read the reasons it gives the subagent.",
   "startingFiles": [
    {"path": "AI-SDLC/workflows/examples/hook-payloads/reviewer-invalid.json", "content": f("AI-SDLC/workflows/examples/hook-payloads/reviewer-invalid.json")}
   ],
   "requiredStructure": "AI-SDLC/.claude/hooks/\n├── check-handoff.mjs          # hook mode (stdin JSON) and CLI mode (files or run folders)\n└── check-handoff.test.mjs     # 25 cases incl. every example handoff\nRegistered for SubagentStop, matcher \"architect|developer|reviewer|tester|security|sre\", in:\n  .claude/agents/orchestrator.md (hooks)\n  .claude/skills/{feature,bug-fix,incident}/SKILL.md (hooks)",
   "implementation": [
    {"path": "AI-SDLC/.claude/hooks/check-handoff.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/.claude/hooks/check-handoff.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode .claude/hooks/check-handoff.test.mjs\n# manual run against a scratch project with an active run:\nDEMO=$(mktemp -d); R=$DEMO/.ai-sdlc/runs/2026-09-30-feat-patient-pagination; mkdir -p $R\ncp workflows/examples/feature-patient-pagination/0[1-7]*.md $R/ && echo 2026-09-30-feat-patient-pagination > $DEMO/.ai-sdlc/runs/.active\nCLAUDE_PROJECT_DIR=$DEMO node .claude/hooks/check-handoff.mjs < workflows/examples/hook-payloads/reviewer-invalid.json; echo exit=$?",
   "expectedOutput": "PASS  CLI: every example handoff in workflows/examples/feature-patient-pagination is valid (exit 0, expected 0)\nPASS  built-in Explore subagent is ignored (exit 0, expected 0)\nPASS  valid inline reviewer handoff passes (exit 0, expected 0)\nPASS  active run but no handoff in the final message is blocked (exit 2, expected 2)\nPASS  invalid status value is blocked (exit 2, expected 2)\nPASS  developer that wrote its own valid file (no inline, no pointer) passes via the latest-file fallback (exit 0, expected 0)\nPASS  HANDOFF pointer outside .ai-sdlc/runs is blocked (exit 2, expected 2)\n(18 more PASS lines)\n\n25/25 passed\n\nHandoff check failed for subagent \"reviewer\" (inline handoff in final message):\n- status \"approved\" must be one of complete | blocked | needs-human\n- section \"## Open questions\" is missing\n- findings table is missing column(s): category, evidence (expected id | severity | category | location | evidence | recommendation)\n- finding \"CR-1\" has severity \"minor\"; use one of critical|high|medium|low|info\nFix the handoff and end your final message with the complete handoff document (front matter + ## Summary, ## Findings, ## Decisions, ## Open questions, ## Artifacts) as defined in workflows/README.md.\nexit=2",
   "testCases": [
    {"name": "Test suite passes", "input": "node .claude/hooks/check-handoff.test.mjs | tail -1; echo exit=$?", "expected": "25/25 passed\nexit=0"},
    {"name": "Invalid reviewer handoff is blocked with exit 2", "input": "The manual run in exampleInput", "expected": "Four reasons on stderr (status, missing Open questions, missing columns, severity) and exit=2"},
    {"name": "Non-roster agents pass through", "input": "echo '{\"hook_event_name\":\"SubagentStop\",\"agent_type\":\"Explore\",\"last_assistant_message\":\"done\"}' | node .claude/hooks/check-handoff.mjs; echo exit=$?", "expected": "exit=0 (built-in agents are not workflow steps)"},
    {"name": "CLI validates a run folder", "input": "node .claude/hooks/check-handoff.mjs workflows/examples/feature-patient-pagination | tail -1; echo exit=$?", "expected": "PASS  workflows/examples/feature-patient-pagination/09-run-report.md\nexit=0"},
    {"name": "Hook is registered where the workflow runs", "input": "grep -l 'check-handoff.mjs' .claude/agents/orchestrator.md .claude/skills/*/SKILL.md", "expected": ".claude/agents/orchestrator.md\n.claude/skills/bug-fix/SKILL.md\n.claude/skills/feature/SKILL.md\n.claude/skills/incident/SKILL.md"},
    {"name": "Live: an agent is forced to fix its handoff", "input": "In a /feature run, ask the reviewer (via the orchestrator task message) to use status `approved`; watch the subagent transcript under ~/.claude/projects/*/*/subagents/", "expected": "The transcript shows the hook reason `status \"approved\" must be one of complete | blocked | needs-human`, followed by a corrected handoff with `status: complete`; 08-reviewer.md passes the CLI check."}
   ],
   "evaluationCriteria": [
    "Blocks only with exit 2 (the only exit code that blocks SubagentStop); malformed stdin exits 1 so a broken payload never wedges a run.",
    "Every reason names the field and the allowed values, so the subagent can fix it without guessing.",
    "Does not enforce anything outside an active run, so ad-hoc roster use keeps working.",
    "Tests run the hook as a subprocess with SubagentStop-shaped JSON, not by importing internals only.",
    "Zero dependencies, Node 22 ESM."
   ],
   "improvements": [
    "Return `{\"decision\": \"block\", \"reason\": ...}` JSON on stdout instead of stderr, the documented alternative to exit 2 for SubagentStop.",
    "Add a PHI check: reject MRN-shaped values that are not in the synthetic `MRN-000xxx` range.",
    "Ask module 10 to register the same handler in `.claude/settings.json` so it also covers sessions that start a run without the skills."
   ]},
  {"id": "08-bugfix-and-incident",
   "title": "Add the bug-fix and incident workflows on the same orchestrator",
   "objective": "Write the `bug-fix` and `incident` entry-point skills and their workflow specs, reusing the orchestrator, handoff format, hook and gates unchanged. Run `/incident` against the sample app's real `lastn` latency problem, confirm that security is skipped with a recorded reason and that mitigation is left to a human, then hand the fix to `/bug-fix`.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/\n├── .claude/skills/\n│   ├── bug-fix/SKILL.md          # disable-model-invocation: true, argument-hint \"[bug-id] [observed behaviour]\"\n│   └── incident/SKILL.md         # disable-model-invocation: true, argument-hint \"[incident-id] [symptom and time window]\"\n└── workflows/\n    ├── bug-fix.md                # conditional architect, failing test first, parallel tester + security\n    └── incident-response.md      # sre + conditional security in parallel, human mitigation gate, handover to /bug-fix",
   "implementation": [
    {"path": "AI-SDLC/.claude/skills/bug-fix/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/skills/incident/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/workflows/bug-fix.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/workflows/incident-response.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude --agent orchestrator --settings workflows/gates.settings.json\n# in the session:\n/incident INC-311 p95 latency on GET /fhir/Observation/$lastn above 2s since 14:05 UTC with subjects=1..200, error rate normal, no deploy since yesterday",
   "expectedOutput": "Run 2026-09-30-inc-lastn-latency started.\n01 incident brief: complete. Symptom latency only; no 401/403 anomaly, no exposure -> 03 security: skipped (latency with normal error rate).\n02 sre: complete.\n| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| RCA-1 | high | performance | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69 | `for (Long subjectId : subjectIds) {` with `patients.findById(subjectId)` and `observations.findByPatientIdOrderByEffectiveDateTimeDesc(patient.getId())` per subject (marker TEACHING-DEFECT(perf-n+1), line 64) | Mitigate now: cap `subjects` at the ingress (e.g. 20). Fix: one set-based query with `WHERE patient_id IN (:ids)`. Prevent: query-count test for 1 vs 50 subjects. |\n\nG-M needs-human: choose a mitigation and run it yourself (sre and I cannot change the cluster). Options: (a) ingress limit on subjects, (b) scale replicas 2 -> 4 (does not fix DB round trips).\n> applied (a) at 15:02 UTC, p95 now 180 ms\n04 sre: complete. Hypothesis confirmed: statements per request fell from ~400 to ~40 after the cap.\n05 bug-fix handover: /bug-fix BUG-58 lastn issues two SQL statements per subject (evidence RCA-1, 04-sre.md)\n06 postmortem: complete (action items: set-based query, query-count test, alert on p95 > 500 ms).\n07 run report written. .active set to none.",
   "testCases": [
    {"name": "Entry points are user-only with hints", "input": "grep -hE '^(name|disable-model-invocation|argument-hint):' .claude/skills/bug-fix/SKILL.md .claude/skills/incident/SKILL.md", "expected": "name: bug-fix\ndisable-model-invocation: true\nargument-hint: \"[bug-id] [observed behaviour]\"\nname: incident\ndisable-model-invocation: true\nargument-hint: \"[incident-id] [symptom and time window]\""},
    {"name": "Security skip is recorded", "input": "grep -i 'security' .ai-sdlc/runs/$(date +%F)-inc-*/*-run-report.md", "expected": "A line stating 03 security was skipped with the reason (latency symptom, no auth anomaly or exposure)."},
    {"name": "No cluster change by an agent", "input": "Search the session transcript for kubectl commands run by sre", "expected": "Only read-only commands (kubectl get, describe, logs, top, rollout status); no apply, delete, scale or rollout undo. The mitigation was reported by the human."},
    {"name": "Run folder valid", "input": "node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/$(date +%F)-inc-*; echo exit=$?", "expected": "PASS for every file, exit=0"},
    {"name": "Bug-fix refuses a non-reproducible bug", "input": "/bug-fix BUG-57 Family search ignores trailing spaces only when identifier is also given", "expected": "04-developer.md (or 03 plan) is `blocked` with \"cannot reproduce\": PatientService.search already trims family in both branches; no production code changed."},
    {"name": "Teaching defect guarded", "input": "/bug-fix BUG-59 Observation search returns 500 for code with spaces", "expected": "The plan does not touch ObservationService.lastN or the TEACHING-DEFECT(perf-n+1) marker (CLAUDE.md rule 6)."}
   ],
   "evaluationCriteria": [
    "Both skills reuse the orchestrator procedure and hook; no workflow-specific logic was added to orchestrator.md.",
    "Each spec has a mermaid diagram, a steps table with agent, inputs, outputs and gate per step, conditional branches, and a failure and retry table.",
    "The incident workflow never gives an agent a production-changing command; mitigation is a human action recorded in the handoff.",
    "The bug-fix spec requires a red-then-green regression test and treats \"cannot reproduce\" as a valid outcome."
   ],
   "improvements": [
    "Add `/dependency-upgrade` as a fourth workflow (spec + entry-point skill) to prove the orchestrator is workflow-agnostic.",
    "Pull incident metrics through a read-only MCP server (module 06) instead of pasted output.",
    "Attach the postmortem to the incident ticket through the ticket MCP server behind an outbound ask gate (module 10)."
   ]}
 ],
 "agentContracts": [contract],
 "checklist": [
  "`.claude/agents/orchestrator.md` lists `Agent(architect, developer, reviewer, tester, security, sre)`, Read, Write, Grep, Glob, Skill and no Edit or Bash.",
  "`node docs/foundations/validate-contract.mjs agents/orchestrator/CONTRACT.md` prints 11/11 sections.",
  "`workflows/README.md` defines the handoff front matter, file naming, the `.active` marker and who writes each handoff.",
  "`workflows/gates.settings.json` contains `ask: [\"Agent(developer)\"]`, and every developer launch in your run showed the prompt.",
  "`feature`, `bug-fix` and `incident` skills have `disable-model-invocation: true`, an `argument-hint`, and the SubagentStop hook.",
  "`requirements` and `implementation-plan` skills are model-invocable and produce handoffs that pass the hook.",
  "Each workflow spec has a mermaid diagram, per-step agent/inputs/outputs/gate, conditional branches, a parallel step, and a failure and retry table.",
  "`node .claude/hooks/check-handoff.test.mjs` passes 25/25.",
  "`node .claude/hooks/check-handoff.mjs workflows/examples/feature-patient-pagination` passes all 9 files.",
  "A completed `/feature` run folder validates, ends with `next: human`, and leaves `.ai-sdlc/runs/.active` as `none`.",
  "No agent pushed, merged, or changed the cluster; the PR review is still pending for a human."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/08-workflow-orchestration.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
