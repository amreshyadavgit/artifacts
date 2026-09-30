# Generator for content/modules/00-example.json (worked sample module). Run: python3 build/sources/00-example.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

mod = {
 "id": "00-example",
 "level": 1,
 "title": "Orientation: Project Memory and Context Engineering",
 "summary": "Tour the AI-SDLC reference repository and give Claude Code the project knowledge every later agent depends on: a lean CLAUDE.md with on-demand imports, path-scoped rules for the Java code, and a context pack (domain, security, standards) that keeps PHI out of every prompt.",
 "prerequisites": ["Git and a terminal", "Java 21 and Maven 3.9 installed", "Claude Code CLI installed and authenticated (`claude --version`)"],
 "concepts": [
  {"heading": "Why context comes before agents",
   "body_md": "A subagent starts with **no conversation history**. Per the docs it receives its own system prompt (the body of its `.claude/agents/<name>.md` file), the task message the main session sends it, basic environment details, git status, and the **CLAUDE.md hierarchy**. That last item is the only project knowledge every agent gets for free.\n\nSo in practice the quality of every agent in this course is capped by three files you write in this module:\n\n- `AI-SDLC/CLAUDE.md`: what the repo is, the commands that prove a change works, and the non-negotiable rules (no PHI, tests must pass, never push).\n- `AI-SDLC/.claude/rules/*.md`: rules that load only when Claude works on matching paths.\n- `AI-SDLC/context/**`: longer reference material (architecture, standards, threat model, glossary) that agents read *when the task needs it*.\n\nA senior engineer onboarding to a codebase reads the README, the architecture doc, and the contributing guide before touching code. CLAUDE.md is where you tell Claude which of those to read, and when."},
  {"heading": "How CLAUDE.md loads (verified behaviour)",
   "body_md": "From `build/CLAUDE_CODE_FACTS.md` §6:\n\n- Project memory lives in `./CLAUDE.md` or `./.claude/CLAUDE.md`. Personal overrides go in `./CLAUDE.local.md` (git-ignored).\n- Claude Code walks from the working directory **up** to the root and **concatenates** every CLAUDE.md it finds, root first. Nothing overrides; closer files are read last.\n- CLAUDE.md files in **subdirectories** load on demand, when Claude reads files in that directory.\n- `@path/to/file` imports another file, relative to the importing file, up to 4 hops deep. Imports are not expanded inside code spans or code blocks.\n- Target under 200 lines. Everything in CLAUDE.md costs tokens on *every* turn of *every* agent.\n\nThe design consequence: put **rules and commands** in CLAUDE.md, put **reference material** in `context/`, and import only the two or three files almost every task needs. Name the rest by path so agents can `Read` them when relevant."},
  {"heading": "Path-scoped rules with .claude/rules",
   "body_md": "`.claude/rules/**/*.md` files are loaded as project instructions. The only frontmatter field Claude Code reads there is `paths` (a list of globs). A rule with `paths` applies only when Claude works with matching files; a rule without `paths` loads at launch like CLAUDE.md.\n\nUse this for stack-specific guidance that would be noise elsewhere. The Java conventions for `sample-app/` (records for DTOs, `OperationOutcome` via `GlobalExceptionHandler`, ids-only logging through `AuditLogger`) matter when editing `sample-app/src/**/*.java` and are irrelevant when the tester agent edits an eval dataset.\n\nKeep rules **testable**. \"Write clean code\" cannot be checked; \"New endpoints need MockMvc tests for success, 4xx, 401 and 403\" can be checked by the reviewer agent and by a human in code review."},
  {"heading": "The context pack and PHI",
   "body_md": "Healthcare adds a constraint most tutorials skip: **anything an agent reads can end up in a prompt, a log, a commit message, or an MCP call to Jira or GitHub.** The context pack therefore does two jobs:\n\n1. **Informs**: `context/domain/fhir-lite-glossary.md` defines Patient, Observation, Bundle, OperationOutcome, MRN, and LOINC codes exactly as the sample app implements them, so agents stop inventing FHIR fields that do not exist here.\n2. **Constrains**: the same glossary classifies each field as PHI or not, and `context/security/phi-and-secrets-policy.md` states where PHI may never appear. Later modules enforce this with real mechanisms (`permissions.deny` rules and a `PreToolUse` hook), because an instruction alone is not a control.\n\n**Rule of thumb:** instructions describe intent, permissions and hooks enforce it. Write both."},
  {"heading": "What the reference repository contains",
   "body_md": "`AI-SDLC/` is the Claude Code project root. It already contains the sample app and the shared configuration you build on:\n\n- `sample-app/`: Spring Boot 3.5 FHIR-lite API with 25 passing tests and one labelled teaching defect (`TEACHING-DEFECT(perf-n+1)` in `ObservationService.lastN`).\n- `.claude/settings.json`: permission `allow`/`ask`/`deny` rules and a `PreToolUse` hook that blocks secrets in file writes.\n- `.claude/agents/`, `.claude/skills/`: filled in by later modules.\n- `agents/<name>/CONTRACT.md`: the Agent Contract for each roster agent (architect, developer, reviewer, tester, security, sre, orchestrator).\n- `workflows/`, `evaluations/`, `docs/`: workflow specs, the eval harness, ADRs, and runbooks.\n\nEvery exercise in the course edits or runs something in this tree. Nothing is hypothetical."}
 ],
 "diagrams": [
  {"title": "What a subagent actually receives at start-up",
   "mermaid": "flowchart LR\n  A[\"Agent file body<br/>(.claude/agents/NAME.md)\"] --> S((\"Subagent context\"))\n  T[\"Task message from main session\"] --> S\n  C[\"CLAUDE.md hierarchy\"] --> S\n  G[\"git status + env details\"] --> S\n  K[\"Preloaded skills (skills field)\"] --> S\n  H[\"Main-session history\"] -. \"not passed\" .-> S\n  O[\"Output style / auto memory\"] -. \"not passed\" .-> S"},
  {"title": "Where project knowledge lives",
   "mermaid": "flowchart TD\n  CM[\"CLAUDE.md: rules and commands, loaded every turn\"] -->|\"@import\"| AO[\"context/architecture/overview.md\"]\n  CM -->|\"@import\"| GL[\"context/domain/fhir-lite-glossary.md\"]\n  CM -->|\"@import\"| PP[\"context/security/phi-and-secrets-policy.md\"]\n  CM -.->|\"named, read on demand\"| ST[\"context/standards/*.md\"]\n  R[\".claude/rules/sample-app-java.md\"] -->|\"paths: sample-app/src/**/*.java\"| J[\"Java edits only\"]"}
 ],
 "comparisonTables": [
  {"title": "Where should this piece of knowledge go?",
   "columns": ["Mechanism", "Loaded when", "Good for", "Bad for", "Example in this repo"],
   "rows": [
    ["`CLAUDE.md`", "Every turn, every agent", "Commands, hard rules, repo map", "Long reference docs", "`AI-SDLC/CLAUDE.md`"],
    ["`@import` from CLAUDE.md", "With CLAUDE.md", "The 2-3 docs nearly every task needs", "Docs only one agent needs", "`@context/domain/fhir-lite-glossary.md`"],
    ["`.claude/rules/*.md` with `paths`", "When Claude works on matching files", "Stack- or folder-specific conventions", "Global rules", "`.claude/rules/sample-app-java.md`"],
    ["`context/**` file (not imported)", "When an agent reads it", "Standards, threat model, ADRs", "Rules that must always apply", "`context/standards/testing-standards.md`"],
    ["Agent file body", "Only in that subagent", "Role-specific procedure", "Project facts all agents need", "`.claude/agents/reviewer.md` (module 05)"],
    ["`CLAUDE.local.md`", "Every turn, only on your machine", "Personal preferences", "Anything the team relies on", "git-ignored"]
   ]}
 ],
 "exercises": [
  {"id": "00-claude-md",
   "title": "Write a lean project CLAUDE.md with imports",
   "objective": "Create `AI-SDLC/CLAUDE.md` that tells any agent what the repo is, which commands prove a change works, and which rules are non-negotiable, while importing only the three context files nearly every task needs. Verify that Claude Code actually loads it by asking a question only CLAUDE.md can answer.",
   "startingFiles": [
    {"path": "AI-SDLC/CLAUDE.md", "content": "# AI-SDLC\n\nThis is a Spring Boot project. Please write good code and tests.\n"}
   ],
   "requiredStructure": "AI-SDLC/\n├── CLAUDE.md                                  # < 200 lines, 3 @imports\n├── context/\n│   ├── architecture/overview.md\n│   ├── domain/fhir-lite-glossary.md\n│   └── security/phi-and-secrets-policy.md\n└── sample-app/                                # unchanged",
   "implementation": [
    {"path": "AI-SDLC/CLAUDE.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": "AI-SDLC/.gitignore", "language": "plaintext", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude -p \"Without running anything: what exact command runs the sample-app tests, and what must never appear in logs? Answer in two bullet points.\" --output-format json | jq -r '.result'",
   "expectedOutput": "- Run `cd sample-app && mvn -q -B test` (tests must pass before reporting completion).\n- PHI must never appear in logs: log resource ids only, never MRN, names, birth dates, or observation values linked to a patient.",
   "testCases": [
    {"name": "CLAUDE.md stays lean", "input": "wc -l AI-SDLC/CLAUDE.md", "expected": "Fewer than 200 lines (the reference file is about 40)."},
    {"name": "Exactly three imports", "input": "grep -c '^- .*@context/' AI-SDLC/CLAUDE.md", "expected": "3"},
    {"name": "Imported files exist", "input": "for p in $(grep -o '@context/[^ ]*' AI-SDLC/CLAUDE.md | tr -d '@'); do test -f AI-SDLC/$p && echo ok $p; done", "expected": "ok context/architecture/overview.md\nok context/domain/fhir-lite-glossary.md\nok context/security/phi-and-secrets-policy.md"},
    {"name": "Claude answers from memory, not by guessing", "input": "The exampleInput command above", "expected": "The answer names `mvn -q -B test` inside `sample-app` and the ids-only logging rule. If it says `./gradlew test` or `mvn test` without `-q -B`, CLAUDE.md was not loaded (check you ran it from inside AI-SDLC/)."},
    {"name": "Local overrides stay out of git", "input": "grep -x 'CLAUDE.local.md' AI-SDLC/.gitignore", "expected": "CLAUDE.local.md"}
   ],
   "evaluationCriteria": [
    "Every rule is checkable by a reviewer (no \"write clean code\").",
    "Commands are copy-pasteable and correct for this repo.",
    "Long reference material is linked or imported, not pasted inline.",
    "PHI and secrets rules are stated explicitly and point to the policy file.",
    "The file names the roster agents and where their contracts live."
   ],
   "improvements": [
    "Run `/memory` in an interactive session to confirm which memory files loaded.",
    "Move the Commands section into a `context/standards/commands.md` if it grows past ten lines, and import it.",
    "Add a subdirectory `sample-app/CLAUDE.md` for Maven-specific tips; it loads only when Claude reads files there."
   ]},
  {"id": "00-path-scoped-rules",
   "title": "Add a path-scoped rule for the Java code",
   "objective": "Create `.claude/rules/sample-app-java.md` with a `paths` glob so the Java conventions load only when Claude works on `sample-app/src/**/*.java`. Show that a question about an eval JSON file does not pull the rule in, while a Java edit does.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/.claude/\n└── rules/\n    └── sample-app-java.md   # frontmatter: paths: [\"sample-app/src/**/*.java\"]",
   "implementation": [
    {"path": "AI-SDLC/.claude/rules/sample-app-java.md", "language": "markdown", "content": "", "tag": "verified-format"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude -p \"Add a GET /fhir/Patient/{id}/\\$summary endpoint plan (do not edit files). Which conventions from this repo apply to the controller and its tests?\" --permission-mode plan --output-format json | jq -r '.result'",
   "expectedOutput": "Conventions that apply:\n1. Return a `PatientResource` record from `api/`, never the `Patient` JPA entity.\n2. Missing patient: throw via `FhirApiException` so `GlobalExceptionHandler` returns a 404 `OperationOutcome`.\n3. Record access through `AuditLogger` with the patient id only.\n4. MockMvc tests: 200 success, 404 unknown id, 401 without credentials, 403 wrong role if restricted.\n5. No per-row queries in a loop.",
   "testCases": [
    {"name": "Frontmatter has only paths", "input": "sed -n '1,4p' AI-SDLC/.claude/rules/sample-app-java.md", "expected": "---\npaths:\n  - \"sample-app/src/**/*.java\"\n---"},
    {"name": "Rule is specific and checkable", "input": "grep -c '^- ' AI-SDLC/.claude/rules/sample-app-java.md", "expected": "6 bullet rules, each naming a concrete class, annotation, or test type."},
    {"name": "Java task picks up the rule", "input": "The exampleInput command", "expected": "Output mentions `AuditLogger`, `OperationOutcome`/`FhirApiException`, and 401/403 tests."},
    {"name": "No rule leakage for non-Java work", "input": "claude -p \"Which conventions apply when editing evaluations/datasets/architecture-golden.json?\" --permission-mode plan", "expected": "No mention of `AuditLogger` or MockMvc; answer refers to eval dataset conventions instead."}
   ],
   "evaluationCriteria": [
    "Uses `paths` as the only frontmatter key (the only one Claude Code reads for rules).",
    "Glob matches the Java sources and nothing else.",
    "Each rule references a real type in `sample-app` (verify with grep).",
    "Does not duplicate content already in CLAUDE.md."
   ],
   "improvements": [
    "Add `.claude/rules/k8s-manifests.md` with `paths: [\"sample-app/k8s/**\"]` for resource-limit and probe rules the sre agent relies on.",
    "Add a rule for `sample-app/src/main/resources/db/migration/**` stating that applied migrations are immutable."
   ]},
  {"id": "00-context-pack",
   "title": "Build the domain and PHI context pack",
   "objective": "Write the FHIR-lite glossary with a PHI classification table and the PHI and secrets policy, then prove the pack changes agent behaviour: ask Claude to draft a log line for a patient lookup before and after the pack exists, and compare.",
   "startingFiles": [
    {"path": "AI-SDLC/context/domain/fhir-lite-glossary.md", "content": "# Glossary\n\nPatient: a patient.\nObservation: a measurement.\n"}
   ],
   "requiredStructure": "AI-SDLC/context/\n├── domain/\n│   └── fhir-lite-glossary.md         # terms, business rules, PHI table\n└── security/\n    ├── phi-and-secrets-policy.md     # where PHI/secrets may never appear\n    └── threat-model.md               # STRIDE summary used by the security agent",
   "implementation": [
    {"path": "AI-SDLC/context/domain/fhir-lite-glossary.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/context/security/phi-and-secrets-policy.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": "AI-SDLC/context/security/threat-model.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude -p \"Write the SLF4J log statement PatientService.read(id) should emit after loading a Patient. One line of Java, then one sentence explaining the choice.\" --permission-mode plan --output-format json | jq -r '.result'",
   "expectedOutput": "Before the context pack (typical):\nlog.info(\"Loaded patient {} {} (MRN {})\", p.getGivenNames(), p.getFamilyName(), p.getMrn());\n\nAfter the context pack:\naudit.recordRead(\"Patient\", patient.getId());\nPatient names, MRN and birth date are PHI under context/domain/fhir-lite-glossary.md, so only the opaque resource id is logged, through AuditLogger.",
   "testCases": [
    {"name": "PHI table covers every Patient field", "input": "grep -E '^\\| (MRN|name, birthDate, gender|Patient `id`)' AI-SDLC/context/domain/fhir-lite-glossary.md | wc -l", "expected": "3"},
    {"name": "Policy names the enforcing mechanisms", "input": "grep -E 'permissions.deny|PreToolUse' AI-SDLC/context/security/phi-and-secrets-policy.md", "expected": "At least one line referencing `permissions.deny` and one referencing the `PreToolUse` hook."},
    {"name": "Behaviour change", "input": "Run exampleInput with and without the glossary import in CLAUDE.md", "expected": "Without: log line contains name or MRN. With: log line contains only the id, via `AuditLogger`."},
    {"name": "No real data", "input": "grep -rE 'MRN-[0-9]{6}' AI-SDLC/context | grep -v 'MRN-000'", "expected": "No output: only synthetic MRN-000xxx values appear."}
   ],
   "evaluationCriteria": [
    "Glossary terms match the actual sample-app DTO field names.",
    "Every PHI field has an explicit may-appear-in-logs answer.",
    "Policy distinguishes intent (instructions) from enforcement (permissions, hooks).",
    "Threat model rows map to a check a specific roster agent performs."
   ],
   "improvements": [
    "Add `context/domain/loinc-codes.md` listing the LOINC codes the tests use, so the tester agent stops inventing codes.",
    "Add a `context/security/data-retention.md` once the app stores audit events.",
    "Turn the PHI table into a machine-readable `phi-fields.json` that a hook can use to scan diffs."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`AI-SDLC/CLAUDE.md` is under 200 lines and has exactly three `@context/...` imports that resolve.",
  "`claude -p` run from `AI-SDLC/` answers the test command as `mvn -q -B test` inside `sample-app/`.",
  "`.claude/rules/sample-app-java.md` uses only the `paths` frontmatter key.",
  "The glossary classifies every Patient and Observation field as PHI or not.",
  "The PHI policy names the enforcing mechanisms (deny rules, hook), not just the intent.",
  "`CLAUDE.local.md` and `.ai-sdlc/runs/` are git-ignored.",
  "`cd AI-SDLC/sample-app && mvn -q -B test` passes (25 tests)."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/00-example.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
