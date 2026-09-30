# Generator for content/modules/02-first-agent-skill-tools.json. Run: python3 build/sources/02-first-agent-skill-tools.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

REVIEW_PATCH = "AI-SDLC/docs/tutorials/level-2/patches/02-review-exercise.patch"
SEC_PATCH = "AI-SDLC/docs/tutorials/level-2/patches/02-clinician-delete-regression.patch"

mod = {
 "id": "02-first-agent-skill-tools",
 "level": 2,
 "title": "Your First Agent, Skill, and Tools",
 "summary": "Build and test the first working pieces of the AI-SDLC system: a reviewer subagent (kept as the v1 snapshot later modules improve and evaluate), an explain-endpoint skill that traces a FHIR-lite route from security rule to SQL, and a run-tests skill that runs Maven with pre-approved commands and a tested summary script. Then restrict an agent's tools and scope a PreToolUse hook to it, and test everything headless with claude -p.",
 "prerequisites": ["00-example", "01-foundations", "Claude Code CLI installed and authenticated (`claude --version`)", "Java 21, Maven 3.9 and Node 22 on PATH; `cd AI-SDLC/sample-app && mvn -q -B test` passes", "`jq` installed (used to read `--output-format json` results)"],
 "concepts": [
  {"heading": "Anatomy of a subagent file",
   "body_md": "A subagent is **one Markdown file with YAML frontmatter**. Only two keys are required:\n\n- `name`: the identity (`reviewer`). The filename does not have to match, and subfolders do not change identity. Hooks see it as `agent_type`.\n- `description`: when Claude should delegate to it. The main session reads every description to decide routing, so write it as a trigger: *what* it does and *when* to use it (\"Reviews code changes in the sample app. Use after code changes.\").\n\nOptional keys you use in this module: `tools`, `disallowedTools`, `model` (`sonnet`, `opus`, `haiku`, `fable`, a full id, or `inherit`), `permissionMode`, `maxTurns`, `skills`, `hooks`. Multi-word keys are **camelCase** in subagent files. Unknown keys are **silently ignored**, so `allowed-tools:` (the skill spelling) or `max_turns:` in an agent file does nothing and raises no error. Check spelling against the docs table, not memory.\n\n### Where the file lives decides who gets it\n\nFor the same `name`, the higher entry wins: managed settings `.claude/agents/` > `--agents` JSON flag > project `.claude/agents/` (closest to the working directory) > `~/.claude/agents/` > plugin `agents/`. So in practice:\n\n- Team agents go in `AI-SDLC/.claude/agents/` and are reviewed like code.\n- `--agents '{...}'` is the **test harness**: it overrides a project agent for one session without touching the file.\n- A personal `~/.claude/agents/reviewer.md` is shadowed by the project's reviewer; that is usually what you want.\n\nNew files are hot-reloaded, with one exception: the first agent in a newly created `agents` directory needs a restart. This bites people on day one."},
  {"heading": "The body is the whole system prompt",
   "body_md": "The Markdown body becomes the subagent's system prompt. It **replaces** the Claude Code system prompt rather than adding to it. At start-up a subagent receives only:\n\n1. its body,\n2. the task message the main session wrote when delegating,\n3. the CLAUDE.md hierarchy and git status,\n4. basic environment details (working directory),\n5. any skills listed in `skills:` (full content preloaded).\n\nIt does **not** get your conversation, the main session's output style or auto memory. Whatever the reviewer needs to know about *this* repository must come from CLAUDE.md, a preloaded skill, or files it reads.\n\n### Writing it\n\n- **Role and scope in the first line**: \"senior Java and Spring Boot reviewer for the FHIR-lite API in `sample-app/`\". Specialization is what makes a subagent better than the general-purpose one.\n- **A procedure**: numbered steps the agent can follow without guessing (run `git diff HEAD -- sample-app`, read changed files and their callers, check named standards).\n- **Repository awareness by path**: name `context/standards/review-standards.md` and `context/security/phi-and-secrets-policy.md` instead of pasting them. The agent reads them when needed; CLAUDE.md already imports the PHI policy.\n- **An output format** someone can parse. v1 in this module says \"report the problems you find\" and nothing more. That vagueness is deliberate: it gives module `09-agent-evaluation` a baseline to measure v2 against.\n\nEvery sentence in the body costs tokens on every turn of that agent. Put project facts all agents need in CLAUDE.md, and keep the body for role, procedure, and output."},
  {"heading": "Tool selection: allowlist, denylist, inheritance",
   "body_md": "`tools` is an **allowlist**. If you **omit** it, the subagent inherits every tool available to subagents, including MCP tools from the main session. That is what reviewer v1 does, and it means a \"reviewer\" can Edit, Write and run any Bash command the permission rules allow.\n\n`disallowedTools` is a **denylist** removed from the inherited or listed set. Two consequences:\n\n- `disallowedTools: Edit, Write, NotebookEdit` on an otherwise inheriting agent keeps new MCP tools flowing in automatically. Convenient, but you no longer know the agent's full tool set by reading the file.\n- A specifier does not narrow a tool: `disallowedTools: Bash(git push *)` removes **all** of Bash. You cannot scope Bash to some commands from the tool list.\n\nRules of thumb for this course:\n\n| Agent kind | Use |\n|---|---|\n| Read-only (reviewer, security, architect) | explicit `tools: Read, Grep, Glob` plus `Bash` only if a hook or permission rules narrow it |\n| Writes code (developer, tester) | explicit `tools` including `Edit, Write, Bash` |\n| Must not delegate | leave `Agent` out of `tools` (roster agents stay at depth 1) |\n\nTo narrow Bash, combine `tools: ..., Bash` with a `PreToolUse` hook in the agent's own frontmatter (exit code 2 blocks) and `permissions.allow` rules in `.claude/settings.json` (`Bash(git diff *)`). The tool list says *which* tools; hooks and permission rules say *which calls*."},
  {"heading": "Permissions: permissionMode and the parent's mode",
   "body_md": "A subagent can declare `permissionMode`: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk` or `bypassPermissions`. For a read-only reviewer, `dontAsk` is attractive: anything that would prompt is denied automatically, and commands allowed by `permissions.allow` (for example `Bash(git diff *)` in `AI-SDLC/.claude/settings.json`) still run. No one has to sit at the terminal answering prompts for a background review.\n\nBut the docs are explicit that the **parent's mode wins in three cases**: a subagent's `permissionMode` is ignored when the parent session runs in `bypassPermissions`, `acceptEdits` or `auto`, and a subagent cannot escalate to `bypassPermissions` unless the parent already is. Recent versions start new terminal sessions in `auto`, so in practice your `dontAsk` line is often not in effect.\n\nThat is why this module layers controls:\n\n1. `tools` removes what the agent can never use (no Edit, no Write).\n2. The subagent-scoped `PreToolUse` hook in the agent's frontmatter runs whatever mode the parent is in; `reviewer-bash-guard.mjs` exits 2 for anything except `git diff/log/show/status`.\n3. `permissions.deny` in settings (`Read(./.env)`, `Bash(rm -rf *)`) applies everywhere.\n4. `permissionMode` is the last, best-effort layer.\n\nFor headless tests, `claude -p ... --permission-mode plan` makes the whole run read-only. Use it when testing an agent that still inherits Edit and Write, like v1."},
  {"heading": "Context injection: CLAUDE.md, preloaded skills, and !`cmd`",
   "body_md": "Three ways to get repository knowledge into an agent or skill **before** it starts working:\n\n- **CLAUDE.md**: loaded for every subagent (except the built-in Explore and Plan). Put rules and commands here. `AI-SDLC/CLAUDE.md` already tells every agent the test command and the no-PHI rule.\n- **`skills:` in agent frontmatter**: the listed skills' full content is injected at start-up. Module 05 gives the tester and developer `skills: [run-tests]`. A skill with `disable-model-invocation: true` cannot be preloaded, which is why run-tests leaves it at the default.\n- **`` !`command` `` in a SKILL.md body**: the command runs when the skill is invoked and its output replaces the placeholder before Claude sees the prompt. `explain-endpoint` injects the current route map from a `grep` over the controllers; `run-tests` injects the invocation time and `git status --short -- sample-app`.\n\nInjection has sharp edges:\n\n- A **non-zero exit aborts the whole skill** (except exit 1 from search or compare commands such as `grep`). Never inject `mvn test`: it exits 1 exactly when a test fails.\n- The command is **checked against permission rules**; if it is not allowed, invocation aborts outside auto mode. Pre-approve it in the skill's `allowed-tools` (`Bash(grep *)`, `Bash(date *)`).\n- `allowed-tools` **pre-approves** while the skill is active; it does not restrict. Use `disallowed-tools` to remove tools.\n\nArguments: `$ARGUMENTS` is the full argument string, `$0` the first argument, `$1` the second (0-based, shell-style quoting). `argument-hint` shows in autocomplete. Supporting files (`reference.md`, `scripts/`) sit next to SKILL.md; the body links them and Claude reads or runs them only when needed."},
  {"heading": "Testing and iterating headless",
   "body_md": "An agent is code you cannot unit-test directly, so you test its behaviour on fixed inputs. The fixed inputs in this module are two labelled patches under `docs/tutorials/level-2/patches/` (they are exercise inputs, not app changes). The runner is `claude -p`:\n\n| Flag | Why |\n|---|---|\n| `--output-format json` | one JSON object with `result`, `subtype`, `is_error`, `num_turns`, `total_cost_usd`, `session_id`, `usage` |\n| `--max-turns 10` | caps the loop; hitting it gives `subtype: error_max_turns` |\n| `--permission-mode plan` | read-only run, safe for agents that still inherit Edit/Write |\n| `--agent reviewer` | run the agent as the main thread (its body replaces the system prompt) |\n| `--agents '{\"reviewer\": {...}}'` | define or override an agent for one session without editing files |\n| `--output-format stream-json --verbose` | every message, so you can see the `Agent` tool call that delegated |\n\nIn `-p` mode a user-invoked skill runs by putting `/run-tests SecurityTest` in the prompt.\n\nThe iteration loop: change **one** thing, re-run the same command on the same patch, compare `result`, `num_turns` and `total_cost_usd`, and write the change and observation into the iteration log in `docs/tutorials/level-2/README.md`. Anything that does not need a model is tested without one: `summarize-surefire.mjs` and `reviewer-bash-guard.mjs` each ship a `node --test` suite, and hooks can be exercised by piping hook JSON into them and checking the exit code.\n\nNo API key? Everything except the `claude -p` lines still runs: the Maven tests, both script suites, the hook simulation, and every `grep`/`git` test case below."}
 ],
 "diagrams": [
  {"title": "Which reviewer definition wins",
   "mermaid": "flowchart TD\n  Q[\"Delegation to name: reviewer\"] --> M{\"Managed .claude/agents/ has it?\"}\n  M -->|\"yes\"| MW[\"Use managed definition\"]\n  M -->|\"no\"| C{\"--agents JSON has it?\"}\n  C -->|\"yes\"| CW[\"Use CLI definition (this session)\"]\n  C -->|\"no\"| P{\"Project .claude/agents/ has it?\"}\n  P -->|\"yes\"| PW[\"Use AI-SDLC/.claude/agents/reviewer.md\"]\n  P -->|\"no\"| U{\"~/.claude/agents/ has it?\"}\n  U -->|\"yes\"| UW[\"Use personal definition\"]\n  U -->|\"no\"| PL[\"Plugin agents (namespaced plugin:reviewer)\"]"},
  {"title": "What happens when /run-tests SecurityTest is invoked",
   "mermaid": "sequenceDiagram\n  participant U as Engineer\n  participant CC as Claude Code\n  participant SH as Shell\n  participant CL as Claude\n  U->>CC: /run-tests SecurityTest\n  CC->>SH: !date and !git status (pre-approved by allowed-tools)\n  SH-->>CC: timestamp and changed files\n  CC->>CL: SKILL.md body with injections and $ARGUMENTS filled in\n  CL->>SH: mvn -q -B test -f sample-app/pom.xml -Dtest=SecurityTest\n  SH-->>CL: exit 1 plus log noise (not quoted)\n  CL->>SH: node summarize-surefire.mjs --since timestamp\n  SH-->>CL: compact summary: 1 failed at SecurityTest.java:33\n  CL-->>U: summary, failure analysis, verdict NOT READY"},
  {"title": "Layers a reviewer Bash call passes through",
   "mermaid": "flowchart LR\n  A[\"Reviewer wants: mvn -q -B test\"] --> T{\"Bash in tools?\"}\n  T -->|\"no\"| X1[\"Tool not available\"]\n  T -->|\"yes\"| H{\"Subagent PreToolUse hook\"}\n  H -->|\"exit 2\"| X2[\"Blocked, stderr shown to agent\"]\n  H -->|\"exit 0\"| R{\"permissions deny / ask / allow\"}\n  R -->|\"deny\"| X3[\"Denied\"]\n  R -->|\"allow\"| OK[\"Runs\"]\n  R -->|\"would prompt\"| MD{\"Effective mode\"}\n  MD -->|\"dontAsk\"| X4[\"Auto-denied\"]\n  MD -->|\"default\"| PR[\"Prompt the human\"]"}
 ],
 "comparisonTables": [
  {"title": "Controls for what an agent may do",
   "columns": ["Control", "Where", "Granularity", "Survives parent auto/acceptEdits/bypass?", "Use it for"],
   "rows": [
    ["`tools` allowlist", "Subagent frontmatter", "Whole tools", "Yes", "Read-only agents: `Read, Grep, Glob`"],
    ["`disallowedTools`", "Subagent frontmatter", "Whole tools (a specifier still removes the whole tool)", "Yes", "Inherit everything except Edit/Write"],
    ["`permissionMode`", "Subagent frontmatter", "Whole session behaviour", "No: ignored under `bypassPermissions`, `acceptEdits`, `auto`", "`dontAsk` for unattended read-only agents"],
    ["`hooks` (`PreToolUse`)", "Subagent frontmatter", "Individual calls (inspect `tool_input`)", "Yes", "Narrow Bash to `git diff/log/show/status`"],
    ["`permissions.allow/ask/deny`", "`.claude/settings.json`", "Individual calls by rule (`Bash(git diff *)`)", "Deny rules yes", "Project-wide guardrails"],
    ["Skill `allowed-tools`", "SKILL.md frontmatter", "Rules, while the skill is active", "Not a restriction at all", "Pre-approving `mvn -q -B test *` for /run-tests"]
   ]},
  {"title": "Subagent or skill?",
   "columns": ["Question", "Subagent (`.claude/agents/`)", "Skill (`.claude/skills/`)"],
   "rows": [
    ["Context", "Fresh context: body, task message, CLAUDE.md, git status, preloaded skills", "Runs in the current conversation (unless `context: fork`)"],
    ["Invocation", "Delegation by description, `@agent-reviewer`, `--agent`", "`/explain-endpoint ...` or auto-load by description"],
    ["Tool control", "`tools`, `disallowedTools`, `permissionMode`, `hooks`", "`allowed-tools` (pre-approve), `disallowed-tools` (remove), `hooks`"],
    ["Key spelling", "camelCase (`disallowedTools`, `maxTurns`)", "hyphenated (`allowed-tools`, `argument-hint`) plus `when_to_use`"],
    ["Best for", "A role with its own judgement and tool boundary (reviewer)", "A repeatable procedure (explain an endpoint, run tests)"],
    ["In this module", "`reviewer-v1.md`, `reviewer-v1-restricted.md`", "`explain-endpoint`, `run-tests`"]
   ]}
 ],
 "exercises": [
  {"id": "02-first-agent-reviewer-v1",
   "title": "Create reviewer v1 and test it headless",
   "objective": "Write the first subagent, a deliberately simple `reviewer` with only `name`, `description`, `model` and a short body, install it at `.claude/agents/reviewer.md`, and prove with `claude -p` that the main session delegates to it and that it finds the two labelled defects in a patch. Keep the file unchanged as `evaluations/agent-versions/reviewer-v1.md`: module 05 builds v2 and module 09 compares the two.",
   "startingFiles": [
    {"path": REVIEW_PATCH, "content": f(REVIEW_PATCH)}
   ],
   "requiredStructure": "AI-SDLC/\n├── .claude/agents/reviewer.md                    # copy of v1 for this exercise\n├── evaluations/agent-versions/reviewer-v1.md     # frozen v1 snapshot (name: reviewer)\n├── docs/tutorials/level-2/patches/02-review-exercise.patch\n└── .ai-sdlc/runs/level-2/review-v1.json          # headless result (git-ignored)",
   "implementation": [
    {"path": "AI-SDLC/evaluations/agent-versions/reviewer-v1.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": REVIEW_PATCH, "language": "diff", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nmkdir -p .claude/agents .ai-sdlc/runs/level-2\ncp evaluations/agent-versions/reviewer-v1.md .claude/agents/reviewer.md\ngit apply docs/tutorials/level-2/patches/02-review-exercise.patch\nclaude -p \"Use the reviewer subagent to review the uncommitted changes in sample-app.\" \\\n  --permission-mode plan --max-turns 10 --output-format json > .ai-sdlc/runs/level-2/review-v1.json\njq -r '.result' .ai-sdlc/runs/level-2/review-v1.json",
   "expectedOutput": "The reviewer found two problems in `PatientService.java`, both serious:\n\n1. **PHI written to the application log.** `get()` now logs the patient's given names, family name and MRN:\n   `log.info(\"Loaded patient {} {} (MRN {})\", patient.getGivenNames(), patient.getFamilyName(), patient.getMrn());`\n   This breaks rule 1 in CLAUDE.md (never put PHI in logs). `AuditLogger.record(Action.READ, \"Patient\", id)` already records the access with the id only. Remove the line (and the unused `Logger`).\n\n2. **Search without criteria now returns every patient.** In `search()` the 400 guard was replaced by `return patients.findAll();`. That is an unbounded listing of PHI, it skips `audit.recordSearch`, and it contradicts the architecture overview (\"Patient search without parameters returns 400\"). The existing test `PatientApiTest.searchWithoutParametersIs400` will fail. Restore `throw FhirApiException.badRequest(...)`.\n\nNo other changes in the diff.",
   "testCases": [
    {"name": "Frontmatter has exactly the v1 keys", "input": "sed -n '1,5p' AI-SDLC/evaluations/agent-versions/reviewer-v1.md", "expected": "---\nname: reviewer\ndescription: Reviews code changes in the sample app. Use after code changes.\nmodel: inherit\n---"},
    {"name": "v1 is deliberately broad: no tools line", "input": "grep -c '^tools:' AI-SDLC/evaluations/agent-versions/reviewer-v1.md", "expected": "0 (the agent inherits every tool; exercise 02-restrict-tools-and-hook narrows it)"},
    {"name": "Installed copy is identical", "input": "cmp AI-SDLC/evaluations/agent-versions/reviewer-v1.md AI-SDLC/.claude/agents/reviewer.md && echo same", "expected": "same"},
    {"name": "Patch applies and breaks exactly one test", "input": "cd AI-SDLC && git apply --check docs/tutorials/level-2/patches/02-review-exercise.patch && git apply docs/tutorials/level-2/patches/02-review-exercise.patch && (cd sample-app && mvn -q -B test 2>&1 | grep 'Tests run: 25')", "expected": "[ERROR] Tests run: 25, Failures: 1, Errors: 0, Skipped: 0 (the failing test is PatientApiTest.searchWithoutParametersIs400:76, Status expected:<400> but was:<200>)"},
    {"name": "Delegation really happened", "input": "claude -p \"Use the reviewer subagent to review the uncommitted changes in sample-app.\" --permission-mode plan --max-turns 10 --output-format stream-json --verbose | jq -r 'select(.type==\"assistant\") | .message.content[]? | select(.type==\"tool_use\" and .name==\"Agent\") | .input.subagent_type'", "expected": "reviewer"},
    {"name": "Run finished inside the turn budget", "input": "jq '{subtype, is_error, num_turns}' AI-SDLC/.ai-sdlc/runs/level-2/review-v1.json", "expected": "\"subtype\": \"success\", \"is_error\": false, num_turns at most 10"},
    {"name": "Both defects reported", "input": "jq -r '.result' AI-SDLC/.ai-sdlc/runs/level-2/review-v1.json | grep -iE 'MRN|PHI' && jq -r '.result' AI-SDLC/.ai-sdlc/runs/level-2/review-v1.json | grep -E 'findAll|every patient|all patients'", "expected": "At least one matching line from each grep."},
    {"name": "Plan mode kept it read-only", "input": "cd AI-SDLC && git diff --stat", "expected": "Only `sample-app/src/main/java/org/example/fhir/service/PatientService.java | 8 +++++++-` (the patch itself); no other file changed."}
   ],
   "evaluationCriteria": [
    "`description` states what the agent does and when to delegate to it.",
    "The body is a system prompt: role, numbered procedure, and where to look (`git diff`, CLAUDE.md), with no conversation-style text.",
    "v1 is valid but naive on purpose: no `tools` line and no structured output format. Do not improve the snapshot; improvements go in later versions.",
    "The headless command uses only documented flags (`-p`, `--permission-mode`, `--max-turns`, `--output-format`).",
    "The learner can explain why the output (prose, no severity, no `path:line`) is hard to evaluate automatically."
   ],
   "improvements": [
    "Run the same command three times and diff the `result` fields: note how much v1's wording and ordering vary. This is the baseline noise module 09 measures.",
    "Override the project agent for one run without editing files: `claude -p ... --agents '{\"reviewer\": {\"description\": \"Reviews code changes in the sample app.\", \"prompt\": \"You are a reviewer. Reply with findings only.\", \"tools\": [\"Read\", \"Grep\", \"Glob\"]}}'`.",
    "Add `color: blue` so the reviewer is easy to spot in an interactive session."
   ]},
  {"id": "02-explain-endpoint-skill",
   "title": "Write the explain-endpoint skill",
   "objective": "Create `.claude/skills/explain-endpoint/` with a SKILL.md that takes the endpoint as `$ARGUMENTS`, shows an `argument-hint`, injects the current route map with a pre-approved `!` command, and links a `reference.md` supporting file. Invoke it on `GET /fhir/Observation/$lastn` and check that the answer traces controller, service, repository, SQL, security, errors, audit and tests with real `path:line` citations, including the two SQL statements per subject of the teaching defect.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/.claude/skills/explain-endpoint/\n├── SKILL.md       # name, description, when_to_use, argument-hint, allowed-tools; $ARGUMENTS; !`grep ...` route map\n└── reference.md   # repository map + Spring Data method -> SQL table (observed with show-sql)",
   "implementation": [
    {"path": "AI-SDLC/.claude/skills/explain-endpoint/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/skills/explain-endpoint/reference.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude -p '/explain-endpoint GET /fhir/Observation/$lastn' --permission-mode plan --max-turns 15 --output-format json | jq -r '.result'",
   "expectedOutput": "## GET /fhir/Observation/$lastn\nReturns a searchset Bundle with the most recent Observation per requested subject, optionally filtered by LOINC code. Any authenticated CLINICIAN or ADMIN may call it.\n\n### Request flow\n| Step | Layer | Location (path:line) | What happens |\n|---|---|---|---|\n| 1 | Security | sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:44 | `.requestMatchers(\"/fhir/**\").hasAnyRole(CLINICIAN, ADMIN)` |\n| 2 | Controller | sample-app/src/main/java/org/example/fhir/api/ObservationController.java:42 | `@GetMapping(\"/$lastn\")`, binds `@RequestParam List<Long> subjects`, optional `code` |\n| 3 | Controller | ObservationController.java:44 | strips an optional `system|` prefix: `code.substring(code.indexOf('|') + 1)` |\n| 4 | Service | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:61 | `@Transactional(readOnly = true)` `lastN(subjectIds, code)` |\n| 5 | Service | ObservationService.java:69-75 | loop per subject: `patients.findById`, then `findByPatientIdOrderByEffectiveDateTimeDesc`, keep the first matching row (marked `TEACHING-DEFECT(perf-n+1)` at line 64) |\n| 6 | Mapper | ObservationController.java:45 | `ObservationMapper::toResource`, wrapped by `Bundle.searchset` |\n\n### SQL\n1. `select ... from patient p1_0 where p1_0.id=?` (primary key)\n2. `select ... from observation o1_0 join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=? order by o1_0.effective_date_time desc` (can use `ix_observation_patient_code` via `patient_id`; the sort is not indexed)\n\nStatements per request: 2 x number of subjects. 500 subjects means about 1000 round trips, and each second query loads the patient's full history to keep one row.\n\n### Responses\n| Status | When | Produced at (path:line) |\n|---|---|---|\n| 200 | Bundle, possibly empty; unknown subject ids are silently skipped (`ifPresent`) | ObservationService.java:70 |\n| 400 | `subjects` missing | GlobalExceptionHandler.java:44 (`handleMissingParam`) |\n| 400 | a subject id is not a number | GlobalExceptionHandler.java:49 (`handleTypeMismatch`) |\n| 401 | no or wrong credentials | SecurityConfig.java:34 (`unauthorized` entry point, issue code `login`) |\n\n403 is not reachable with the two configured users: both have CLINICIAN.\n\n### Audit and PHI\n`audit.recordSearch(\"Observation\", result.size())` at ObservationService.java:76 logs a count only. No PHI in logs or diagnostics.\n\n### Test coverage\n`ObservationApiTest.lastnReturnsMostRecentObservationPerSubject` (ObservationApiTest.java:80) covers the success path. Not covered: missing `subjects` (400), non-numeric id (400), anonymous call (401), `code` filter.\n\n### Notes and risks\n- N+1 teaching defect, see sample-app/docs/KNOWN_DEFECTS.md (not fixed here, as instructed).\n- No cap on the number of `subjects`.",
   "testCases": [
    {"name": "Skill frontmatter uses hyphenated skill keys", "input": "sed -n '1,12p' AI-SDLC/.claude/skills/explain-endpoint/SKILL.md | grep -E '^(name|description|when_to_use|argument-hint|allowed-tools):'", "expected": "Five lines: name, description, when_to_use, argument-hint, allowed-tools. No camelCase keys such as allowedTools."},
    {"name": "Arguments and injection present", "input": "grep -nE '\\$ARGUMENTS|^!`grep' AI-SDLC/.claude/skills/explain-endpoint/SKILL.md", "expected": "One line with `**$ARGUMENTS**` and one line starting with !`grep -rnE \"@(Get|Post|Put|Delete|Request)Mapping\""},
    {"name": "Injected command works and is pre-approved", "input": "cd AI-SDLC && grep -rnE \"@(Get|Post|Put|Delete|Request)Mapping\" sample-app/src/main/java/org/example/fhir/api | wc -l && grep -c 'Bash(grep \\*)' .claude/skills/explain-endpoint/SKILL.md", "expected": "11 (2 class-level prefixes + 9 routes), then 1"},
    {"name": "Supporting file is linked", "input": "grep -c '\\[reference.md\\](reference.md)' AI-SDLC/.claude/skills/explain-endpoint/SKILL.md", "expected": "1"},
    {"name": "Reference SQL matches Hibernate", "input": "cd AI-SDLC/sample-app && mvn -q -B test -Dtest='ObservationApiTest#lastnReturnsMostRecentObservationPerSubject' -Dspring.jpa.show-sql=true | grep -c 'from observation o1_0 join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=? order by o1_0.effective_date_time desc'", "expected": "2 (one per subject in the test: the N+1 pattern the skill must report)"},
    {"name": "Answer cites real locations", "input": "The exampleInput command, piped to grep -E 'ObservationService.java:(6[0-9]|7[0-9])|SecurityConfig.java:4[34]'", "expected": "At least two matching lines; the loop (lines 69-75) and the `/fhir/**` security rule are cited."},
    {"name": "Skill stays read-only", "input": "cd AI-SDLC && git status --short", "expected": "No changes after running the skill."}
   ],
   "evaluationCriteria": [
    "The description says what the skill does and when to use it, so auto-invocation works for questions like \"what SQL does patient search run?\".",
    "Every injected command is safe to fail (grep exit 1 is tolerated) and is pre-approved in `allowed-tools`.",
    "The output format forces `path:line` citations and a statement count.",
    "Long reference material lives in `reference.md`, not in SKILL.md.",
    "The skill never edits files and does not propose fixing the teaching defect unless asked."
   ],
   "improvements": [
    "Add `paths: [\"sample-app/src/main/java/**\"]` so the skill auto-activates only when Claude works on the Java sources.",
    "Add a named argument (`arguments: [method, path]`) and use `$method` and `$path` in the body instead of `$ARGUMENTS`.",
    "Run it with `context: fork` and `agent: Explore` to keep the trace out of the main context, and compare the answer quality (Explore does not load CLAUDE.md)."
   ]},
  {"id": "02-run-tests-skill",
   "title": "Give the agent a tool: the run-tests skill",
   "objective": "Build `/run-tests [TestClass | TestClass#method]`: pre-approve exactly the Maven, Node, `date` and `git status` commands it needs with `allowed-tools`, inject the invocation time and changed files with `!`, and turn Surefire's XML reports into a compact summary with a tested zero-dependency script. Use it to catch a labelled regression that lets clinicians delete patients.",
   "startingFiles": [
    {"path": SEC_PATCH, "content": f(SEC_PATCH)}
   ],
   "requiredStructure": "AI-SDLC/.claude/skills/run-tests/\n├── SKILL.md                              # allowed-tools list, !`date`, !`git status`, $ARGUMENTS validation, output format\n└── scripts/\n    ├── summarize-surefire.mjs            # TEST-*.xml -> Markdown summary; --since, --strict; exit 0/1/2\n    └── summarize-surefire.test.mjs       # node --test suite (6 tests)",
   "implementation": [
    {"path": "AI-SDLC/.claude/skills/run-tests/SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/skills/run-tests/scripts/summarize-surefire.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/.claude/skills/run-tests/scripts/summarize-surefire.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": SEC_PATCH, "language": "diff", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\ngit apply docs/tutorials/level-2/patches/02-clinician-delete-regression.patch\nclaude -p \"/run-tests SecurityTest\" --max-turns 10 --output-format json | jq -r '.result'\ngit apply -R docs/tutorials/level-2/patches/02-clinician-delete-regression.patch",
   "expectedOutput": "## Test summary: FAIL\n\n5 tests: 4 passed, 1 failed, 0 errors, 0 skipped (1 suites, 9.4 s)\nIgnored 2 stale report file(s) older than --since.\n\n| Suite | Tests | Failed | Errors | Skipped | Time (s) |\n|---|---|---|---|---|---|\n| SecurityTest | 5 | 1 | 0 | 0 | 9.36 |\n\n### Failures\n1. SecurityTest.clinicianCannotDelete (failed, java.lang.AssertionError)\n   message: Status expected:<403> but was:<204>\n   at: org.example.fhir.SecurityTest.clinicianCannotDelete(SecurityTest.java:33)\n\n### Failure analysis\n| Test | Assertion | Likely cause (hypothesis) | Code to look at |\n|---|---|---|---|\n| SecurityTest.clinicianCannotDelete | expected 403, got 204 | The DELETE rule now grants CLINICIAN: `.requestMatchers(HttpMethod.DELETE, \"/fhir/**\").hasAnyRole(CLINICIAN, ADMIN)`, so a clinician's delete succeeds | sample-app/src/main/java/org/example/fhir/config/SecurityConfig.java:43 |\n\n### Verdict\nNOT READY (1 failing, 0 errors)",
   "testCases": [
    {"name": "Script unit tests pass", "input": "cd AI-SDLC && node --test .claude/skills/run-tests/scripts/summarize-surefire.test.mjs 2>&1 | grep -E '^# (pass|fail)'", "expected": "# pass 6\n# fail 0"},
    {"name": "Script on a real green run", "input": "cd AI-SDLC/sample-app && mvn -q -B test > /dev/null 2>&1; cd .. && node .claude/skills/run-tests/scripts/summarize-surefire.mjs | head -3", "expected": "## Test summary: PASS\n\n25 tests: 25 passed, 0 failed, 0 errors, 0 skipped (3 suites, 13.1 s)  (the total time varies by machine)"},
    {"name": "No reports gives exit 2, not a fake PASS", "input": "cd AI-SDLC && node .claude/skills/run-tests/scripts/summarize-surefire.mjs /nonexistent; echo \"exit=$?\"", "expected": "## Test summary: NO REPORTS\n\nno TEST-*.xml files in /nonexistent. The build probably failed before tests ran (compilation error or Maven failure): check the first [ERROR] lines of the Maven output.\nexit=2"},
    {"name": "Regression patch is caught without Claude", "input": "cd AI-SDLC && git apply docs/tutorials/level-2/patches/02-clinician-delete-regression.patch && (cd sample-app && mvn -q -B test -Dtest=SecurityTest > /dev/null 2>&1); node .claude/skills/run-tests/scripts/summarize-surefire.mjs --strict | grep -A2 '^1\\. '; echo \"exit=$?\"; git apply -R docs/tutorials/level-2/patches/02-clinician-delete-regression.patch", "expected": "1. SecurityTest.clinicianCannotDelete (failed, java.lang.AssertionError)\n   message: Status expected:<403> but was:<204>\n   at: org.example.fhir.SecurityTest.clinicianCannotDelete(SecurityTest.java:33)"},
    {"name": "Maven is never injected", "input": "grep -n '^!`\\|!`' AI-SDLC/.claude/skills/run-tests/SKILL.md", "expected": "Exactly two injections: !`date -u +%Y-%m-%dT%H:%M:%SZ` and !`git status --short -- sample-app`. No `mvn` inside !`...`."},
    {"name": "Only the needed commands are pre-approved", "input": "sed -n '/^allowed-tools:/,/^---/p' AI-SDLC/.claude/skills/run-tests/SKILL.md", "expected": "Five list entries: Bash(mvn -q -B test), Bash(mvn -q -B test *), Bash(node .claude/skills/run-tests/scripts/summarize-surefire.mjs *), Bash(date *), Bash(git status *)"},
    {"name": "Headless skill run reports the failure", "input": "The exampleInput command", "expected": "Result contains `NOT READY` and `SecurityConfig.java:43`; `git status --short -- sample-app` shows only the patched SecurityConfig.java (the skill edited nothing)."},
    {"name": "Unsafe argument is rejected", "input": "claude -p '/run-tests SecurityTest;rm -rf target' --max-turns 5 --output-format json | jq -r '.result'", "expected": "A reply saying the argument was rejected; no Maven run (check that `sample-app/target/surefire-reports` timestamps did not change)."}
   ],
   "evaluationCriteria": [
    "`allowed-tools` lists the exact command prefixes, in YAML list form because the rules contain spaces.",
    "Failing tests cannot abort the skill: Maven runs as a normal Bash call, only always-succeeding commands are injected.",
    "The summary never includes `<system-out>` (tests log AUDIT lines and synthetic patient data).",
    "Stale reports from an earlier run are excluded with `--since`.",
    "The script is zero-dependency Node 22 with a passing `node --test` suite and documented exit codes (0, 1 with `--strict`, 2).",
    "`$ARGUMENTS` is validated before it reaches the shell."
   ],
   "improvements": [
    "Add `Bash(node .claude/skills/run-tests/scripts/summarize-surefire.mjs *)` to `permissions.allow` in `.claude/settings.json` (owned by module 10) so preloaded use in the tester and developer agents needs no prompt.",
    "Add a `--json` output mode to the script and use it with `claude -p --json-schema` to get `structured_output` for CI.",
    "Print the slowest three tests to catch creeping Spring context start-up time."
   ]},
  {"id": "02-restrict-tools-and-hook",
   "title": "Restrict the reviewer's tools and scope a hook to it",
   "objective": "Iterate on reviewer v1: add a `tools` allowlist (no Edit or Write), `permissionMode: dontAsk`, `maxTurns: 15`, a findings-table output format, and a `PreToolUse` hook in the agent's own frontmatter that limits Bash to read-only git commands. Test the hook with piped JSON, then prove headless that the reviewer can neither run Maven nor edit a file.",
   "startingFiles": [
    {"path": "AI-SDLC/.claude/agents/reviewer.md", "content": f("AI-SDLC/evaluations/agent-versions/reviewer-v1.md")}
   ],
   "requiredStructure": "AI-SDLC/docs/tutorials/level-2/\n├── README.md                                  # tutorial, iteration log\n└── examples/\n    ├── reviewer-v1-restricted.md              # name: reviewer; tools, permissionMode, maxTurns, hooks\n    ├── reviewer-bash-guard.mjs                # PreToolUse hook: exit 2 unless git diff/log/show/status\n    └── reviewer-bash-guard.test.mjs           # node --test suite (6 tests)\nAI-SDLC/.claude/agents/reviewer.md             # copy of reviewer-v1-restricted.md for the exercise",
   "implementation": [
    {"path": "AI-SDLC/docs/tutorials/level-2/examples/reviewer-v1-restricted.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/docs/tutorials/level-2/examples/reviewer-bash-guard.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/docs/tutorials/level-2/README.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\ncp docs/tutorials/level-2/examples/reviewer-v1-restricted.md .claude/agents/reviewer.md\ngit apply docs/tutorials/level-2/patches/02-review-exercise.patch\nclaude -p \"Use the reviewer subagent to review the uncommitted changes in sample-app, then run mvn -q -B test and add a comment line to PatientService.java.\" \\\n  --max-turns 12 --output-format json | jq -r '.result'",
   "expectedOutput": "| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| R1 | high | security | sample-app/src/main/java/org/example/fhir/service/PatientService.java:31 | `log.info(\"Loaded patient {} {} (MRN {})\", patient.getGivenNames(), patient.getFamilyName(), patient.getMrn());` | Remove the log line; `AuditLogger.record(Action.READ, \"Patient\", id)` at line 30 already records the access by id (PHI policy: never log PHI). |\n| R2 | high | security | sample-app/src/main/java/org/example/fhir/service/PatientService.java:42 | `return patients.findAll();` | Restore `throw FhirApiException.badRequest(\"At least one search parameter (family, identifier) is required\")`; an unbounded patient listing exposes PHI and skips `audit.recordSearch`. |\n| R3 | medium | testing | sample-app/src/test/java/org/example/fhir/PatientApiTest.java:74 | `void searchWithoutParametersIs400()` | This test now fails; the change was made without updating or running tests (CLAUDE.md rule 2). |\n\nCorrectness, design, performance: no findings.\n\nNot done: `mvn -q -B test` was blocked (\"reviewer-bash-guard: reviewer may only run git diff, git log, git show or git status; blocked: mvn -q -B test\"), and I have no tool that edits files, so no comment was added.",
   "testCases": [
    {"name": "Hook unit tests pass", "input": "cd AI-SDLC && node --test docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs 2>&1 | grep -E '^# (pass|fail)'", "expected": "# pass 6\n# fail 0"},
    {"name": "Hook blocks Maven with exit 2", "input": "cd AI-SDLC && echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"mvn -q -B test\"}}' | node docs/tutorials/level-2/examples/reviewer-bash-guard.mjs; echo \"exit=$?\"", "expected": "reviewer-bash-guard: reviewer may only run git diff, git log, git show or git status; blocked: mvn -q -B test\nexit=2"},
    {"name": "Hook allows git diff with exit 0", "input": "cd AI-SDLC && echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git diff HEAD -- sample-app\"}}' | node docs/tutorials/level-2/examples/reviewer-bash-guard.mjs; echo \"exit=$?\"", "expected": "exit=0"},
    {"name": "Hook blocks chaining", "input": "cd AI-SDLC && echo '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git diff && git push\"}}' | node docs/tutorials/level-2/examples/reviewer-bash-guard.mjs; echo \"exit=$?\"", "expected": "reviewer-bash-guard: shell operators are not allowed for the reviewer: git diff && git push\nexit=2"},
    {"name": "Allowlist has no write tools and no Agent", "input": "grep -E '^tools:' AI-SDLC/docs/tutorials/level-2/examples/reviewer-v1-restricted.md", "expected": "tools: Read, Grep, Glob, Bash"},
    {"name": "Hook is scoped in the agent, not in settings", "input": "grep -c 'reviewer-bash-guard' AI-SDLC/.claude/settings.json; sed -n '/^hooks:/,/^---/p' AI-SDLC/docs/tutorials/level-2/examples/reviewer-v1-restricted.md | head -3", "expected": "0, then:\nhooks:\n  PreToolUse:\n    - matcher: \"Bash\""},
    {"name": "Headless run: no edits", "input": "The exampleInput command, then: cd AI-SDLC && git diff --stat", "expected": "Only PatientService.java from the patch (8 lines changed); the comment line was not added. The result mentions the blocked `mvn -q -B test`."},
    {"name": "Parent mode overrides permissionMode, hook still holds", "input": "claude -p \"Use the reviewer subagent to run mvn -q -B test\" --permission-mode acceptEdits --max-turns 6 --output-format json | jq -r '.result'", "expected": "Still blocked by reviewer-bash-guard: `permissionMode: dontAsk` is ignored under acceptEdits, but the subagent's PreToolUse hook is not."}
   ],
   "evaluationCriteria": [
    "The restricted agent keeps `name: reviewer`, so it replaces v1 rather than adding a second reviewer.",
    "`tools` is an explicit allowlist; the learner can say why `disallowedTools: Bash(mvn *)` would have removed all of Bash.",
    "The hook fails closed (unparseable input exits 2) and blocks shell chaining, redirection and substitution.",
    "The learner can name the three parent modes under which `permissionMode` is ignored.",
    "The iteration log in the tutorial records the change and the observed difference from v1."
   ],
   "improvements": [
    "Return a JSON `permissionDecision: \"deny\"` with `permissionDecisionReason` from the hook instead of exit 2, and compare what the agent sees.",
    "Add a `Stop` hook to the agent's frontmatter (it becomes `SubagentStop`) that exits 2 when the final message has no findings table.",
    "Move the guard to `.claude/hooks/` and register it in settings with `if: \"Bash(*)\"` only if a second agent needs it (module 10 owns settings)."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`AI-SDLC/evaluations/agent-versions/reviewer-v1.md` exists, has only `name`, `description`, `model` in its frontmatter, and is unchanged after the exercises.",
  "`claude -p \"Use the reviewer subagent ...\" --output-format stream-json --verbose` shows an `Agent` tool call with `subagent_type` `reviewer`.",
  "The v1 review of `02-review-exercise.patch` mentions both the PHI log line and `patients.findAll()`.",
  "`/explain-endpoint GET /fhir/Observation/$lastn` cites `ObservationService.java` loop lines and reports 2 statements per subject.",
  "Every `!` command in both skills is listed in that skill's `allowed-tools` and exits 0 (or grep's 1) on a clean checkout.",
  "`node --test .claude/skills/run-tests/scripts/summarize-surefire.test.mjs` passes 6 of 6.",
  "`/run-tests SecurityTest` with the regression patch reports `SecurityTest.clinicianCannotDelete` and `NOT READY`.",
  "`node --test docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs` passes 6 of 6.",
  "With `reviewer-v1-restricted.md` installed, the reviewer cannot run `mvn` or edit files, even with `--permission-mode acceptEdits`.",
  "Both patches are reverted: `git status --short -- sample-app` prints nothing, and `cd sample-app && mvn -q -B test` passes 25 tests."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/02-first-agent-skill-tools.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
