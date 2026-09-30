# Generator for content/modules/05-agent-roster.json. Run: python3 build/sources/05-agent-roster.py
# Implementation contents are read from disk (byte-identical). agentContracts are produced from the
# CONTRACT.md files by docs/foundations/validate-contract.mjs --json, so module and repo cannot drift.
# The check-agents expected output is captured live from the real script.
import json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
SDLC = ROOT / "AI-SDLC"
def f(p): return (ROOT / p).read_text()
def run(cmd):
    r = subprocess.run(cmd, cwd=SDLC, shell=True, capture_output=True, text=True)
    return r.stdout + r.stderr, r.returncode

ROSTER = ["architect", "developer", "reviewer", "tester", "security", "sre"]

contracts = []
for a in ROSTER:
    out, code = run(f"node docs/foundations/validate-contract.mjs --json agents/{a}/CONTRACT.md")
    assert code == 0, out
    contracts.append(json.loads(out))

check_out, check_code = run("node agents/check-agents.mjs")
assert check_code == 0, check_out
def test_summary(file):
    out, code = run(f"node --test {file}")
    assert code == 0, out
    return "\n".join(l for l in out.splitlines() if l.startswith(("ok ", "not ok", "# tests", "# pass", "# fail")))
tg_summary = test_summary("agents/tool-guard.test.mjs")
ca_summary = test_summary("agents/check-agents.test.mjs")

hook_demo_cmd = (
    "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin HEAD\"},\"agent_type\":\"developer\"}' "
    "| CLAUDE_PROJECT_DIR=\"$PWD\" node agents/tool-guard.mjs bash-allow 'cd sample-app' 'mvn -q -B test' 'git diff' 2>&1; echo \"exit=$?\""
)
hook_demo_out, _ = run(hook_demo_cmd)
write_demo_cmd = (
    "printf '%s' '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"sample-app/src/main/java/org/example/fhir/api/X.java\"},\"agent_type\":\"architect\"}' "
    "| CLAUDE_PROJECT_DIR=\"$PWD\" node agents/tool-guard.mjs write-scope docs/adr/ .ai-sdlc/runs/ 2>&1; echo \"exit=$?\""
)
write_demo_out, _ = run(write_demo_cmd)

ARCH_HANDOFF = """---
run_id: 2026-09-30-bug-observation-inactive-subject
step: 02
agent: architect
status: complete
inputs: [01-requirements.md]
next: developer
---
## Summary
`ObservationService.create` resolves the subject but never checks `active`, so glossary business rule 3 is not enforced. The fix belongs in the service layer and reuses the existing 422 path; no schema change, no new endpoint, no ADR needed.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| ARC-001 | high | design | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:50 | `Patient subject = patients.findById(subjectId)` then only `.orElseThrow(() -> FhirApiException.unprocessable("subject references unknown Patient/" + subjectId));` | After the lookup, reject `!subject.isActive()` with `FhirApiException.unprocessable("subject references inactive Patient/" + subjectId)` (glossary rule 3; coding-standards rule 3: business rules in services). |
| ARC-002 | medium | design | sample-app/src/test/java/org/example/fhir/ObservationApiTest.java:64 | `void observationForUnknownPatientIs422() throws Exception {` exists; no test creates a Patient with `"active": false` | Add `observationForInactivePatientIs422` next to it (testing-standards: negative cases return 422 OperationOutcome). |
| ARC-003 | low | docs | sample-app/README.md | `\\| POST \\| /fhir/Observation \\| subject must exist (422 otherwise) \\|` | Update to "subject must exist and be active (422 otherwise)". |

## Decisions
- Option A (chosen): check `isActive()` in `ObservationService.create` inside the existing `@Transactional` method. Same 422 contract as an unknown subject, covered by MockMvc.
- Option B (rejected): enforce in the database. A CHECK constraint cannot reference `patient.active`; a trigger would break the Flyway migrations' portability across PostgreSQL and H2.
- Option C (rejected): check in `ObservationController`. Business rules belong in services (coding-standards rules 1 and 3), and the controller does not load the Patient.
- No ADR: this enforces an already documented rule (glossary rule 3) and reuses an existing error response.
- Implementation outline: (1) regression test `observationForInactivePatientIs422`; (2) service check; (3) README row; (4) `cd sample-app && mvn -q -B test`.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/02-architect.md"""

REQS = """---
run_id: 2026-09-30-bug-observation-inactive-subject
step: 01
agent: orchestrator
status: complete
inputs: [ticket:BUG-61]
next: architect
---
## Summary
BUG-61: `POST /fhir/Observation` accepts an Observation whose subject is an inactive Patient (`"active": false`). Glossary business rule 3 says the subject must resolve to an existing, active Patient.

## Findings
No findings.

## Decisions
- AC1: `POST /fhir/Observation` for an inactive subject returns 422 with an `OperationOutcome` whose diagnostics name `Patient/{id}` only.
- AC2: Observations for active subjects keep returning 201.
- Out of scope: existing Observations of patients who become inactive later.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/01-requirements.md
"""

