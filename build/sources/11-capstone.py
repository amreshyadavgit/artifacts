# Generator for content/modules/11-capstone.json. Run: python3 build/sources/11-capstone.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

RUN = "AI-SDLC/docs/capstone/example-runs/incident-lastn-latency/"

component_rows = [
 ["`CLAUDE.md`, `.claude/rules/`", "project memory and path-scoped Java rules", "00-example", "verified-format"],
 ["`context/**`", "architecture, standards, security, domain and PHI context pack", "00-example", "illustrative"],
 ["`agents/CONTRACT_TEMPLATE.md`, `docs/foundations/`", "Agent Contract template, anatomy and primitive exercises", "01-foundations", "illustrative"],
 ["`evaluations/agent-versions/reviewer-v1.md`", "first agent, frozen as the v1 snapshot", "02-first-agent-skill-tools", "verified-format"],
 ["`.claude/skills/explain-endpoint/`, `run-tests/`", "first skills and the Surefire summary script", "02-first-agent-skill-tools", "verified-format (SKILL.md), illustrative (scripts)"],
 ["`.claude/skills/architecture-review/`, `code-review/`, `test-strategy/` + `skills/<name>/`", "review skills preloaded by architect, reviewer, tester, with golden cases", "03-skills-architecture-code-test", "verified-format (SKILL.md), illustrative (assets)"],
 ["`.claude/skills/security-review/`, `performance-review/`, `production-rca/` + `skills/<name>/`", "security, performance and RCA skills, the INC-2026-0922-01 evidence pack", "04-skills-security-performance-rca", "verified-format (SKILL.md), illustrative (assets)"],
 ["`.claude/agents/{architect,developer,reviewer,tester,security,sre}.md`", "the six specialists", "05-agent-roster", "verified-format"],
 ["`agents/<name>/CONTRACT.md`, `agents/tool-guard.mjs`, `agents/check-agents.mjs`", "contracts, per-agent write/Bash guard, conformance checker", "05-agent-roster", "illustrative"],
 ["`.mcp.json`, `mcp/`, `ticket-intake`, `scripts/automation/`", "MCP servers, PHI-safe FHIR server, Jira intake, deterministic gates", "06-mcp-and-tooling-architecture", "verified-format (.mcp.json, SKILL.md), illustrative (rest)"],
 ["`workflows/composition/`", "execution modes and nesting limits", "07-agent-composition", "illustrative"],
 ["`.claude/agents/orchestrator.md`, `feature`/`bug-fix`/`incident` skills, `workflows/`, `check-handoff.mjs`", "main-thread orchestrator, entry points, specs, handoff hook", "08-workflow-orchestration", "verified-format (agent, skills, gates.settings.json), illustrative (specs, hook script)"],
 ["`evaluations/`", "golden tasks, harness, rubrics, synthetic recordings, reports", "09-agent-evaluation", "illustrative"],
 ["`.claude/settings.json`, `.claude/hooks/`, `docs/governance/`, `company-ai/`, `scripts/governance/`", "permissions, hooks, gates, plugin packaging, policy validators", "10-governance", "verified-format (settings, plugin.json), illustrative (rest)"],
 ["`README.md`, `docs/capstone/`, `scripts/capstone/`", "entry point, component map, walkthroughs, verify-system, stack inventory", "11-capstone", "illustrative"],
 ["`sample-app/`", "the FHIR-lite API the agents work on", "shared", "not a Claude Code file"],
]

verify_before = """STATUS  CHECK          DETAIL
PASS    roster         architect: agent file + agents/architect/CONTRACT.md
PASS    roster         orchestrator: agent file + agents/orchestrator/CONTRACT.md
PASS    delegation     orchestrator delegates to exactly the six specialists
PASS    delegation     no specialist can spawn subagents (roster is flat)
PASS    agent-skills   sre: performance-review, production-rca
PASS    settings       valid JSON, 2 hook event(s), 3 hook script path(s) exist
PASS    hook-paths     11 frontmatter hook script reference(s) in 21 agent/skill files exist
PASS    gate-settings  workflows/gates.settings.json asks before every Agent(developer) launch (G1)
PASS    mcp            valid JSON, servers: github, atlassian, fhir-readonly
PASS    workflows      workflows/incident-response.md: 8 step row(s), roster agents and existing skills only
PASS    claude-md      3 @import(s) resolve; 33 lines
PASS    guard-reach    developer: run-tests/scripts/summarize-surefire.mjs allowed by its Bash guard
WARN    guard-reach    sre: performance-review invokes scripts/count-queries.mjs as ${CLAUDE_SKILL_DIR}/scripts/count-queries.mjs; the guard prefix "node .claude/skills/performance-review/scripts/count-queries.mjs" is relative and matched literally, so the call passes only if the agent runs the relative form
FAIL    guard-reach    sre: preloaded skill production-rca runs production-rca/scripts/build-timeline.mjs, but sre's tool-guard bash-allow list has no "node .claude/skills/production-rca/scripts/build-timeline.mjs" prefix, so the PreToolUse hook blocks it (exit 2)
PASS    handoffs       workflows/examples/feature-patient-pagination: 9 handoff(s) valid
PASS    handoffs       docs/capstone/example-runs/incident-lastn-latency: 8 handoff(s) valid
PASS    eval-replay    architecture architect-v2 pass 18/20 recall 98.7% precision 94.2% halluc 0.0% tool-viol 0 cost $5.870 gates PASS | reviewer reviewer-v2 pass 7/8 recall 95.2% precision 100.0% halluc 0.0% tool-viol 0 cost $1.100 gates PASS
PASS    sub-checkers   agents/check-agents.mjs: agent contracts (module 05)
PASS    sub-checkers   scripts/automation/check-mcp-config.mjs: .mcp.json lint (module 06)

verify-system: 36 pass, 1 warn, 1 fail, 0 skip -> NOT WIRED      (exit 1)

After adding 'node .claude/skills/production-rca/scripts/build-timeline.mjs' to the sre bash-allow list
and letting tool-guard.mjs map ${CLAUDE_SKILL_DIR}-expanded absolute paths inside the project to relative form
(the state this repository ships in):
PASS    guard-reach    sre: performance-review/scripts/count-queries.mjs allowed by its Bash guard (relative and ${CLAUDE_SKILL_DIR} forms)
PASS    guard-reach    sre: production-rca/scripts/build-timeline.mjs allowed by its Bash guard (relative and ${CLAUDE_SKILL_DIR} forms)
verify-system: 38 pass, 0 warn, 0 fail, 0 skip -> WIRED          (exit 0)"""

