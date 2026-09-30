# Generator for content-frappe/modules/00-example.json (Frappe edition worked sample module).
# Run: python3 build/sources-frappe/00-example.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()
R = "AI-SDLC-frappe/"

mod = {
 "id": "00-example",
 "level": 1,
 "title": "Orientation: Project Memory and Context Engineering on a Frappe App",
 "summary": "Tour the Frappe edition of the AI-SDLC repository and give Claude Code the project knowledge every later agent depends on: a lean CLAUDE.md that knows where the bench is and which commands prove a change works, path-scoped rules for Python and DocType JSON, and a context pack that keeps PHI and site_config secrets out of every prompt.",
 "prerequisites": ["A working bench: `AI-SDLC-frappe/sample-app/scripts/setup-bench.sh` (Frappe v15, PostgreSQL 16)", "Git and a terminal", "Claude Code CLI installed and authenticated (`claude --version`)"],
 "concepts": [
  {"heading": "Why context comes before agents",
   "body_md": "A subagent starts with **no conversation history**. Per the docs it receives its own system prompt (the body of its `.claude/agents/<name>.md` file), the task message the main session sends it, basic environment details, git status, and the **CLAUDE.md hierarchy**. That last item is the only project knowledge every agent gets for free.\n\nOn a Frappe codebase this matters more than usual, because the knowledge an engineer needs is spread across places no generic model assumes:\n\n- the **bench** lives outside the repo (here `/home/user/frappe-bench`), so an agent that only sees the repo cannot even find the command that runs tests;\n- behaviour hides in **DocType JSON** (`permissions`, `search_index`, `autoname`), in **`hooks.py`**, and in **patches**, not only in Python;\n- secrets sit in **`site_config.json`** next to the code an agent is working on.\n\nSo in practice the quality of every agent in this course is capped by three things you write in this module:\n\n- `AI-SDLC-frappe/CLAUDE.md`: what the repo is, where the bench and site are, the commands that prove a change works, and the non-negotiable rules.\n- `AI-SDLC-frappe/.claude/rules/*.md`: rules that load only when Claude works on matching paths (Python vs DocType JSON).\n- `AI-SDLC-frappe/context/**`: reference material (architecture, Frappe coding standards, threat model, glossary) that agents read when the task needs it."},
  {"heading": "How CLAUDE.md loads (verified behaviour)",
   "body_md": "From `build/CLAUDE_CODE_FACTS.md` §6:\n\n- Project memory lives in `./CLAUDE.md` or `./.claude/CLAUDE.md`. Personal overrides go in `./CLAUDE.local.md` (git-ignored). That is the right place for *your* bench path if it differs from `/home/user/frappe-bench`.\n- Claude Code walks from the working directory **up** to the root and **concatenates** every CLAUDE.md it finds, root first. Nothing overrides; closer files are read last.\n- CLAUDE.md files in **subdirectories** load on demand, when Claude reads files in that directory.\n- `@path/to/file` imports another file, relative to the importing file, up to 4 hops deep. Imported files load with the CLAUDE.md that imports them. Imports are not expanded inside code spans or code blocks.\n- Target under 200 lines. Everything in CLAUDE.md costs tokens on *every* turn of *every* agent.\n\nThe design consequence: put **rules and commands** in CLAUDE.md, put **reference material** in `context/`, import only the two or three files almost every task needs, and name the rest by path. The standards file for Frappe code is long and matters only when code is written, so CLAUDE.md names it instead of importing it."},
  {"heading": "Two rule files: Python and DocType JSON",
   "body_md": "`.claude/rules/**/*.md` files are loaded as project instructions. The only frontmatter field Claude Code reads there is `paths` (a list of globs). A rule with `paths` applies only when Claude works with matching files.\n\nA Frappe app needs two different rule sets:\n\n- **`spice-lite-python.md`** (`paths: sample-app/spice_lite/**/*.py`): `frappe.get_list` not `frappe.get_all` in request paths, parameterised SQL, no `allow_guest`, names-only audit logging, keep `api/mappers.py` free of `import frappe`.\n- **`doctype-json.md`** (`paths` covering `**/doctype/**/*.json`, `patches.txt`, `hooks.py`): schema or data changes ship with a patch, `search_index` on filtered fields, never name documents by PHI, permission-array changes are security-reviewed, new `hooks.py` keys need an ADR.\n\nThe second file is the one generic agents get wrong: they edit a DocType JSON field and forget the patch, or widen `permissions` without anyone noticing. Keep every rule **testable**: a reviewer can check \"a DocType JSON change that retypes a field ships with a patch in `patches.txt`\"; nobody can check \"follow Frappe best practice\"."},
  {"heading": "Two meanings of \"hook\"",
   "body_md": "This course uses both kinds, so the words must stay separate:\n\n| | Frappe hook | Claude Code hook |\n|---|---|---|\n| Lives in | `spice_lite/hooks.py` | `.claude/settings.json` or agent/skill frontmatter |\n| Runs when | a document event, install, migrate, a scheduler tick | a Claude Code event such as `PreToolUse` |\n| Runs as | Python inside the Frappe site | a shell command on the developer machine |\n| Example here | `after_install = \"spice_lite.install.after_install\"` | `block-secrets.mjs` on `Edit|Write` |\n\nCLAUDE.md rule 5 tells every agent to say \"Frappe hook\" or \"Claude Code hook\", never bare \"hook\". It sounds pedantic until an agent adds a `doc_events` entry to `hooks.py` because a ticket asked it to \"add a hook that blocks secrets\"."},
  {"heading": "The context pack, PHI, and site_config",
   "body_md": "**Anything an agent reads can end up in a prompt, a log, a commit message, or an MCP call to Jira or GitHub.** The context pack does two jobs:\n\n1. **Informs**: `context/domain/spice-lite-glossary.md` defines `SL Patient`, `SL Encounter`, `SL Observation`, `SL Country`, MRN, LOINC codes and the FHIR-lite shapes exactly as `spice_lite` implements them, plus the country-app and integration-app patterns of a spice-style platform.\n2. **Constrains**: the glossary classifies every field as PHI or not (search terms are PHI too), and `context/security/phi-and-secrets-policy.md` says where PHI may never appear: logs, Error Log, `frappe.throw` messages, prompts, eval data.\n\nFrappe adds one more asset: `site_config.json` and `common_site_config.json` contain the database password and `encryption_key`. The policy forbids reading them, and `.claude/settings.json` enforces it with `Read(**/site_config.json)` in `permissions.deny`. The `PreToolUse` Claude Code hook `block-secrets.mjs` blocks writes containing site_config secrets, Frappe API tokens, or database URLs with passwords.\n\n**Rule of thumb:** instructions describe intent, permissions and Claude Code hooks enforce it. Write both."},
  {"heading": "What the reference repository contains",
   "body_md": "`AI-SDLC-frappe/` is the Claude Code project root. It already contains:\n\n- `sample-app/spice_lite/`: a real Frappe v15 app (four DocTypes, FHIR-lite whitelisted API, a patch, 37 integration and 9 unit tests passing on PostgreSQL 16 and MariaDB) with one labelled teaching defect (`TEACHING-DEFECT(perf-n+1)` in `lastn()`) and five discovered defects documented in `sample-app/docs/KNOWN_DEFECTS.md`.\n- `sample-app/scripts/setup-bench.sh`: the idempotent script that built the bench used by every exercise.\n- `.claude/settings.json`: `allow` for `bench --site test.localhost run-tests`, `ask` for `migrate`/`console`/`execute`, `deny` for `site_config.json` reads, `drop-site` and `reinstall`, plus the block-secrets Claude Code hook.\n- `.claude/agents/`, `.claude/skills/`, `agents/`, `workflows/`, `evaluations/`, `docs/`: filled in by later modules.\n\nThe Java edition of this course teaches the same system on a Spring Boot app; the two share the roster, skills, handoff format, and evaluation approach, so you can compare them side by side."}
 ],
 "diagrams": [
  {"title": "What a subagent actually receives at start-up",
   "mermaid": "flowchart LR\n  A[\"Agent file body<br/>(.claude/agents/NAME.md)\"] --> S((\"Subagent context\"))\n  T[\"Task message from main session\"] --> S\n  C[\"CLAUDE.md hierarchy + imports\"] --> S\n  G[\"git status + env details\"] --> S\n  K[\"Preloaded skills (skills field)\"] --> S\n  H[\"Main-session history\"] -. \"not passed\" .-> S\n  B[\"The bench, site_config.json\"] -. \"not visible unless named in CLAUDE.md; site_config denied\" .-> S"},
  {"title": "Where project knowledge lives in the Frappe edition",
   "mermaid": "flowchart TD\n  CM[\"CLAUDE.md: rules, bench path, commands\"] -->|\"@import\"| AO[\"context/architecture/overview.md\"]\n  CM -->|\"@import\"| GL[\"context/domain/spice-lite-glossary.md\"]\n  CM -->|\"@import\"| PP[\"context/security/phi-and-secrets-policy.md\"]\n  CM -.->|\"named, read on demand\"| ST[\"context/standards/frappe-coding-standards.md and others\"]\n  RP[\".claude/rules/spice-lite-python.md\"] -->|\"paths: **/*.py\"| PY[\"Python edits\"]\n  RJ[\".claude/rules/doctype-json.md\"] -->|\"paths: doctype JSON, patches.txt, hooks.py\"| DJ[\"Schema and Frappe hook edits\"]"}
 ],
 "comparisonTables": [
  {"title": "Where should this piece of Frappe knowledge go?",
   "columns": ["Knowledge", "Mechanism", "Why there", "Example in this repo"],
   "rows": [
    ["How to run tests, where the bench is", "`CLAUDE.md`", "Every agent needs it on every turn", "`bench --site test.localhost run-tests --app spice_lite`"],
    ["DocTypes, fields, PHI classification", "`@import` from CLAUDE.md", "Nearly every task touches the domain", "`@context/domain/spice-lite-glossary.md`"],
    ["get_list vs get_all, SQL parameters, whitelist rules", "`.claude/rules/spice-lite-python.md` with `paths`", "Only relevant when Python is edited", "`paths: sample-app/spice_lite/**/*.py`"],
    ["Patches, search_index, permissions array", "`.claude/rules/doctype-json.md` with `paths`", "Only relevant for schema and `hooks.py` edits", "`paths` on `**/doctype/**/*.json`"],
    ["Full coding, testing, API, review standards", "`context/standards/*.md` (named, not imported)", "Long; read by the agent whose task needs it", "`context/standards/frappe-coding-standards.md`"],
    ["Your personal bench path", "`CLAUDE.local.md`", "Machine-specific, git-ignored", "`Bench: /opt/bench/spice`"],
    ["Never read site_config.json", "`permissions.deny` (plus a CLAUDE.md rule)", "An instruction is not a control", "`Read(**/site_config.json)`"]
   ]}
 ],
 "exercises": [
  {"id": "00-claude-md",
   "title": "Write a CLAUDE.md that knows where the bench is",
   "objective": "Replace the stub `AI-SDLC-frappe/CLAUDE.md` with one that tells any agent what `spice_lite` is, where the bench and site are, which commands prove a change works (integration tests, unit tests, migrate), and which rules are non-negotiable, while importing only the three context files nearly every task needs. Verify that Claude Code loads it by asking a question only CLAUDE.md can answer.",
   "startingFiles": [
    {"path": R + "CLAUDE.md", "content": "# spice_lite\n\nThis is a Frappe app. Please write good code and tests.\n"}
   ],
   "requiredStructure": "AI-SDLC-frappe/\n├── CLAUDE.md                                  # < 200 lines, 3 @imports, bench path, commands\n├── .gitignore                                 # CLAUDE.local.md, .ai-sdlc/runs/\n├── context/\n│   ├── architecture/overview.md\n│   ├── domain/spice-lite-glossary.md\n│   └── security/phi-and-secrets-policy.md\n└── sample-app/spice_lite/                     # unchanged",
   "implementation": [
    {"path": R + "CLAUDE.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + ".gitignore", "language": "plaintext", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\nclaude -p \"Without running anything: which exact command runs the spice_lite integration tests, from which directory, and which two files must you never read? Answer in three bullet points.\" --output-format json | jq -r '.result'",
   "expectedOutput": "- From the bench directory (`/home/user/frappe-bench`), as the bench user: `bench --site test.localhost run-tests --app spice_lite`.\n- Unit tests that need no bench: `cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .`.\n- Never read `site_config.json` or `common_site_config.json`; they hold the database password and encryption keys.",
   "testCases": [
    {"name": "CLAUDE.md stays lean", "input": "wc -l AI-SDLC-frappe/CLAUDE.md", "expected": "Fewer than 200 lines (the reference file is about 45)."},
    {"name": "Exactly three imports that resolve", "input": "for p in $(grep -o '@context/[^ ]*' AI-SDLC-frappe/CLAUDE.md | tr -d '@'); do test -f AI-SDLC-frappe/$p && echo ok $p; done", "expected": "ok context/architecture/overview.md\nok context/domain/spice-lite-glossary.md\nok context/security/phi-and-secrets-policy.md"},
    {"name": "The documented test command really works", "input": "cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite 2>&1 | tail -3", "expected": "Ran 46 tests in 2.7s\n\nOK\n(46 = 37 integration + 9 unit; one expected Postgres error line printed by the D-2 pinning test is normal)"},
    {"name": "Claude answers from memory, not by guessing", "input": "The exampleInput command above", "expected": "The answer names `bench --site test.localhost run-tests --app spice_lite` and both config files. If it suggests `pytest` for the integration tests or `python manage.py test`, CLAUDE.md was not loaded (run it from inside AI-SDLC-frappe/)."},
    {"name": "Local overrides stay out of git", "input": "grep -x 'CLAUDE.local.md' AI-SDLC-frappe/.gitignore", "expected": "CLAUDE.local.md"}
   ],
   "evaluationCriteria": [
    "The bench location, site name and bench user are stated, and a personal override path (`CLAUDE.local.md`) is offered.",
    "Commands are copy-pasteable and correct for this bench (verified by running them).",
    "The \"hook\" ambiguity is resolved in the rules.",
    "Secrets rules name `site_config.json` and `common_site_config.json` explicitly.",
    "Long reference material is imported or named, not pasted inline."
   ],
   "improvements": [
    "Put your own bench path and site in `CLAUDE.local.md` if they differ from `/home/user/frappe-bench` and `test.localhost`.",
    "Add a `sample-app/spice_lite/CLAUDE.md` with app-internal tips (test users, `tests/utils.py` helpers); it loads only when Claude reads files there.",
    "Run `/memory` in an interactive session to confirm which memory files loaded."
   ]},
  {"id": "00-path-scoped-rules",
   "title": "Separate rules for Python and for DocType JSON",
   "objective": "Create `.claude/rules/spice-lite-python.md` and `.claude/rules/doctype-json.md` with `paths` globs, so Python conventions load for `.py` edits and the patch/permission rules load for DocType JSON, `patches.txt` and `hooks.py`. Show that a DocType field change pulls in the patch rule.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC-frappe/.claude/rules/\n├── spice-lite-python.md   # paths: sample-app/spice_lite/**/*.py\n└── doctype-json.md        # paths: **/doctype/**/*.json, patches.txt, hooks.py",
   "implementation": [
    {"path": R + ".claude/rules/spice-lite-python.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + ".claude/rules/doctype-json.md", "language": "markdown", "content": "", "tag": "verified-format"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\nclaude -p \"Plan (do not edit) adding a 'national_id' Data field to SL Patient and searching by it in search_patients. List the files you would change and the repo rules that apply.\" --permission-mode plan --output-format json | jq -r '.result'",
   "expectedOutput": "Files:\n1. sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json: add `national_id` (Data, `unique: 1`, `search_index: 1`).\n2. sample-app/spice_lite/spice_lite/api/fhir.py: accept an `identifier` system for national id in `search_patients`, still through `frappe.get_list`.\n3. sample-app/spice_lite/spice_lite/api/mappers.py: add a second `identifier` entry.\n4. A patch under `patches/v0_2/` listed in `patches.txt` only if existing rows need a value.\n5. Tests in `tests/test_fhir_api.py` and `tests/unit/test_mappers.py`.\nRules: `national_id` is PHI, so it is never logged or used as the document name; the new search goes through `frappe.get_list`; the field change is a schema change reviewed together with `patches.txt`.",
   "testCases": [
    {"name": "Frontmatter uses only paths", "input": "head -5 AI-SDLC-frappe/.claude/rules/doctype-json.md", "expected": "---\npaths:\n  - \"sample-app/spice_lite/**/doctype/**/*.json\"\n  - \"sample-app/spice_lite/spice_lite/patches.txt\""},
    {"name": "Globs match real files", "input": "cd AI-SDLC-frappe && ls sample-app/spice_lite/spice_lite/clinical/doctype/*/*.json sample-app/spice_lite/spice_lite/patches.txt | wc -l", "expected": "5 (four DocType JSON files plus patches.txt)"},
    {"name": "DocType task picks up the patch rule", "input": "The exampleInput command", "expected": "Output mentions `patches.txt`, `search_index`, and that `national_id` is PHI."},
    {"name": "Every Python rule names a real symbol", "input": "cd AI-SDLC-frappe/sample-app/spice_lite && grep -c 'def log_access' spice_lite/audit.py && grep -c 'import frappe' spice_lite/api/mappers.py", "expected": "1\n0"}
   ],
   "evaluationCriteria": [
    "Uses `paths` as the only frontmatter key.",
    "Python and schema rules are split so each loads only where it matters.",
    "Each rule is checkable against real code (`log_access`, `get_list`, `patches.txt`).",
    "Does not duplicate CLAUDE.md."
   ],
   "improvements": [
    "Add a rule for `**/fixtures/*.json` in a country app (Custom Field and Property Setter fixtures are schema changes too).",
    "Add a rule for `**/*.js` form scripts once the app has client code."
   ]},
  {"id": "00-context-pack",
   "title": "Build the domain, PHI and secrets context pack",
   "objective": "Write the spice_lite glossary with a PHI table (including search terms), the PHI and secrets policy (including `site_config.json`), and the threat model. Then prove the pack changes behaviour: ask Claude to draft the audit call for a patient search before and after the pack exists.",
   "startingFiles": [
    {"path": R + "context/domain/spice-lite-glossary.md", "content": "# Glossary\n\nSL Patient: a patient.\nSL Observation: a measurement.\n"}
   ],
   "requiredStructure": "AI-SDLC-frappe/context/\n├── domain/spice-lite-glossary.md         # DocTypes, rules, PHI table\n└── security/\n    ├── phi-and-secrets-policy.md          # PHI + site_config + API tokens\n    └── threat-model.md                    # STRIDE rows mapped to agent checks",
   "implementation": [
    {"path": R + "context/domain/spice-lite-glossary.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "context/security/phi-and-secrets-policy.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "context/security/threat-model.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\nclaude -p \"Write the one Python statement search_patients() should use to record the search for auditing, then one sentence explaining the choice.\" --permission-mode plan --output-format json | jq -r '.result'",
   "expectedOutput": "Before the context pack (typical):\nfrappe.logger().info(f\"search_patients family={family} identifier={identifier} -> {len(rows)} rows\")\n\nAfter the context pack:\nlog_access(\"search\", \"SL Patient\", rows, result_count=len(rows))\nSearch terms and MRNs are PHI under context/domain/spice-lite-glossary.md, so only the matching document names and a count are logged, through spice_lite.audit.log_access.",
   "testCases": [
    {"name": "PHI table covers search terms", "input": "grep -c 'Search terms' AI-SDLC-frappe/context/domain/spice-lite-glossary.md", "expected": "1"},
    {"name": "Policy names site_config and the enforcing mechanisms", "input": "grep -E 'site_config.json|permissions.deny|PreToolUse' AI-SDLC-frappe/context/security/phi-and-secrets-policy.md | wc -l", "expected": "At least 3 lines."},
    {"name": "The real code already follows the policy", "input": "grep -n 'log_access(' AI-SDLC-frappe/sample-app/spice_lite/spice_lite/api/fhir.py | head -3", "expected": "Calls pass document names and counts only, never `family` or `identifier`."},
    {"name": "Behaviour change", "input": "Run exampleInput with and without the glossary import in CLAUDE.md", "expected": "Without: the log line contains `family=` or `identifier=`. With: `log_access(...)` with names and a count only."},
    {"name": "No real data", "input": "grep -rE 'MRN-[0-9]{6}' AI-SDLC-frappe/context | grep -v 'MRN-000'", "expected": "No output: only synthetic MRN-000xxx values appear."}
   ],
   "evaluationCriteria": [
    "Glossary field names match the real DocType JSON (`mrn`, `last_name`, `effective_datetime`, …).",
    "Search terms are classified as PHI, which generic policies miss.",
    "Secrets section covers `site_config.json`, `common_site_config.json`, and API key/secret tokens.",
    "Each threat-model row maps to a check a named roster agent performs."
   ],
   "improvements": [
    "Add `context/domain/country-apps.md` describing how a country app customises `spice_lite` (Custom Fields, Property Setters, `doc_events`).",
    "Turn the PHI table into `phi-fields.json` so a Claude Code hook can scan diffs for new logging of those fields.",
    "Add the Error Log and Version DocTypes to the policy's list of places PHI must not reach, with a query a reviewer can run to check."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`AI-SDLC-frappe/CLAUDE.md` is under 200 lines, names the bench path and site, and has three `@context/...` imports that resolve.",
  "`bench --site test.localhost run-tests --app spice_lite` passes from the bench directory (Ran 46 tests, OK).",
  "`python -m unittest discover -s spice_lite/tests/unit -t .` passes without a bench (9 tests).",
  "Both rule files use only the `paths` frontmatter key and their globs match real files.",
  "The glossary classifies every DocType field and search terms as PHI or not.",
  "`site_config.json` reads are denied in `.claude/settings.json`, not just discouraged in prose.",
  "Frappe hooks and Claude Code hooks are never called bare \"hooks\" in your files."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content-frappe/modules/00-example.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