REVIEW_V2 = """---
run_id: 2026-09-30-feat-birthdate-search
step: 03
agent: reviewer
status: complete
inputs: []
next: developer
---
## Summary
Verdict: BLOCK. The change adds `GET /fhir/Patient?birthdate=YYYY-MM-DD` in `PatientController`, backed by a new derived query `PatientRepository.findByBirthDate`. 5 findings: 2 high, 2 medium, 1 low.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| REV-001 | high | security | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:54` | `log.info("Patient search birthdate={}", birthdate);` (birthDate is PHI in the glossary PHI table) | Remove the log line; record the search with `audit.recordSearch("Patient", result.size())` in the service (`phi-and-secrets-policy.md#PHI`, `coding-standards.md#7`). |
| REV-002 | high | testing | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:52` | `@GetMapping(params = "birthdate")`; `git diff --stat` shows no change under `sample-app/src/test/` | Add MockMvc tests in `PatientApiTest`: 200 searchset, 400 malformed date, 401 anonymous (`testing-standards.md`, API/integration row). |
| REV-003 | medium | correctness | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:55` | `repository.findByBirthDate(LocalDate.parse(birthdate))`; `DateTimeParseException` falls through to `GlobalExceptionHandler.handleUnexpected` (`"Internal server error"`), reasoned from code | Parse in the service and throw `FhirApiException.badRequest(...)` so a malformed date returns 400 (`api-standards.md` errors, `coding-standards.md#4`). |
| REV-004 | medium | design | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:31` | `private final PatientRepository repository;` and `repository.findByBirthDate(...)` at line 55 | Move the query behind `PatientService.searchByBirthDate` with `@Transactional(readOnly = true)` and the audit call (`coding-standards.md#1`, `#5`). |
| REV-005 | low | performance | `sample-app/src/main/java/org/example/fhir/repository/PatientRepository.java:17` | `List<Patient> findByBirthDate(LocalDate birthDate);` returns every match; no `_count` cap | Birth date is low-cardinality: cap results (planned `_count`, default 20, max 100) (`api-standards.md` pagination). |

## Decisions
- correctness: REV-003
- security: REV-001
- design: REV-004
- testing: REV-002
- performance: REV-005
- standards: no findings
- readability: no findings
- docs: no findings
- The diff does not touch `ObservationService.lastN`; the teaching defect was not reviewed.

## Open questions
- Should birth-date search require a second criterion (family or identifier), like `PatientService.search`, so one PHI field cannot list many patients?

## Artifacts
- none written; returned to main session"""

REVIEW_V1_TYPICAL = """Here are the issues I found, most important first:

1. **Logging PHI** - the new `searchByBirthDate` logs the birth date. Birth dates are sensitive; consider removing it.
2. **Controller uses the repository directly** - better to go through `PatientService`.
3. **Date parsing** - `LocalDate.parse` can throw; you may want to handle that.

I tried to remove the `log.info` line in PatientController.java for you, but the edit was not permitted. Overall the change is small and looks reasonable once these are addressed."""