mod = {
 "id": "11-capstone",
 "level": 9,
 "title": "Capstone: Build My Personal AI-SDLC Engineering System",
 "summary": "Assemble everything from modules 00 to 10 into one system you can run and trust: see how every folder in AI-SDLC/ fits together and which parts are verified Claude Code formats, prove the wiring with a single zero-dependency check that also finds a real seam between an agent's Bash guard and its preloaded skill, trace one feature (PAT-142 paging) and one production incident ($lastn latency with probe restarts) through the orchestrator, every agent and every human gate, and finish by moving the system to your own stack and domain with a measured checklist.",
 "prerequisites": ["08-workflow-orchestration", "09-agent-evaluation", "10-governance", "05-agent-roster", "04-skills-security-performance-rca", "Node 22, Java 21, Maven 3.9, an authenticated Claude Code CLI"],
 "concepts": [
  {"heading": "One system, seven layers",
   "body_md": "Each earlier module built one layer. The capstone is about the seams between them, because that is where a working set of parts stops being a working system.\n\n| Layer | Files | Question it answers |\n|---|---|---|\n| Knowledge | `CLAUDE.md`, `.claude/rules/`, `context/**` | What does every agent know without asking? |\n| Capability | `.claude/skills/**`, `.mcp.json`, `mcp/` | What procedures and tools exist? |\n| Actors | `.claude/agents/*.md`, `agents/*/CONTRACT.md` | Who may do what, with which model and tools? |\n| Sequencing | `orchestrator.md`, entry-point skills, `workflows/*.md` | In which order, with which conditions and retries? |\n| Enforcement | `.claude/settings.json`, `.claude/hooks/`, `agents/tool-guard.mjs`, `workflows/gates.settings.json` | What is blocked, asked, or checked on every call? |\n| Measurement | `evaluations/`, `skills/*/tests/` | Did a change make an agent or skill better or worse? |\n| Governance | `docs/governance/`, `scripts/governance/`, `company-ai/` | Who approves changes to all of the above? |\n\nThe layers reference each other by **name and path**, and nothing in Claude Code checks those references for you. An agent's `skills:` entry that names a missing skill, a hook command that points at a moved script, or a workflow step that names an agent the orchestrator cannot spawn all fail silently or at the worst moment: unknown frontmatter fields are ignored, and a hook script that does not exist is a non-blocking error, not a blocked call. So in practice the system needs a check of its own seams, run in CI and before every workflow run. That is `scripts/capstone/verify-system.mjs` (exercise `11-verify-system`)."},
  {"heading": "The orchestrator and its human gates, reconciled",
   "body_md": "Module 08 built the orchestrator and its contract (see `08-workflow-orchestration` and `agents/orchestrator/CONTRACT.md`; this module adds no new contract). It runs as the **main thread**: `claude --agent orchestrator --settings workflows/gates.settings.json`. Two facts from the docs carry the design: the `Agent(architect, developer, reviewer, tester, security, sre)` list in its `tools` is enforced only because it is the main-thread agent, and the roster agents omit `Agent` so the tree stays one level deep.\n\nModule 08 numbers workflow gates G1 to G3 (plus G-M for incidents); module 10 numbers governance layers G1 to G8. They are the same controls from two sides:\n\n- **G1 plan approval** = the `ask` rule on `Agent(developer)` in `workflows/gates.settings.json`. Every developer launch, including each rework, is a permission prompt.\n- **G2 findings** = the orchestrator stopping with `status: needs-human`. This one is a **prompt instruction, not a built-in feature**. Its mechanical backstop is the next `Agent(developer)` prompt and the PR review.\n- **G-M mitigation** = nobody but a human changes production: the orchestrator has no Bash, the sre's `tool-guard.mjs` always denies mutating `kubectl`, `kubectl apply` is `ask`, `kubectl delete` is `deny`.\n- **G3 merge** = PR review under branch protection and CODEOWNERS (module 10 G6/G7); `git push` is `ask`, `gh pr merge` is `deny`.\n\nRun gated workflows in `default` permission mode. In `dontAsk` every `ask` becomes a denial, so a headless run stops at G1 by design. Explicit `ask` rules are on the docs' list of actions **no mode auto-approves**, so the `Agent(developer)` prompt still appears in `acceptEdits`, `auto` and even `bypassPermissions`; what `bypassPermissions` does remove is every prompt that is not an explicit rule, which is why module 10's managed settings disable it (see the mode table in `docs/governance/approval-gates.md`). Knowing which gate is a mechanism and which is a convention is the most important thing to be able to say about your own system."},
  {"heading": "Tracing a feature: PAT-142 through every layer",
   "body_md": "The committed run `workflows/examples/feature-patient-pagination/` (module 08) shows the handoffs. The capstone view (`docs/capstone/walkthrough-feature.md`) adds what acts at each moment:\n\n1. **Before**: clean tree, `verify-system.mjs` WIRED, eval replay green for the two evaluated agents this run uses (architect at step 02, reviewer at step 08).\n2. **`/feature PAT-142 ...`**: the skill is `disable-model-invocation: true` (only you start it), registers the `SubagentStop` handoff hook, injects `git status --short`.\n3. **01 to 03**: orchestrator skills and the architect write the requirements, ADR-0002 draft and plan. `block-secrets.mjs` scans each Write; the hook validates each specialist's handoff.\n4. **G1**: a permission prompt for `Agent` with `subagent_type: developer`. You read 01 to 03 first.\n5. **04 to 06**: the developer is scoped by `tool-guard.mjs` to `sample-app/src/` and `.ai-sdlc/runs/`; tester and security run in the same turn; TST-1 (high) blocks.\n6. **G2**: you decide \"fix TST-1 and SEC-1\"; the rework is another G1 prompt.\n7. **08 to 09**: reviewer returns findings inline (no Write), run report ends `next: human`.\n8. **G3**: you push and open the PR. Only `sample-app/` changed, so the AI-config gate passes and normal code-owner review applies.\n\nEvals and governance apply differently: governance (hooks, rules) acts on **every tool call of every run**; evaluation acts on **changes to the system** (a new reviewer prompt must pass replay and a live comparison before its PR merges)."},
  {"heading": "Tracing an incident: no agent changes production",
   "body_md": "The incident run (`docs/capstone/example-runs/incident-lastn-latency/`) replays INC-2026-0922-01 from the production-rca evidence pack. Clinic C-017's new ward dashboard sent `$lastn` for 512 subjects every 30 s; `ObservationService.lastN` (`TEACHING-DEFECT(perf-n+1)`, lines 69 to 74) runs two statements per subject and loads full histories, so one request was about 1,024 statements and 209,000 rows; pods saturated, the 1 s probes failed, Kubernetes restarted the pods into the same load.\n\nWhat the system does, step by step:\n\n- **01 brief**: the orchestrator strips the one patient named in the on-call report and decides that **security runs**: the logs show `GlobalExceptionHandler` ERROR lines, and D-04 in `KNOWN_DEFECTS.md` says that handler can log submitted values. Possible data exposure is the spec's condition.\n- **02 sre + 03 security in parallel**: sre runs the `build-timeline.mjs` PHI guard (exit 0), ranks five hypotheses, offers M1 (dashboard off), M2 (ingress limit), M3 (scale out, low confidence). Security finds no PHI in the pool-timeout exceptions and flags the shared `clinician` account.\n- **G-M round 1**: the human scales to 4 from their own terminal. **04** verifies: not resolved.\n- **G-M round 2** (the last one the spec allows): the dashboard refresh is disabled. **05** verifies recovery and confirms H1 with `pg_stat_statements` (431,616 calls = 843 requests x 512 subjects).\n- **06** hands the code fix to `/bug-fix FHIR-311`, a separate run with its own G1 to G3. **07** postmortem is `needs-human` until signed off.\n\nThe retry shows the numbering rule from `workflows/README.md`: a repeated step takes the next free number, so the spec's 05/06 became 06/07."},
  {"heading": "Verifying the wiring: checks at the seams",
   "body_md": "Every module shipped a checker for its own layer: `check-agents.mjs` (contracts), `check-roster-flat.mjs` (topology), `check-mcp-config.mjs`, `check-agent-policy.mjs`, `validate-skill-library.mjs`, `check-handoff.mjs`, the eval harness. `verify-system.mjs` runs all of them and adds the cross-layer checks none of them owns:\n\n- every `skills:` entry of every agent resolves to a `.claude/skills/<name>/SKILL.md` that can be preloaded (not `disable-model-invocation: true`);\n- every hook script path in `settings.json` **and** in agent and skill frontmatter exists; every hook event is a documented event;\n- `workflows/gates.settings.json` really asks before `Agent(developer)`, and every `Agent(...)` rule names a real agent;\n- workflow step tables name only roster agents and existing skills;\n- CLAUDE.md `@imports` resolve (outside code spans, up to 4 hops);\n- **guard reach**: each script a preloaded skill tells an agent to run is inside that agent's `tool-guard.mjs bash-allow` list.\n\nThe last check found a real defect while this module was written. `production-rca` step 1 tells the sre to run `build-timeline.mjs` (the PHI guard), but the sre's Bash guard in `.claude/agents/sre.md` allows only `count-queries.mjs` among the node scripts. Each part passes its own checker; together the sre cannot start an RCA without being blocked with exit 2. A second, softer seam was reported as WARN: skills invoke scripts as `${CLAUDE_SKILL_DIR}/scripts/...`, which Claude Code expands to the skill's directory, while the guard matched a relative prefix literally. The shipped fix adds the missing prefix to `sre.md` and makes `tool-guard.mjs` rewrite absolute paths inside the project to relative form before matching, so both forms pass and verify-system reports WIRED with no warnings.\n\nSo in practice: run `verify-system.mjs` in CI next to `mvn -q -B test`, and treat a FAIL row as a broken build."},
  {"heading": "Personalizing: what carries over and what does not",
   "body_md": "Moving the system to another service is mostly a knowledge and command swap, not a redesign.\n\n**Carries over unchanged**: the seven roles and their separation of duties, the handoff format and `check-handoff.mjs`, the orchestrator and its gate rules, `tool-guard.mjs` (only its arguments change), the governance hooks, the eval harness and scoring, `verify-system.mjs`.\n\n**Must change**, in this order (`docs/capstone/personalize-checklist.md`):\n\n1. `CLAUDE.md` commands and layout, and the path-scoped rule's `paths` glob.\n2. `context/**`: glossary, PHI table, standards for the new framework.\n3. Agent Bash guards and write scopes (`pytest -q` instead of `mvn -q -B test`), bodies that name classes, contracts that must list the same tools.\n4. Skill procedures and their tooling maps; each skill's golden cases.\n5. Workflow security-scoped path lists, settings allow rules, MCP servers.\n6. Eval datasets: new golden tasks against the new code, synthetic recordings deleted, one live recording per suite.\n\n`scripts/capstone/stack-inventory.mjs` makes this measurable: it lists every file outside the app that mentions the old stack, domain or platform terms, per component, and `--max N` turns \"are we done?\" into an exit code. Evaluation is the last step for a reason: golden tasks written before the context pack and agents are updated would measure the old system."}
 ],
 "diagrams": [
  {"title": "Component map: how the layers reference each other",
   "mermaid": "flowchart TD\n  H[\"Human in the terminal\"] -->|\"claude --agent orchestrator\"| O[\"orchestrator (main thread)\"]\n  H -->|\"/feature, /bug-fix, /incident\"| EP[\"entry-point skills\"]\n  EP --> O\n  O -->|\"reads\"| WF[\"workflows/*.md\"]\n  O -->|\"Agent(...) allowlist\"| R[\"six specialists<br/>.claude/agents/*.md\"]\n  R -->|\"skills: preloaded\"| SK[\".claude/skills/*/SKILL.md\"]\n  R -->|\"handoff\"| HO[\".ai-sdlc/runs/RUN-ID/NN-agent.md\"]\n  HO -->|\"SubagentStop\"| CH[\"check-handoff.mjs (exit 2)\"]\n  CM[\"CLAUDE.md + context/**\"] -->|\"loaded into every agent\"| R\n  ST[\"settings.json rules + hooks\"] -->|\"every tool call\"| R\n  TG[\"tool-guard.mjs\"] -->|\"per-agent PreToolUse\"| R\n  EV[\"evaluations/\"] -->|\"gates agent changes\"| R\n  V[\"verify-system.mjs\"] -.->|\"checks every arrow\"| O"},
  {"title": "Incident INC-2026-0922-01 through the system",
   "mermaid": "sequenceDiagram\n  participant H as \"On-call human\"\n  participant O as \"orchestrator\"\n  participant S as \"sre\"\n  participant X as \"security\"\n  participant K as \"check-handoff.mjs\"\n  H->>O: \"/incident INC-2026-0922-01 ...\"\n  O->>O: \"01-incident-brief.md (identifiers stripped)\"\n  par \"parallel\"\n    O->>S: \"02 RCA (production-rca, performance-review)\"\n    S-->>K: \"SubagentStop: inline handoff\"\n    K-->>O: \"exit 0\"\n  and\n    O->>X: \"03 exposure triage (security-review)\"\n    X-->>K: \"SubagentStop: inline handoff\"\n    K-->>O: \"exit 0\"\n  end\n  O-->>H: \"needs-human: pick M1, M2 or M3\"\n  H->>H: \"08:17 kubectl scale (own terminal)\"\n  O->>S: \"04 verify: not resolved\"\n  O-->>H: \"needs-human: G-M round 2\"\n  H->>H: \"08:31 dashboard refresh off\"\n  O->>S: \"05 verify: resolved, H1 confirmed\"\n  O->>O: \"06 bug-fix handover\"\n  O->>S: \"07 postmortem\"\n  O-->>H: \"08 run report, next: human\""},
  {"title": "Where a gate is a mechanism and where it is a convention",
   "mermaid": "flowchart LR\n  G1[\"G1 plan approval\"] --> M1[\"ask rule Agent(developer)<br/>mechanism\"]\n  G2[\"G2 findings\"] --> C2[\"orchestrator stops needs-human<br/>convention\"]\n  C2 -.->|\"backstop\"| M1\n  GM[\"G-M mitigation\"] --> M3[\"no Bash + tool-guard deny<br/>+ kubectl ask/deny<br/>mechanism\"]\n  G3[\"G3 merge\"] --> M4[\"PR review, push ask, merge deny<br/>mechanism\"]"}
 ],
 "comparisonTables": [
  {"title": "Component map: folder group, purpose, module, format tag (full table in docs/capstone/README.md)",
   "columns": ["Path", "Purpose", "Built in module", "Tag"],
   "rows": component_rows},
  {"title": "Workflow gates (module 08) vs governance layers (module 10)",
   "columns": ["Workflow gate", "When", "Mechanism", "Mechanism or convention", "Governance layer"],
   "rows": [
    ["G1 plan approval", "every developer launch", "`ask: [\"Agent(developer)\"]` in `workflows/gates.settings.json`", "mechanism (permission prompt)", "G1 plan approval, implemented as a G2-style `ask`"],
    ["G2 findings", "after tester/security and after review", "orchestrator returns `needs-human`", "convention; backstop is the next G1 prompt and the PR", "none"],
    ["G-M mitigation", "incidents, after 02-sre", "orchestrator has no Bash; `tool-guard.mjs` denies mutating `kubectl`; `kubectl apply` ask, `kubectl delete` deny", "mechanism", "G2 risky command, G5 never allowed"],
    ["G3 merge", "end of every run", "PR review, `git push` ask, `gh pr merge` deny", "mechanism", "G6 AI-config PR gate, G7 code PR"],
    ["always on", "every tool call", "`block-secrets`, `guard-outbound`, `flag-injection`, `Edit(./.claude/**)` ask, managed floor", "mechanism (flag-injection is advisory)", "G3, G4, G5, G8"]
   ]},
  {"title": "Personalizing: what carries over and what you rewrite",
   "columns": ["Component", "Carries over", "Rewrite for a new stack/domain", "Check that proves it"],
   "rows": [
    ["Memory", "structure, rules 1, 3-5, 7", "layout, commands, rule 2 and 6, rule-file `paths`", "`verify-system` claude-md row"],
    ["Context", "file layout, PHI policy structure", "glossary, PHI table, standards", "`stack-inventory` context row"],
    ["Agents", "roles, tools per role, models, gates", "Bash guard and write-scope arguments, bodies", "`node agents/check-agents.mjs`, guard-reach row"],
    ["Skills", "procedures' shape, output contracts", "checklists, tooling maps, scripts, golden cases", "`node scripts/governance/validate-skill-library.mjs`"],
    ["Workflows", "steps, gates, retry policy, handoff format", "security-scoped paths, worked inputs", "`verify-system` workflows and handoffs rows"],
    ["Evals", "harness, scoring, gates", "datasets, recordings (live)", "`run-evals.mjs --mode replay` on live recordings"]
   ]}
 ],
 "exercises": [
  {"id": "11-verify-system",
   "title": "Prove the whole system is wired, and fix the seam it finds",
   "objective": "Write `scripts/capstone/verify-system.mjs`, a zero-dependency Node script that checks every cross-layer reference in `AI-SDLC/` (roster files and contracts, flat delegation, preloaded skills, hook script paths in settings and frontmatter, the G1 gate settings, `.mcp.json`, workflow step tables, CLAUDE.md imports, skill scripts reachable under each agent's Bash guard, committed example runs, eval replay, the module checkers) and prints a PASS/WARN/FAIL/SKIP table. Test it against broken fixtures, run it on the real repository, and fix the one FAIL it reports. Write `AI-SDLC/README.md` and `docs/capstone/README.md` so a new engineer can find and run it.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/\n├── README.md                                # entry point: what is here, quickstart, module map, tests/evals/verify\n├── docs/capstone/README.md                  # component map + gate map\n└── scripts/capstone/\n    ├── verify-system.mjs                    # exit 0 WIRED, 1 NOT WIRED, 2 usage\n    └── verify-system.test.mjs               # fixture project, one broken seam per case",
   "implementation": [
    {"path": "AI-SDLC/scripts/capstone/verify-system.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/scripts/capstone/verify-system.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/README.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/capstone/README.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode scripts/capstone/verify-system.mjs; echo \"exit $?\"",
   "expectedOutput": verify_before,
   "testCases": [
    {"name": "Checker's own tests pass", "input": "node scripts/capstone/verify-system.test.mjs", "expected": "22/22 passed, exit 0 (missing contract, name mismatch, missing or non-preloadable skill, Agent in a specialist, orchestrator list missing sre, bad settings JSON, missing hook script, invented event PreCommit, missing tool-guard, gate without Agent(developer), url without type, missing stdio script, qa-bot in a workflow, unknown skill, unresolved @import, unguarded skill script, invalid example handoff, usage error)"},
    {"name": "Real repository before the fix", "input": "Remove the 'node .claude/skills/production-rca/scripts/build-timeline.mjs' entry from the Bash hook in .claude/agents/sre.md (the shipped file already has it), then: node scripts/capstone/verify-system.mjs | grep '^FAIL'", "expected": "Exactly one row: `FAIL    guard-reach    sre: preloaded skill production-rca runs production-rca/scripts/build-timeline.mjs ...`; exit code 1"},
    {"name": "The FAIL is real, not a checker artefact", "input": "echo '{\"tool_name\":\"Bash\",\"agent_type\":\"sre\",\"tool_input\":{\"command\":\"node .claude/skills/production-rca/scripts/build-timeline.mjs .claude/skills/production-rca/examples/INC-2026-0922-lastn/app-logs.log --collapse\"}}' | node agents/tool-guard.mjs bash-allow 'kubectl get' 'node .claude/skills/performance-review/scripts/count-queries.mjs' 'git log'; echo $?", "expected": "stderr `tool-guard [sre] blocked Bash: \"node .claude/skills/production-rca/scripts/build-timeline.mjs ...\" is outside this agent's Bash allowlist`, exit 2"},
    {"name": "After adding the prefix to the sre guard", "input": "node scripts/capstone/verify-system.mjs; echo $?", "expected": "`verify-system: 38 pass, 0 warn, 0 fail, 0 skip -> WIRED` and exit 0 (with the shipped tool-guard.mjs, which also accepts the `${CLAUDE_SKILL_DIR}`-expanded form); `node agents/check-agents.mjs` still exits 0"},
    {"name": "Full run with every repo test", "input": "node scripts/capstone/verify-system.mjs --with-tests | grep -c '^PASS    tests'", "expected": "20 at the time of writing: every *.test.mjs in the repo except the checker's own test (the harness suite runs under node --test); no FAIL rows"},
    {"name": "README quickstart commands exist", "input": "grep -o 'node [a-z./-]*\\.mjs' AI-SDLC/README.md | sort -u | awk '{print $2}' | xargs -I{} test -f AI-SDLC/{} && echo all-present", "expected": "all-present"}
   ],
   "evaluationCriteria": [
    "Every check reads the real file formats (frontmatter `skills:` lists, settings `hooks` event map, `.mcp.json` `mcpServers`) rather than hard-coding this repo's file list.",
    "A missing optional component (no eval harness, no example runs) is SKIP, not FAIL; a missing required one (roster agent, contract, gate settings) is FAIL.",
    "Hook events are checked against the documented event list in FACTS section 4, so `PreCommit` fails.",
    "Every FAIL row names the file and the exact reference that is broken, so the fix is obvious.",
    "The test builds a fixture project and breaks one seam per case; it does not depend on the real repo staying broken.",
    "README.md lets a new engineer run verify, tests, evals and a gated workflow without reading the course."
   ],
   "improvements": [
    "Add `verify-system.mjs` as a required CI check next to `mvn -q -B test` (the `ai-change-gate` workflow in `docs/governance/` is a template).",
    "Parse `allowed-tools` of each preloaded skill and compare it with the agent's permission rules, not only its Bash guard.",
    "Check that every `agents/<name>/CONTRACT.md` names the skills the agent file preloads.",
    "`${CLAUDE_SKILL_DIR}` expands to the skill's directory (docs); for plugin-installed skills that directory is outside the project, so extend the guard with an explicit allow-list of trusted plugin roots and a verify-system check for it."
   ]},
  {"id": "11-feature-run",
   "title": "Run PAT-142 through the whole system and account for every gate",
   "objective": "Run the feature-delivery workflow for PAT-142 (`_count`/`_offset` paging on Patient search) in a fresh branch, with the orchestrator as the main thread, and produce a gate log: for each step, which agent ran, which mechanism fired (hook, permission prompt, orchestrator stop, PR review), and which handoff appeared. Compare your run folder with the committed example in `workflows/examples/feature-patient-pagination/` and explain every difference. Show where evals (module 09) and governance (module 10) acted.",
   "startingFiles": [
    {"path": "AI-SDLC/docs/capstone/gate-log.md", "content": "# Gate log: PAT-142\n\n| step | agent | mechanism that fired | your decision | handoff file |\n|---|---|---|---|---|\n| 00 | none | verify-system.mjs, eval replay | proceed | none |\n"}
   ],
   "requiredStructure": "AI-SDLC/\n├── docs/capstone/walkthrough-feature.md       # reference walkthrough\n├── docs/capstone/gate-log.md                  # your gate log (one row per step and gate)\n└── .ai-sdlc/runs/<today>-feat-patient-pagination/\n    ├── 01-requirements.md ... NN-run-report.md # your run (git-ignored)",
   "implementation": [
    {"path": "AI-SDLC/docs/capstone/walkthrough-feature.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\ngit switch -c feat/pat-142-paging\nnode scripts/capstone/verify-system.mjs && node evaluations/harness/run-evals.mjs --mode replay\nclaude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default\n> /feature PAT-142 Paginate Patient search with _count (default 20, max 100) and _offset",
   "expectedOutput": "[orchestrator] Run 2026-09-30-feat-patient-pagination. 01-requirements.md complete (AC-1..AC-6). 02-architect.md complete: ARC-1 medium (Bundle.total is the list size, Bundle.java:9), ADR-0002 proposed (offset paging, _offset capped at 10000).\n[orchestrator] 03-implementation-plan.md: 6 steps, security scope YES (touches api/). Status needs-human (G1).\n\nAllow Agent (developer)? Gate G1: the human approved 03-implementation-plan.md by accepting this launch.\n  1. Yes   2. No\n> 1\n\n[orchestrator] 04-developer.md complete: Tests run: 27, Failures: 0. Launching 05 tester and 06 security in parallel.\n[orchestrator] G2 stop (needs-human):\n  TST-1 high   PatientController.java:47  Bundle.searchset(...) one-argument overload sets total to page size\n  SEC-1 medium PatientService.java:38     _offset not capped at 10000 (ADR-0002 decision 3)\n  Decide: fix now, or ticket each medium.\n> Fix TST-1 and SEC-1 now.\nAllow Agent (developer)? ...   > 1\n[orchestrator] 07-developer.md complete: Tests run: 32, Failures: 0. 08-reviewer.md: CR-1 low, CR-2 info, verdict APPROVE (no blocking findings).\n[orchestrator] Run folder .ai-sdlc/runs/2026-09-30-feat-patient-pagination/. G3: open the PR from feat/pat-142-paging; no agent pushes.\n\n$ node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-patient-pagination | grep -c PASS\n9",
   "testCases": [
    {"name": "Every handoff of your run is valid", "input": "node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/$(date +%F)-feat-patient-pagination; echo $?", "expected": "One PASS line per file, exit 0"},
    {"name": "G1 fired once per developer launch", "input": "grep -c 'Agent(developer)' AI-SDLC/docs/capstone/gate-log.md; ls .ai-sdlc/runs/*-feat-patient-pagination/ | grep -c developer", "expected": "The two numbers are equal (2 in the reference run: 04 and 07)"},
    {"name": "Only the app changed", "input": "git diff --name-only main...HEAD | grep -v '^AI-SDLC/sample-app/' | wc -l", "expected": "0: no agent touched .claude/, CLAUDE.md or skills/, so the AI-config gate (G6) is not needed; the code-owner review (G7) is"},
    {"name": "Tests pass after the run", "input": "cd AI-SDLC/sample-app && mvn -q -B test", "expected": "exit 0; more than 25 tests (32 in the reference run)"},
    {"name": "No agent pushed", "input": "git log origin/feat/pat-142-paging 2>&1 | head -1", "expected": "`fatal: ambiguous argument` or your own push only: the transcript shows no approved `git push` prompt from an agent"}
   ],
   "evaluationCriteria": [
    "The gate log names a real mechanism for every gate (prompt, hook exit code, `needs-human` stop, PR review) and says which one is a convention (G2).",
    "Every difference from the committed example is explained (different finding ids, a skipped step, a different number of reworks).",
    "The log records which evaluated agents (architect, reviewer) ran and the replay result that cleared them before the run.",
    "The learner answered G1 after reading 01 to 03, not by reflex (the log quotes one detail from the plan)."
   ],
   "improvements": [
    "Save `/usage` before and after the run in the gate log and compare with the default run budget in `docs/governance/model-and-cost-policy.md`.",
    "Add a golden task to `evaluations/datasets/reviewer-golden.json` for any defect the tester caught that the reviewer missed.",
    "Rerun with `/feature` in a plain `claude --settings workflows/gates.settings.json` session and record whether the handoff hook fired the same way (in that mode only the skill's `hooks` registration is active; under `--agent` the orchestrator's frontmatter hook runs too, and identical handlers are deduplicated)."
   ]},
  {"id": "11-incident-run",
   "title": "Take the $lastn latency and probe-restart incident through the system",
   "objective": "Run `/incident` for INC-2026-0922-01 against the production-rca evidence pack, play the on-call human at both mitigation gates, and produce the run folder: incident brief, parallel sre and security triage, two verification steps, the bug-fix handover, the postmortem and the run report. Every handoff must pass `check-handoff.mjs`, cite evidence that existed at the time of the step, and keep PHI out. Compare your postmortem with the golden RCA of the production-rca skill.",
   "startingFiles": [
    {"path": "AI-SDLC/.ai-sdlc/incoming/INC-2026-0922-01-oncall-report.txt", "content": "08:12 UTC on-call report (paste into /incident after removing identifiers)\n- Alert FhirLiteApi5xxRatioHigh fired 08:09.\n- Clinicians report the chart for Patient/41877 (Test Patient, MRN-000123) spins, then 503.\n- Both fhir-lite-api pods restarted at least twice since 08:05.\n- No deploy today. Change calendar: CHG-4471 C-017 history import 06:30-07:41, CHG-4472 C-017 ward dashboard go-live 08:00.\n- Evidence: .claude/skills/production-rca/examples/INC-2026-0922-lastn/\n"}
   ],
   "requiredStructure": "AI-SDLC/docs/capstone/\n├── walkthrough-incident.md\n└── example-runs/incident-lastn-latency/\n    ├── README.md                 # replay framing, numbering note\n    ├── 01-incident-brief.md      # orchestrator\n    ├── 02-sre.md                 # sre, parallel with 03\n    ├── 03-security.md            # security (runs: possible data exposure)\n    ├── 04-sre.md                 # verify after G-M round 1 (not resolved)\n    ├── 05-sre.md                 # verify after G-M round 2 (resolved)\n    ├── 06-bug-fix-handover.md    # orchestrator: exact /bug-fix command\n    ├── 07-postmortem.md          # sre, needs-human\n    └── 08-run-report.md          # orchestrator",
   "implementation": [
    {"path": "AI-SDLC/docs/capstone/walkthrough-incident.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "README.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "01-incident-brief.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "02-sre.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "03-security.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "04-sre.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "05-sre.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "06-bug-fix-handover.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "07-postmortem.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RUN + "08-run-report.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default\n> /incident INC-2026-0922-01 p95 latency on GET /fhir/Observation/$lastn above 30s since 08:01 UTC, 5xx above 5%, fhir-lite-api pods restarting. Evidence pack: .claude/skills/production-rca/examples/INC-2026-0922-lastn/",
   "expectedOutput": "[orchestrator] Run 2026-09-22-inc-lastn-latency. 01-incident-brief.md written (1 patient reference removed from the report). Security step 03 runs: GlobalExceptionHandler ERROR lines + D-04 = possible data exposure.\n[orchestrator] Launching 02 sre and 03 security in parallel.\n\n02-sre.md (needs-human):\n| SRE-1 | critical | performance | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69 | `for (Long subjectId : subjectIds) { patients.findById(subjectId)... ` with 512 subjects per request from `c017-ward-dashboard/2.3.0` (`ingress-access.log:3-6`) | Mitigate now by stopping the 512-subject traffic (M1). |\n| SRE-3 | high | reliability | sample-app/k8s/deployment.yaml | default `timeoutSeconds: 1`; `Liveness probe failed ... context deadline exceeded` then `Killing` (`k8s-events.txt:6-7`) | After the incident: probes on the management port, timeoutSeconds 3. |\nM1 dashboard refresh off (recommended) | M2 ingress limit for c017-ward-dashboard/2.3.0 | M3 scale to 4 (low confidence)\n03-security.md (complete): SEC-1 medium shared `clinician` account used by an integration client; SEC-3 info: the 5 logged exceptions are pool timeouts, no PHI.\n\n[orchestrator] G-M: which mitigation did you execute?\n> 08:17 scaled to 4 from my terminal (M3).\n04-sre.md (needs-human): not resolved; new pods killed 08:21:36 and 08:21:58; DB connections 40. G-M round 2 of 2.\n> 08:31 C-017 IT disabled the dashboard refresh (M1).\n05-sre.md (complete): p95 0.21 s and error ratio 0.002 at 08:34; pg_stat_statements 431,616 calls = 843 x 512; H1 confirmed, H3 rejected.\n06-bug-fix-handover.md: /bug-fix FHIR-311 $lastn issues 2 SQL statements per subject ...\n\n$ node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-latency\nPASS  docs/capstone/example-runs/incident-lastn-latency/01-incident-brief.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/02-sre.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/03-security.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/04-sre.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/05-sre.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/06-bug-fix-handover.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/07-postmortem.md\nPASS  docs/capstone/example-runs/incident-lastn-latency/08-run-report.md",
   "testCases": [
    {"name": "Every handoff is valid (CLI)", "input": "node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-latency; echo $?", "expected": "8 PASS lines, exit 0"},
    {"name": "Hook accepts the sre's inline handoff during an active run", "input": "T=$(mktemp -d); R=$T/.ai-sdlc/runs/2026-09-22-inc-lastn-latency; mkdir -p $R; cp docs/capstone/example-runs/incident-lastn-latency/01-incident-brief.md $R/; echo 2026-09-22-inc-lastn-latency > $T/.ai-sdlc/runs/.active; node -e 'const m=require(\"fs\").readFileSync(\"docs/capstone/example-runs/incident-lastn-latency/02-sre.md\",\"utf8\");process.stdout.write(JSON.stringify({hook_event_name:\"SubagentStop\",agent_type:\"sre\",cwd:process.argv[1],last_assistant_message:m}))' $T | CLAUDE_PROJECT_DIR=$T node .claude/hooks/check-handoff.mjs; echo $?", "expected": "0; with `status: done` in the message instead, exit 2 and stderr `status \"done\" must be one of complete | blocked | needs-human`"},
    {"name": "No PHI in the run", "input": "grep -rEn 'MRN-[0-9]{6}|Test Patient|Patient/[0-9]+' docs/capstone/example-runs/incident-lastn-latency/*.md", "expected": "No output: the patient named in the on-call report was removed in 01"},
    {"name": "No agent executed a mitigation", "input": "grep -l 'Human outcome reported' docs/capstone/example-runs/incident-lastn-latency/0[45]-sre.md | wc -l; grep -h -A1 '^## Artifacts' docs/capstone/example-runs/incident-lastn-latency/0[2457]-*.md | grep -c 'none (read-only'", "expected": "2 (both mitigations are recorded as human outcomes), then 4: every sre handoff lists `none (read-only; handoff returned inline and saved by the orchestrator)` under Artifacts"},
    {"name": "Postmortem agrees with the golden RCA", "input": "for s in '9,847' '29,412' 'ObservationController.java:43' 'CHG-4472' 'PA-8'; do grep -q \"$s\" docs/capstone/example-runs/incident-lastn-latency/07-postmortem.md && grep -q \"$s\" skills/production-rca/tests/expected/INC-2026-0922-01-rca.md && echo ok; done | wc -l", "expected": "5"},
    {"name": "verify-system covers the example run", "input": "node scripts/capstone/verify-system.mjs | grep 'incident-lastn-latency'", "expected": "`PASS    handoffs       docs/capstone/example-runs/incident-lastn-latency: 8 handoff(s) valid`"}
   ],
   "evaluationCriteria": [
    "Each step cites only evidence timestamped before it ran (02 does not use the 08:31 pg_stat_statements snapshot; 05 does).",
    "The security step's run-or-skip decision is justified with the spec condition and a repo fact (D-04), not a guess.",
    "Hypotheses are ranked with evidence for and against; bad deploy and OOM are rejected with specific lines (`rollout-history.txt`, `Reason: Error`, `Exit Code: 137`).",
    "Mitigations are options for a human with confidence levels, never actions taken by an agent.",
    "The bug-fix handover states the CLAUDE.md rule 6 exception, the prior-art patch, the regression test name, and what stays out of scope (D-02, D-03).",
    "The retry numbering follows `workflows/README.md` and the README of the run explains it."
   ],
   "improvements": [
    "Add an `sre` suite to `evaluations/suites.json` with this incident as a golden task (expected findings: SRE-1 critical at ObservationService.java:69, probe timeout; forbidden claim: OOMKilled).",
    "Fix the seam `verify-system` reports so the sre can actually run `build-timeline.mjs` under its Bash guard, then rerun the live incident.",
    "Run the `/bug-fix FHIR-311` handover in a scratch copy and link its run report from 08-run-report.md."
   ]},
  {"id": "11-personalize",
   "title": "Personalize the system: swap stack and domain with a measured checklist",
   "objective": "Plan and start moving the AI-SDLC system from Java/Spring/FHIR-lite to your own stack and domain (worked target: a Python/FastAPI/pytest claims service). Measure which files encode the old assumptions with `stack-inventory.mjs`, apply the personalization checklist in order (memory, context, agents, skills, workflows and settings, wiring, evals, first run), and prove each step with a command. The deliverable is your filled checklist, a terms file for the old stack, and inventory numbers before and after.",
   "startingFiles": [
    {"path": "AI-SDLC/scripts/capstone/terms.claims.json", "content": "{\n  \"old-stack\": [\"\\\\bmvn\\\\b\", \"\\\\bMaven\\\\b\", \"Spring Boot\", \"\\\\bJUnit\\\\b\", \"MockMvc\", \"\\\\bH2\\\\b\"],\n  \"old-domain\": [\"\\\\bFHIR\\\\b\", \"\\\\bObservation\\\\b\", \"\\\\bLOINC\\\\b\", \"\\\\$lastn\", \"OperationOutcome\"]\n}\n"}
   ],
   "requiredStructure": "AI-SDLC/\n├── docs/capstone/personalize-checklist.md     # 8 steps, one checkbox per concrete edit\n├── scripts/capstone/\n│   ├── stack-inventory.mjs                   # per-component count of files with stack/domain terms\n│   ├── stack-inventory.test.mjs\n│   └── terms.claims.json                     # your old-stack terms (starting file)\n└── (after the swap) CLAUDE.md, .claude/rules/claims-api-python.md, context/**, .claude/agents/*.md, .claude/skills/**, evaluations/datasets/**",
   "implementation": [
    {"path": "AI-SDLC/docs/capstone/personalize-checklist.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/scripts/capstone/stack-inventory.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/scripts/capstone/stack-inventory.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode scripts/capstone/stack-inventory.mjs",
   "expectedOutput": "| component | files | files with matches | stack | domain | platform | top files |\n|---|---|---|---|---|---|---|\n| memory | 2 | 2 | 11 | 9 | 0 | `CLAUDE.md`, `.claude/rules/sample-app-java.md` |\n| context | 8 | 7 | 19 | 77 | 8 | `context/architecture/overview.md`, `context/domain/fhir-lite-glossary.md`, `context/security/phi-and-secrets-policy.md` |\n| agents | 20 | 17 | 79 | 87 | 59 | `.claude/agents/sre.md`, `agents/sre/CONTRACT.md`, `.claude/agents/security.md` |\n| skills | 91 | 83 | 524 | 586 | 128 | `skills/security-review/tests/expected/sample-app-report.md`, `.claude/skills/test-strategy/examples/lastn-test-plan.md`, `skills/security-review/tests/expected/sample-app-report.json` |\n| workflows | 24 | 18 | 47 | 40 | 8 | `workflows/examples/feature-patient-pagination/01-requirements.md`, `workflows/examples/feature-patient-pagination/03-implementation-plan.md`, `workflows/incident-response.md` |\n| mcp | 13 | 10 | 5 | 158 | 2 | `mcp/fhir-readonly-server/fixtures/dataset.json`, `mcp/fhir-readonly-server/server.mjs`, `mcp/fhir-readonly-server/test-client.mjs` |\n| governance | 28 | 15 | 16 | 44 | 11 | `docs/governance/prompt-injection.md`, `.claude/hooks/flag-injection.test.mjs`, `.claude/hooks/guard-outbound.test.mjs` |\n| evals | 21 | 17 | 98 | 126 | 14 | `evaluations/datasets/architecture-golden.json`, `evaluations/datasets/reviewer-golden.json`, `evaluations/datasets/reviewer-diffs/REV-01.patch` |\n| docs | 30 | 25 | 71 | 134 | 36 | `docs/capstone/personalize-checklist.md`, `docs/tutorials/level-2/README.md`, `docs/capstone/example-runs/incident-lastn-latency/07-postmortem.md` |\n\nstack-inventory: 194 file(s) encode a stack/domain assumption\n\n$ node scripts/capstone/stack-inventory.mjs --terms scripts/capstone/terms.claims.json      # unmodified repo\n| memory | 2 | 2 | 7 | 4 | `CLAUDE.md`, `.claude/rules/sample-app-java.md` |\n| context | 8 | 7 | 10 | 39 | `context/architecture/overview.md`, `context/domain/fhir-lite-glossary.md`, `context/standards/testing-standards.md` |\n| agents | 20 | 13 | 49 | 20 | `agents/tester/CONTRACT.md`, `.claude/agents/tester.md`, `.claude/agents/developer.md` |\n| skills | 91 | 65 | 160 | 324 | `.claude/skills/test-strategy/examples/lastn-test-plan.md`, `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`, `.claude/skills/production-rca/examples/INC-2026-0922-lastn/ingress-access.log` |\nstack-inventory: 147 file(s) encode a stack/domain assumption\n\nAfter checklist steps 1 to 3 (memory, context, agents) on your fork:\n| memory | 2 | 0 | 0 | 0 | - |\n| context | 8 | 0 | 0 | 0 | - |\n| agents | 20 | 0 | 0 | 0 | - |\n| skills | 91 | 65 | 160 | 324 | `.claude/skills/test-strategy/examples/lastn-test-plan.md`, `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`, `.claude/skills/production-rca/examples/INC-2026-0922-lastn/ingress-access.log` |\nstack-inventory: 125 file(s) encode a stack/domain assumption",
   "testCases": [
    {"name": "Inventory tool tests pass", "input": "node scripts/capstone/stack-inventory.test.mjs", "expected": "9/9 passed, exit 0"},
    {"name": "Baseline is recorded", "input": "node scripts/capstone/stack-inventory.mjs --json | node -e 'const d=JSON.parse(require(\"fs\").readFileSync(0));console.log(d.groups.reduce((a,g)=>a+g.matching.length,0))'", "expected": "194 on the course repository at the time of writing (it grows as files are added); record your baseline in the checklist"},
    {"name": "Memory, context and agents are swapped", "input": "node scripts/capstone/stack-inventory.mjs --terms scripts/capstone/terms.claims.json --json | node -e 'const d=JSON.parse(require(\"fs\").readFileSync(0));for(const g of d.groups.slice(0,3))console.log(g.component,g.matching.length)'", "expected": "memory 0\ncontext 0\nagents 0"},
    {"name": "Swapped system is still wired", "input": "node scripts/capstone/verify-system.mjs; echo $?", "expected": "`-> WIRED`, exit 0: guard-reach passes for the new `pytest -q` and summary-script prefixes; contracts list the same tools (check-agents sub-checker PASS)"},
    {"name": "Done means a number", "input": "node scripts/capstone/stack-inventory.mjs --terms scripts/capstone/terms.claims.json --max 10; echo $?", "expected": "exit 0 once at most 10 files still mention the old stack (the course docs and the old example runs you chose to keep), exit 1 before"},
    {"name": "Evals re-baselined on the new app", "input": "grep -c '\"_synthetic\": true' evaluations/recordings/*/*.json | grep -v ':0' | wc -l", "expected": "0: synthetic recordings for the old app are deleted; live recordings of the new suites replace them"}
   ],
   "evaluationCriteria": [
    "The checklist is ordered so that each step's check can pass: context before agents, agents before evals.",
    "Every checklist item is a concrete edit to a named file, with the command that proves it.",
    "The roster names are kept, or every hard-coded roster (check-handoff, check-agents, check-roster-flat, verify-system) is updated together.",
    "PHI rules survive the swap: the new glossary has a PHI table and the deny rules name the new real-data paths.",
    "Golden tasks are rewritten against the new code, not translated from the old ones."
   ],
   "improvements": [
    "Make `stack-inventory.mjs` emit a checklist skeleton (one checkbox per matching file) so nothing is missed.",
    "Package the stack-neutral parts (orchestrator, handoff hook, tool-guard, verify-system) as a second plugin next to `company-ai/`, and keep only stack knowledge in each project.",
    "Add a `CLAUDE.local.md` template for personal preferences so individual taste does not leak into the shared CLAUDE.md."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`node scripts/capstone/verify-system.mjs` prints `-> WIRED` and exits 0 (after the sre guard fix), and runs in CI.",
  "`node scripts/capstone/verify-system.test.mjs` passes 22/22 and `node scripts/capstone/stack-inventory.test.mjs` passes 9/9.",
  "You can name, for each of G1, G2, G-M and G3, the mechanism that enforces it and say which one is a convention.",
  "Every workflow run starts with `claude --agent orchestrator --settings workflows/gates.settings.json` in `default` permission mode.",
  "A feature run's handoffs all pass `node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/<run-id>` and the PR changes only `sample-app/`.",
  "`node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-latency` prints 8 PASS lines.",
  "No agent in the incident run executed a mitigation; both are recorded as human outcomes.",
  "The incident postmortem agrees with `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md` on trigger, root cause and impact.",
  "Agent or skill changes that follow a run go through eval replay (and a live comparison) before their PR, which the AI-config gate (G6) requires.",
  "`AI-SDLC/README.md` lets a new engineer run verify, tests, evals and a gated workflow without reading the course.",
  "Your personalization checklist has a baseline and a current `stack-inventory` number, and the swapped system still verifies as WIRED."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/11-capstone.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