mod = {
 "id": "05-agent-roster",
 "level": 3,
 "title": "The Agent Roster: Six Specialised Subagents with Contracts",
 "summary": "Build the six roster agents (architect, developer, reviewer, tester, security, sre) as real `.claude/agents/*.md` files with deliberate model, tool, permission-mode and skill choices, an Agent Contract for each, agent-scoped hooks that enforce write and command scope, and a zero-dependency conformance checker that proves the runtime files match their contracts. The reviewer ships as v2, improved over the module 02 snapshot, so module 09 can measure the difference.",
 "prerequisites": [
  "01-foundations",
  "02-first-agent-skill-tools",
  "03-skills-architecture-code-test",
  "04-skills-security-performance-rca",
  "Node 22 (for the guard and checker scripts), Java 21 and Maven 3.9 (for the tester and developer)",
  "Claude Code CLI installed and authenticated (`claude --version`)"
 ],
 "concepts": [
  {"heading": "From one agent to a roster: one job, one contract, one handoff",
   "body_md": "Module 02 built a single reviewer that could do anything. A roster splits the SDLC into six narrow jobs, because narrow agents are easier to **permission**, **evaluate** and **trust**:\n\n| Agent | Job | Changes code? |\n|---|---|---|\n| `architect` | options, risks, ADR | no (ADRs and run folder only) |\n| `developer` | implement an approved plan with tests | yes |\n| `reviewer` | findings on a diff | no |\n| `tester` | test strategy, missing tests, run suite | tests only |\n| `security` | authN/Z, PHI, injection, secrets | no |\n| `sre` | RCA, performance, deployability | no (proposes patches) |\n\nEach agent is three artifacts that must agree:\n\n- `AI-SDLC/.claude/agents/<name>.md`: the runtime definition Claude Code loads (verified format).\n- `AI-SDLC/agents/<name>/CONTRACT.md`: the Agent Contract (course convention, template from module 01-foundations).\n- A **handoff** under `.ai-sdlc/runs/<run-id>/NN-<name>.md` in the canonical format of `workflows/README.md`.\n\n**Topology is flat on purpose.** Current Claude Code lets a subagent spawn subagents (up to three layers by default, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes it). None of the six lists `Agent` in `tools`, and all six put `Agent` in `disallowedTools`, so every roster agent runs at depth 1 and every delegation decision is made by the orchestrator in the main thread (modules 07 and 08). That keeps runs auditable: one transcript per step, one handoff per step.\n\nSo in practice: when an agent needs another agent's skill, it does not call it. It says so in its handoff (`next: security`) and the orchestrator decides."},
  {"heading": "Anatomy of a roster agent file",
   "body_md": "Only `name` and `description` are required; unknown keys are **silently ignored**, so a typo such as `allowed-tools` (skill syntax) or `permission-mode` fails without any error. The roster uses only documented camelCase subagent fields:\n\n- `description`: when to delegate. It names the trigger (\"after the developer agent finishes\") and the limit (\"Read-only; never edits files\"). Claude matches tasks against this text.\n- `tools`: an **allowlist**. Omitting it inherits every tool, including MCP tools and `Agent`.\n- `disallowedTools`: a second guard that survives someone deleting `tools` later.\n- `model`, `effort`, `maxTurns`: cost and depth per role (next concepts).\n- `permissionMode`: `acceptEdits` for writers, `dontAsk` for read-only reviewers, inherited for `sre`.\n- `skills`: preloads the full skill content at start-up (architect: `architecture-review`; reviewer: `code-review`; tester: `test-strategy`, `run-tests`; security: `security-review`; sre: `performance-review`, `production-rca`; developer: `run-tests`). A skill with `disable-model-invocation: true` cannot be preloaded. `Skill` itself is not in any `tools` list, so agents cannot pull in other skills mid-run.\n- `hooks`: `PreToolUse` hooks that run only inside this agent.\n- `color`: so you can tell agents apart in the UI.\n\nThe **body** is the whole system prompt: subagents do not get the Claude Code system prompt or your conversation. Every roster body has the same seven parts: inputs it receives, context files to read (by path), numbered procedure, exact handoff template, stop conditions, what to do when blocked, and a short \"Never\" list. The body points at its CONTRACT.md and says the contract wins on conflict, which gives reviewers of the agent one place to look."},
  {"heading": "Least privilege in layers: tools, hooks, permission rules, modes",
   "body_md": "The four control layers (`tools`/`disallowedTools`, agent `hooks`, `permissions` rules, `permissionMode`) and the table comparing them are taught in module 02-first-agent-skill-tools (\"Controls for what an agent may do\"). Remember from there that a specifier in `disallowedTools` removes the whole tool and that `permissionMode` is ignored under `bypassPermissions`, `acceptEdits` and `auto` parents. The roster adds one more trap and one shared hook:\n\n- **`Write(...)` path rules are never consulted.** Only `Read(...)` and `Edit(...)` path rules are. You cannot scope the architect's Write to `docs/adr/` with a permission rule, so write scope must come from a hook.\n- **`memory` auto-enables Read, Write and Edit**, so no read-only roster agent sets it.\n\nThe hook is `AI-SDLC/agents/tool-guard.mjs` (a course pattern, not a built-in feature), referenced from each agent's frontmatter with two modes: `write-scope <prefix>... [!protected]` and `bash-allow <command-prefix>...`. It always blocks `git push`, `git commit`, mutating `kubectl`, recursive `rm`, `curl`/`wget`, shell chaining other than `&&`, and three `git` flags that turn a read-only command into something else: `--output` (writes a file), `--no-index` (reads arbitrary paths such as `.env`, sidestepping the `Read` deny rules), `--ext-diff` (runs a program). It fails closed on unreadable input.\n\nOne precondition: Claude Code runs a **project** agent's frontmatter hooks only after the workspace trust dialog for the folder has been accepted in an interactive session. A `claude -p` run in a folder that was never trusted skips them (it also ignores `permissions.allow` from `.claude/settings.json`), while hooks from settings files such as `block-secrets.mjs` still run. So start `claude` interactively in `AI-SDLC/` once and accept the dialog before the headless exercises in this module.\n\nSo in practice the reviewer's Bash is safe even when the main session runs in `acceptEdits`: the mode is ignored, the hook is not."},
  {"heading": "Model, effort and turn budget per role",
   "body_md": "Model choice is a cost-of-error decision, not a prestige one.\n\n| Agent | `model` | `effort` | `maxTurns` | Why |\n|---|---|---|---|---|\n| architect | `opus` | high | 30 | a wrong design costs weeks; few calls per feature |\n| security | `opus` | high | 30 | a missed PHI leak is the expensive failure |\n| sre | `opus` | high | 30 | RCA needs hypothesis juggling across code, manifests and logs |\n| developer | `sonnet` | medium | 60 | many edit-test cycles; guided by an approved plan |\n| reviewer | `sonnet` | high | 25 | frequent; the preloaded checklist carries the rigour |\n| tester | `sonnet` | medium | 40 | pattern-following test code, many Maven runs |\n\n`haiku` is not used: every roster job needs code reading across several files. Aliases (`opus`, `sonnet`) track the current model; pin a full id such as `claude-opus-5-5` only when you need reproducibility, for example in evals.\n\nResolution order matters for evaluation: the per-invocation `model` on the Agent call wins, then the frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces the env model onto all subagents. When module 09 compares reviewer v1 (`model: inherit`) with v2 (`model: sonnet`), pin both to the same model (this module's exercise passes `model: sonnet` for v1 explicitly), so the measured difference comes from prompt, tools and skills, not from the model.\n\n`maxTurns` is a stop condition, not a target: when it is hit the output is marked partial, and every roster body tells the agent to return `status: blocked` instead of presenting partial work as complete."},
  {"heading": "Handoffs, read-only agents, and stopping well",
   "body_md": "Every step ends with one handoff document (front matter `run_id`, `step`, `agent`, `status`, `inputs`, `next`; sections Summary, Findings, Decisions, Open questions, Artifacts). Who **writes** it depends on the agent's tools:\n\n- `architect`, `developer`, `tester` have Write scoped by hook to `.ai-sdlc/runs/`, so they write `NN-<agent>.md` themselves.\n- `reviewer`, `security`, `sre` have no Write. Their **final message is the handoff document**, starting at `---`, and the orchestrator saves it verbatim (its Write is limited to the run folder). Headless, you save `.result` yourself.\n\nGiving a reviewer Write \"just for its report\" would re-open the door to editing the code it reviews. Also note `memory: project` **auto-enables Read, Write and Edit**, so no read-only roster agent uses `memory`.\n\n`status` has three values and each body says exactly when to use which:\n\n- `complete`: the step's exit criteria hold (for the developer: `mvn -q -B test` passed on final code).\n- `blocked`: the agent cannot proceed within its contract: empty diff, missing plan, a hook denial, three failed fix cycles, `maxTurns` near.\n- `needs-human`: a decision belongs to a person: ADR written, public API changed, `SecurityConfig` touched, production mitigation proposed.\n\nWhen blocked, an agent **never retries with a variation** (another path, a pipe, a different tool). Retrying around a guard is exactly the behaviour you do not want from an agent with repository access. It records the denied action under Open questions and stops. `.claude/hooks/check-handoff.mjs` (module 08) validates the format on `SubagentStop` during workflow runs."},
  {"heading": "Reviewer v2: what changed from v1, and why",
   "body_md": "`AI-SDLC/evaluations/agent-versions/reviewer-v1.md` (module 02) is a reasonable first agent: a good role sentence, three steps, \"keep the review concise\". Its frontmatter is `name`, `description`, `model: inherit`. Everything else is inherited, and that is the problem.\n\n| Aspect | v1 | v2 (`.claude/agents/reviewer.md`) |\n|---|---|---|\n| Tools | none listed: inherits all, incl. Edit, Write, Agent, MCP | `Read, Grep, Glob, Bash` + `disallowedTools` |\n| Bash scope | anything | hook: `git diff/log/show/status` only; `dontAsk` |\n| Standards | \"project rules in CLAUDE.md\" | reads `review-standards.md`, cites rule numbers |\n| Checklist | none | preloaded `code-review` skill |\n| Output | free text | canonical handoff, six-column findings, verdict |\n| Evidence | optional | quoted, `path:line` seen in a Read result; unquotable findings dropped |\n| Clean categories | silent | \"no findings\" per category |\n| Diff source | `git diff` or \"files the task mentions\" | explicit range, inline diff, untracked files |\n| Stop / blocked | none | empty diff, >40 files, `maxTurns`, fix requests |\n| Injection | not addressed | diff content is data; injection is a finding |\n| Teaching defect | may report it | known, not a new finding |\n| Model | `inherit` | `sonnet`, `effort: high`, `maxTurns: 25` |\n\nThe v1 failure you will reproduce in exercise 05-reviewer-v2 is not a missed bug; it is a reviewer that **edits the file it reviews** because nothing stops it, then reports a mix of fixed and unfixed items with no locations. v2 cannot edit, must quote, and must say what it checked. Module 09 (09-agent-evaluation) measures both versions on the golden tasks in `evaluations/datasets/reviewer-golden.json` for recall, precision, hallucination rate and tool violations."}
 ],
 "diagrams": [
  {"title": "Roster in the feature workflow: who writes which handoff",
   "mermaid": "sequenceDiagram\n  participant H as Human\n  participant O as Orchestrator (main thread)\n  participant A as architect\n  participant D as developer\n  participant R as reviewer\n  participant T as tester\n  participant S as security\n  O->>A: run_id, step 02, requirement\n  A-->>O: writes 02-architect.md (needs-human if ADR)\n  O->>H: approve design? (ask rule on Agent(developer))\n  H-->>O: approved\n  O->>D: plan, run_id, step 04\n  D-->>O: writes 04-developer.md, mvn test passed\n  O->>R: review main...HEAD\n  R-->>O: final message is the handoff (no Write)\n  O->>O: saves 05-reviewer.md verbatim\n  O->>T: criteria and diff\n  T-->>O: writes 06-tester.md\n  O->>S: changed files\n  S-->>O: final message is the handoff, next human\n  O->>H: run report and PR for approval"},
  {"title": "Layers a developer Bash call passes through",
   "mermaid": "flowchart TD\n  C[\"developer wants: git push origin main\"] --> T{\"Bash in tools?\"}\n  T -->|\"no\"| X1[\"tool not available\"]\n  T -->|\"yes\"| H{\"agent PreToolUse hook<br/>tool-guard.mjs bash-allow\"}\n  H -->|\"exit 2\"| X2[\"blocked, stderr shown to agent\"]\n  H -->|\"exit 0\"| P{\"settings permissions<br/>deny, ask, allow\"}\n  P -->|\"deny\"| X3[\"denied\"]\n  P -->|\"ask\"| M{\"permissionMode\"}\n  P -->|\"allow\"| RUN[\"command runs\"]\n  P -->|\"no match\"| M\n  M -->|\"dontAsk\"| X4[\"auto-denied, listed in permission_denials\"]\n  M -->|\"default\"| HU[\"human prompt\"]\n  HU -->|\"approve\"| RUN\n  HU -->|\"reject\"| X3"}
 ],
 "comparisonTables": [
  {"title": "Roster frontmatter at a glance",
   "columns": ["Agent", "tools", "disallowedTools", "permissionMode", "Hook scope", "skills", "Writes handoff itself?"],
   "rows": [
    ["architect", "Read, Grep, Glob, Write", "Agent, Bash, NotebookEdit, WebFetch, WebSearch", "acceptEdits", "write: `docs/adr/`, `.ai-sdlc/runs/`", "architecture-review", "yes"],
    ["developer", "Read, Grep, Glob, Edit, Write, Bash", "Agent, NotebookEdit, WebFetch, WebSearch", "acceptEdits", "write: `sample-app/src/`, run folder, not `V1__init.sql`; bash: `cd sample-app`, `mvn -q -B test|compile`, summary script, `date -u`, read-only git", "run-tests", "yes"],
    ["reviewer", "Read, Grep, Glob, Bash", "Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch", "dontAsk", "bash: `git diff|log|show|status`", "code-review", "no, final message"],
    ["tester", "Read, Grep, Glob, Edit, Write, Bash", "Agent, NotebookEdit, WebFetch, WebSearch", "acceptEdits", "write: `sample-app/src/test/`, run folder; bash: Maven, summary script, read-only git", "test-strategy, run-tests", "yes"],
    ["security", "Read, Grep, Glob", "Agent, Bash, Edit, Write, NotebookEdit, WebFetch, WebSearch", "dontAsk", "none needed (no Bash, no Write)", "security-review", "no, final message"],
    ["sre", "Read, Grep, Glob, Bash", "Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch", "inherit (kubectl prompts in default)", "bash: read-only `kubectl`, `count-queries.mjs`, read-only git", "performance-review, production-rca", "no, final message"]
   ]},
  {"title": "Reviewer v1 vs v2 on the seeded birth-date diff (what to look for)",
   "columns": ["Check", "v1 typical", "v2 expected"],
   "rows": [
    ["Edits files during review", "can (inherits Edit/Write)", "cannot (not in tools, in disallowedTools)"],
    ["PHI in log line flagged", "usually, no location", "REV-001 high, `PatientController.java:54`, quoted"],
    ["Missing tests flagged", "often missed", "REV-002 high"],
    ["500 on malformed date", "\"may want to handle\"", "REV-003 medium, names `handleUnexpected`"],
    ["Layering violation", "mentioned", "REV-004 medium, cites coding-standards rule 1"],
    ["Categories reported clean", "never", "every category checked"],
    ["Output parseable by check-handoff.mjs", "no", "yes"]
   ]}
 ],
 "exercises": [
  {"id": "05-roster-smoke-test",
   "title": "Create the roster files and smoke-test each agent",
   "objective": "Create five of the six roster agents (architect, developer, tester, security, sre; the reviewer is exercise 05-reviewer-v2) with their Agent Contracts, then prove each one loads with its own system prompt using `claude -p --agent <name>`, and run the architect on a real requirement: BUG-61, Observations accepted for inactive patients (glossary business rule 3, which `ObservationService.create` does not enforce today).",
   "startingFiles": [
    {"path": "AI-SDLC/.ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/01-requirements.md", "content": REQS}
   ],
   "requiredStructure": "AI-SDLC/\n├── .claude/agents/\n│   ├── architect.md      # opus, Read/Grep/Glob/Write, write-scope hook, skills: architecture-review\n│   ├── developer.md      # sonnet, + Edit/Bash, write-scope + bash-allow hooks, skills: run-tests\n│   ├── tester.md         # sonnet, test-only write scope, skills: test-strategy, run-tests\n│   ├── security.md       # opus, Read/Grep/Glob only, dontAsk, skills: security-review\n│   └── sre.md            # opus, read-only kubectl hook, skills: performance-review, production-rca\n├── agents/\n│   ├── tool-guard.mjs    # from exercise 05-tool-guards-and-denials (hooks reference it)\n│   └── <agent>/CONTRACT.md   # eleven sections from agents/CONTRACT_TEMPLATE.md\n└── .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/\n    ├── 01-requirements.md   # starting file\n    └── 02-architect.md      # written by the architect",
   "implementation": [
    {"path": "AI-SDLC/.claude/agents/architect.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/agents/developer.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/agents/tester.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/agents/security.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.claude/agents/sre.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/agents/architect/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/agents/developer/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/agents/tester/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/agents/security/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/agents/sre/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\n# 1. Smoke test: each agent answers from its own system prompt, no tools.\nfor a in architect developer tester security sre; do\n  claude -p --agent \"$a\" --max-turns 2 --output-format json \\\n    \"Smoke test. Without using any tool: in one sentence state your job, then give the exact path pattern of your handoff.\" \\\n  | jq -r --arg a \"$a\" '\"\\($a): \\(.subtype) turns=\\(.num_turns) | \\(.result | gsub(\"\\n\"; \" \"))\"'\ndone\n\n# 2. Real task for the architect (interactive alternative: type @agent-architect in a session).\nclaude -p --agent architect --output-format json \\\n  \"Run id 2026-09-30-bug-observation-inactive-subject, step 02. Requirement: .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/01-requirements.md\" \\\n  | jq '{subtype, num_turns, total_cost_usd}'\nnode .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject",
   "expectedOutput": "architect: success turns=1 | I turn a requirement into options, risks and a proposed ADR for the FHIR-lite API, without writing application code. Handoff: .ai-sdlc/runs/<run-id>/<step>-architect.md\ndeveloper: success turns=1 | I implement an approved plan in sample-app with tests and prove it with mvn -q -B test; I never commit or push. Handoff: .ai-sdlc/runs/<run-id>/<step>-developer.md\ntester: success turns=1 | I derive the required tests for a change, write the missing ones under sample-app/src/test and run the suite. Handoff: .ai-sdlc/runs/<run-id>/<step>-tester.md\nsecurity: success turns=1 | I review code and configuration for vulnerabilities and PHI exposure and return findings; I cannot run commands or edit files. My final message is the handoff, saved by the orchestrator to .ai-sdlc/runs/<run-id>/<step>-security.md\nsre: success turns=1 | I find the root cause of latency, errors or deploy risk from code, manifests and read-only cluster state and propose fixes. My final message is the handoff, saved to .ai-sdlc/runs/<run-id>/<step>-sre.md\n\n{ \"subtype\": \"success\", \"num_turns\": 9, \"total_cost_usd\": 0.41 }\nPASS  .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/01-requirements.md\nPASS  .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/02-architect.md\n\n$ cat .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/02-architect.md\n" + ARCH_HANDOFF,
   "testCases": [
    {"name": "All five agents load with their own prompt", "input": "The smoke-test loop in exampleInput", "expected": "Five lines with `success`; each names its own agent-specific handoff path. A generic answer (\"I am Claude Code\") means the file did not load: check the `name` field and restart the session if `.claude/agents/` was just created."},
    {"name": "Architect writes only its handoff for a non-significant change", "input": "git status --short docs/adr sample-app; ls .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject", "expected": "No changes under `docs/adr` or `sample-app`; the run folder lists `01-requirements.md` and `02-architect.md`."},
    {"name": "Handoff passes the workflow validator", "input": "node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject", "expected": "Two PASS lines, exit 0."},
    {"name": "Architect found the real gap", "input": "grep -c 'ObservationService.java:5[0-1]' .ai-sdlc/runs/2026-09-30-bug-observation-inactive-subject/02-architect.md", "expected": "1 or more: a finding cites the `findById` lookup in `ObservationService.create` and glossary business rule 3."},
    {"name": "Contracts are valid", "input": "node docs/foundations/validate-contract.mjs agents/{architect,developer,tester,security,sre}/CONTRACT.md", "expected": "Five `OK ... 11/11 contract sections` lines, exit 0."},
    {"name": "Security agent has no Bash", "input": "claude -p --agent security --output-format json \"Run git status and paste the output.\" | jq -r .result", "expected": "The agent states it has no shell tool and cannot run git; no command output appears."}
   ],
   "evaluationCriteria": [
    "Every frontmatter key is in the documented subagent field list; no skill-style hyphenated keys.",
    "Each `description` names when to delegate and the agent's hard limit (read-only, never pushes).",
    "Model and effort choices are justified by cost of error, and the justification is in the contract or module text.",
    "Every body lists context files by path, a numbered procedure, the exact handoff template, stop conditions and blocked behaviour.",
    "No roster agent lists `Agent` in `tools`; all six list it in `disallowedTools`.",
    "The architect handoff cites `path:line` for current behaviour and rejects at least one option with a concrete reason."
   ],
   "improvements": [
    "Add `isolation: worktree` to the developer so each implementation runs in a temporary git worktree; update the reviewer's input to diff that worktree's branch.",
    "Give the sre agent `mcpServers` for a read-only metrics server (module 06) instead of raw `kubectl logs`.",
    "Pin `model: claude-opus-5-5` on security for reproducible evals and let the architect keep the `opus` alias.",
    "Add `initialPrompt` to the architect so `claude --agent architect` starts by listing open runs in `.ai-sdlc/runs/`."
   ]},
  {"id": "05-reviewer-v2",
   "title": "Reviewer v2: tighten, structure and compare against v1",
   "objective": "Turn the module 02 reviewer (`evaluations/agent-versions/reviewer-v1.md`) into `.claude/agents/reviewer.md` v2 with an explicit tool allowlist, a Bash hook, `dontAsk`, the preloaded `code-review` skill, the canonical handoff and stop conditions. Apply a seeded diff that adds a birth-date search with four real defects, run both versions on it, and record the differences module 09 will measure.",
   "startingFiles": [
    {"path": "AI-SDLC/agents/reviewer/fixtures/birthdate-search.patch", "content": ""}
   ],
   "requiredStructure": "AI-SDLC/\n├── .claude/agents/reviewer.md                     # v2: tools, disallowedTools, dontAsk, hook, skills: code-review\n├── agents/reviewer/\n│   ├── CONTRACT.md                                # final contract (draft was docs/foundations/reviewer-contract-draft.md)\n│   └── fixtures/birthdate-search.patch            # EXERCISE-DEFECT(module 05), applied with patch -p1\n└── evaluations/agent-versions/reviewer-v1.md      # unchanged v1 snapshot from module 02",
   "implementation": [
    {"path": "AI-SDLC/.claude/agents/reviewer.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/agents/reviewer/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\ngit switch -c exercise/birthdate-search\npatch -p1 < agents/reviewer/fixtures/birthdate-search.patch   # works whether or not AI-SDLC is the git root\n(cd sample-app && mvn -q -B test)                              # still green: the defects are not covered by tests\n\n# v2 (the project agent) as the main thread, headless; save the handoff it returns.\n# Interactive alternative that runs it as a real subagent: type @agent-reviewer review the working tree against HEAD\nmkdir -p .ai-sdlc/runs/2026-09-30-feat-birthdate-search\nclaude -p --agent reviewer --permission-mode dontAsk --output-format json \\\n  \"Run id 2026-09-30-feat-birthdate-search, step 03. Review the working tree against HEAD.\" \\\n  > /tmp/rev-v2.json\njq -r .result /tmp/rev-v2.json > .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md\nnode .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md\n\n# v1 for comparison, loaded from its snapshot via --agents JSON (same model, same dontAsk mode as v2)\nclaude -p --permission-mode dontAsk --output-format json --agents \"$(node -e '\n  const t=require(\"fs\").readFileSync(\"evaluations/agent-versions/reviewer-v1.md\",\"utf8\");\n  const [,fm,body]=t.split(/^---$/m);\n  const d=/description: (.*)/.exec(fm)[1];\n  console.log(JSON.stringify({\"reviewer-v1\":{description:d,prompt:body.trim(),model:\"sonnet\"}}))')\" \\\n  \"Use the reviewer-v1 agent to review the working tree against HEAD.\" > /tmp/rev-v1.json\njq -r .result /tmp/rev-v1.json\njq -c '.permission_denials | map({tool_name, file: .tool_input.file_path})' /tmp/rev-v1.json   # did v1 try to change the code it reviews?",
   "expectedOutput": "$ node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md\nPASS  .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md\n\n$ cat .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md\n" + REVIEW_V2 + "\n\n--- v1 (typical result on the same diff) ---\n" + REVIEW_V1_TYPICAL + "\n\n$ jq -c '.permission_denials | map({tool_name, file: .tool_input.file_path})' /tmp/rev-v1.json\n[{\"tool_name\":\"Edit\",\"file\":\"/home/dev/AI-SDLC/sample-app/src/main/java/org/example/fhir/api/PatientController.java\"}]\n(v1 inherits Edit, so it attempted to change the file under review; only dontAsk stopped it. In an acceptEdits session the edit would have gone through. v2 cannot attempt it: Edit is not in its tools.)",
   "testCases": [
    {"name": "Seeded diff applies and still builds", "input": "patch -p1 --dry-run < agents/reviewer/fixtures/birthdate-search.patch && (cd sample-app && mvn -q -B test)", "expected": "`checking file sample-app/src/main/java/org/example/fhir/api/PatientController.java` and `...PatientRepository.java`, then Maven exits 0 (25 tests): the defects are invisible to the current suite."},
    {"name": "v2 reports the four seeded defects", "input": "grep -E '^\\| REV-' .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md | awk -F'|' '{print $3,$4}'", "expected": "At least: `high security` (PHI log at line 54), `high testing` (no tests), `medium correctness` (LocalDate.parse, 500), `medium design` (controller to repository)."},
    {"name": "v2 did not edit anything", "input": "git diff --stat -- sample-app | tail -1", "expected": "`2 files changed, 20 insertions(+), 1 deletion(-)`: exactly the patch, nothing added by the reviewer."},
    {"name": "v1 vs v2 tool behaviour", "input": "jq '.permission_denials | length' /tmp/rev-v1.json /tmp/rev-v2.json", "expected": "v2: `0` (it never attempts a tool outside its allowlist). v1: often `1` or more, typically an `Edit` on `PatientController.java`; record the number for module 09's tool-violation metric."},
    {"name": "v2 verdict follows the blocking rule", "input": "grep -m1 '^Verdict:' .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md", "expected": "`Verdict: BLOCK.` because at least one finding is high."},
    {"name": "Every category is accounted for", "input": "sed -n '/^## Decisions/,/^## Open/p' .ai-sdlc/runs/2026-09-30-feat-birthdate-search/03-reviewer.md | grep -cE '^- (correctness|security|design|testing|performance|standards|readability|docs):'", "expected": "8"},
    {"name": "Contract and runtime agree", "input": "node agents/check-agents.mjs | grep reviewer", "expected": "`PASS  reviewer     model=sonnet mode=dontAsk tools=Read,Grep,Glob,Bash skills=code-review`"}
   ],
   "evaluationCriteria": [
    "v2 lists `tools` and `disallowedTools`; v1's inherited Edit/Write/Agent are gone.",
    "Every v2 finding has a `path:line` that exists after the patch and a verbatim quote.",
    "Severities match the `code-review` skill guide (PHI in logs high, controller-to-repository medium).",
    "The handoff validates with `.claude/hooks/check-handoff.mjs` and is returned as the final message, not written by the reviewer.",
    "The write-up names at least three v1-to-v2 differences and predicts which module 09 metric each one moves."
   ],
   "improvements": [
    "Add the birth-date patch as a golden task in `evaluations/datasets/reviewer-golden.json` (module 09 owns the dataset) with the four expected findings.",
    "Have the reviewer emit `--json-schema` structured output in headless runs so the eval harness does not parse Markdown tables.",
    "Split the security part of the review out entirely: route `security` findings with `next: security` instead of rating them itself."
   ]},
  {"id": "05-tool-guards-and-denials",
   "title": "Enforce write and command scope, and prove a denial",
   "objective": "Write the agent-scoped PreToolUse guard `agents/tool-guard.mjs`, test it offline with real hook input JSON, then prove in a headless run that a command outside the project allow rules is denied and shows up in the result's `permission_denials` array, and that removing the denial (a local allow rule) makes it disappear.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/agents/\n├── tool-guard.mjs        # modes: write-scope <prefix>... [!protected], bash-allow <prefix>...\n└── tool-guard.test.mjs   # node --test; spawns the hook with JSON on stdin\n\nReferenced from frontmatter, e.g. .claude/agents/developer.md:\nhooks:\n  PreToolUse:\n    - matcher: \"Edit|Write\"\n      hooks:\n        - type: command\n          command: \"node \\\"${CLAUDE_PROJECT_DIR}/agents/tool-guard.mjs\\\" write-scope sample-app/src/ .ai-sdlc/runs/ ...\"",
   "implementation": [
    {"path": "AI-SDLC/agents/tool-guard.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/agents/tool-guard.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\n# 1. Offline: the hook itself (no model needed)\nnode --test agents/tool-guard.test.mjs\n" + hook_demo_cmd + "\n" + write_demo_cmd + "\n\n# 2. Live: a command the hook allows but project settings do not pre-approve\n#    (settings allow only 'mvn -q -B test' and 'mvn -q -B test *', not compile)\nclaude -p --agent developer --permission-mode dontAsk --max-turns 4 --output-format json \\\n  \"Run exactly: cd sample-app && mvn -q -B compile . Report whether it ran. Do not run anything else.\" \\\n  | jq '{subtype, is_error, num_turns, permission_denials}'\n\n# 3. Allow it locally (settings.local.json is git-ignored) and run again\necho '{\"permissions\":{\"allow\":[\"Bash(cd sample-app && mvn -q -B compile)\",\"Bash(mvn -q -B compile)\"]}}' > .claude/settings.local.json\nclaude -p --agent developer --permission-mode dontAsk --max-turns 4 --output-format json \\\n  \"Run exactly: cd sample-app && mvn -q -B compile . Report whether it ran.\" | jq '{subtype, permission_denials}'\nrm .claude/settings.local.json",
   "expectedOutput": "# 1. offline (real output)\n" + tg_summary + "\n" + hook_demo_out.strip() + "\n" + write_demo_out.strip() + "\n\n# 2. headless run (shape per the Agent SDK result message; ids differ per run)\n{\n  \"subtype\": \"success\",\n  \"is_error\": false,\n  \"num_turns\": 3,\n  \"permission_denials\": [\n    {\n      \"tool_name\": \"Bash\",\n      \"tool_use_id\": \"toolu_01Q4mZkXv7Rb2n\",\n      \"tool_input\": {\n        \"command\": \"cd sample-app && mvn -q -B compile\",\n        \"description\": \"Compile sample-app\"\n      }\n    }\n  ]\n}\n\n# 3. after the local allow rule\n{\n  \"subtype\": \"success\",\n  \"permission_denials\": []\n}",
   "testCases": [
    {"name": "Guard unit tests pass", "input": "node --test agents/tool-guard.test.mjs", "expected": "`# pass 8`, `# fail 0`, exit 0."},
    {"name": "Push is blocked with exit 2 and a reason", "input": "The first printf pipeline in exampleInput", "expected": "stderr `tool-guard [developer] blocked Bash: \"git push\" is never allowed for this agent ...` and `exit=2`."},
    {"name": "Architect cannot write application code", "input": "The second printf pipeline in exampleInput", "expected": "`... is outside this agent's write scope: docs/adr/, .ai-sdlc/runs/` and `exit=2`."},
    {"name": "Read deny cannot be bypassed through git", "input": "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git diff --no-index /dev/null .env\"}}' | node agents/tool-guard.mjs bash-allow 'git diff'; echo $?", "expected": "Message naming `git diff --no-index (reads arbitrary paths, e.g. .env)` and `2`."},
    {"name": "Denial is visible headless", "input": "Step 2 of exampleInput", "expected": "`permission_denials` has one `Bash` entry whose `tool_input.command` contains `mvn -q -B compile`; `result` says the command was not permitted."},
    {"name": "Allow rule removes the denial", "input": "Step 3 of exampleInput", "expected": "`permission_denials` is `[]`; `git status --short` shows `.claude/settings.local.json` is gone again."}
   ],
   "evaluationCriteria": [
    "The guard blocks with exit code 2 (exit 1 would not block) and writes an actionable reason to stderr.",
    "It fails closed on malformed JSON and on unknown modes.",
    "Path checks resolve `..` and absolute paths against `CLAUDE_PROJECT_DIR` before matching.",
    "Chaining (`;`, `|`, backticks, `$(`, redirects, `&`) is rejected; only `&&` between allowed commands passes.",
    "The learner can explain why `disallowedTools: Bash(git push *)` was not used for the developer."
   ],
   "improvements": [
    "Log every block to `.ai-sdlc/guard.log` (ids and command names only) and add a `PermissionDenied` hook in settings to collect permission-layer denials in the same file.",
    "Replace prefix matching with a small tokenizer so quoted arguments containing `|` (for example `git log --format='%h|%s'`) are allowed.",
    "Move the always-deny list into `.claude/settings.json` `permissions.deny` (module 10-governance owns that file) so it also covers the main session."
   ]},
  {"id": "05-contract-conformance",
   "title": "Write and run a contract-conformance check for the roster",
   "objective": "Write `agents/check-agents.mjs`, a zero-dependency Node script that parses every `.claude/agents/*.md` frontmatter and fails when a key is undocumented, a name is off-roster, a roster agent can delegate, a `disallowedTools` specifier would remove a whole tool, `memory` would give a read-only agent Write, a preloaded skill is missing or not preloadable, a hook event does not exist, or the tools differ from the agent's CONTRACT.md. Run it on the real roster and on deliberately broken copies.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/agents/\n├── check-agents.mjs        # node agents/check-agents.mjs [--root DIR] [--json]; exit 0/1/2\n└── check-agents.test.mjs   # node --test; copies the roster to a temp dir and breaks one thing per test",
   "implementation": [
    {"path": "AI-SDLC/agents/check-agents.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/agents/check-agents.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode agents/check-agents.mjs; echo \"exit=$?\"\nnode --test agents/check-agents.test.mjs\n\n# Break it on purpose: the classic mistake from the permissions lesson\ncp .claude/agents/developer.md /tmp/developer.md.bak\nsed -i 's/^disallowedTools: .*/disallowedTools: Agent, Bash(git push *)/' .claude/agents/developer.md\nnode agents/check-agents.mjs > /tmp/check.txt; echo \"exit=$?\"; grep -A1 '^FAIL' /tmp/check.txt\ncp /tmp/developer.md.bak .claude/agents/developer.md",
   "expectedOutput": "# real output at build time\n" + check_out.strip() + "\nexit=0\n\n" + ca_summary + "\n\n# after the sed\nexit=1\nFAIL  developer    model=sonnet mode=acceptEdits tools=Read,Grep,Glob,Edit,Write,Bash skills=run-tests\n      error: disallowedTools entry \"Bash(git push *)\" removes the WHOLE Bash tool; scope commands with a hook or permission rules instead",
   "testCases": [
    {"name": "Shipped roster conforms", "input": "node agents/check-agents.mjs; echo $?", "expected": "Six `PASS` lines for the roster (plus the orchestrator) and `0`. Warnings about canonical skills not yet on disk are allowed; errors are not."},
    {"name": "Checker tests pass", "input": "node --test agents/check-agents.test.mjs", "expected": "`# pass 9`, `# fail 0`."},
    {"name": "Skill-style key is caught", "input": "Add `allowed-tools: Read` under `tools:` in `.claude/agents/reviewer.md`, run the checker, then revert", "expected": "`error: frontmatter key \"allowed-tools\" is not a documented subagent field (subagents use `tools` (allowed-tools is SKILL.md syntax)); unknown keys are silently ignored` and exit 1."},
    {"name": "Delegation is caught", "input": "Append `, Agent` to the `tools:` line of `.claude/agents/security.md`, run the checker, then revert", "expected": "`error: roster agents must not list Agent/Task in tools (flat, auditable, depth 1)` plus a tools-drift error against `agents/security/CONTRACT.md`."},
    {"name": "Machine-readable mode", "input": "node agents/check-agents.mjs --json | jq '.ok, (.results | length)'", "expected": "`true` and `7`."}
   ],
   "evaluationCriteria": [
    "Zero dependencies; runs on Node 22 with `node agents/check-agents.mjs` from `AI-SDLC/`.",
    "The documented-key list matches `build/CLAUDE_CODE_FACTS.md` section 1 exactly.",
    "Tool lists split on top-level commas only, so `Agent(architect, developer)` parses as one entry.",
    "Every rule has a failing test built from a real agent file, not a synthetic string.",
    "Exit codes distinguish failures (1) from usage errors (2), so CI can gate on it."
   ],
   "improvements": [
    "Run the checker in CI and as a `ConfigChange` hook with matcher `project_settings` so edits to agent files are checked on save (module 10-governance).",
    "Also compare `model`, `permissionMode` and `maxTurns` with values stated in each CONTRACT.md permissions paragraph.",
    "Validate that each hook `command` actually starts (spawn it with a sample input) instead of only checking the script path exists."
   ]}
 ],
 "agentContracts": contracts,
 "checklist": [
  "`.claude/agents/` contains architect, developer, reviewer, tester, security and sre, each with `name` equal to the file name.",
  "`node agents/check-agents.mjs` prints six roster `PASS` lines and exits 0.",
  "`node --test agents/tool-guard.test.mjs agents/check-agents.test.mjs` passes (17 tests).",
  "`node docs/foundations/validate-contract.mjs agents/*/CONTRACT.md` prints `OK` for all six roster contracts.",
  "No roster agent lists `Agent` in `tools`; every one lists it in `disallowedTools`.",
  "reviewer and security have no Write or Edit and no `memory`; their handoff is their final message.",
  "Every agent with Write or Edit has a `write-scope` hook; every agent with Bash has a `bash-allow` hook.",
  "Piping a `git push` hook input into the developer's guard exits 2 with a reason.",
  "A headless `claude -p --agent developer --permission-mode dontAsk` run shows the denied `mvn -q -B compile` in `permission_denials`.",
  "Reviewer v2 on `agents/reviewer/fixtures/birthdate-search.patch` returns a handoff that passes `.claude/hooks/check-handoff.mjs` with verdict BLOCK.",
  "`cd sample-app && mvn -q -B test` still passes after reverting the exercise patch (25 tests)."
 ]
}

for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
    for s in x["startingFiles"]:
        if s["content"] == "":
            s["content"] = f(s["path"])
out = ROOT / "content/modules/05-agent-roster.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
