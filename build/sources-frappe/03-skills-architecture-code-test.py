# Generator for content-frappe/modules/03-skills-architecture-code-test.json (Frappe edition).
# Run: python3 build/sources-frappe/03-skills-architecture-code-test.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()
R = "AI-SDLC-frappe/"
AR = R + ".claude/skills/architecture-review"
CR = R + ".claude/skills/code-review"
TS = R + ".claude/skills/test-strategy"

concepts = [
 {"heading": "A skill is a procedure plus the files it needs",
  "body_md": """A **skill** is a directory, not a prompt. `.claude/skills/<name>/SKILL.md` holds YAML frontmatter and a Markdown procedure; the other files in the directory are read or run only when the procedure points to them. From `build/CLAUDE_CODE_FACTS.md` §2:

- The **description** (plus `when_to_use`) is always in context, so Claude can decide to load the skill. The pair is truncated at 1,536 characters in the listing, so name the trigger situations early: "DocType schema, `hooks.py`, permissions, background jobs".
- The **body** loads when the skill is invoked (`/code-review`, or automatically by description) and stays in context for the session.
- **Supporting files** (`frappe-options.md`, `review-checklist.md`, `tooling-map.md`) are read on demand. **Scripts** are executed, not loaded, so a 200-line validator costs no context.
- Keep `SKILL.md` under 500 lines and link out.

Each skill in this module has the same shape:

```text
.claude/skills/architecture-review/
├── SKILL.md            # when, inputs, procedure, rules
├── frappe-options.md   # the Frappe decision axes with verified v15 behaviour
├── ADR_TEMPLATE.md     # output structure
├── checklist.md        # self-check before writing
├── examples/           # a real input and the expected output
└── scripts/            # zero-dependency Node validator + node:test tests
```

The procedure encodes how a senior Frappe engineer does the job **in this repository**: read `context/architecture/overview.md` before `api/fhir.py`, trace a whitelisted method through the mapper, controller, DocType JSON and `hooks.py`, check framework behaviour in the bench's `apps/frappe` source instead of from memory. The supporting files hold the parts that change on their own schedule; a new Frappe trap goes into `frappe-options.md` without touching the procedure.

Frontmatter used here, all from the documented list: `name`, `description`, `when_to_use`, `argument-hint`, `allowed-tools`, `disallowed-tools`. None of the three sets `disable-model-invocation: true`: a skill with that flag cannot be preloaded, and the architect, reviewer and tester agents (module 05-agent-roster) preload these skills through their `skills:` field."""},
 {"heading": "Feeding the skill real input: $ARGUMENTS and !`cmd` injection",
  "body_md": """A review skill is only as good as the diff it sees. Two documented mechanisms put the input in front of the model before it starts reasoning:

- **`$ARGUMENTS`** is replaced by everything after the command (`/code-review main` gives `main`). `$0` is the *first* argument. Without a placeholder, Claude Code appends `ARGUMENTS: <value>`.
- **`` !`command` ``** at the start of a line runs *before* the content is sent, and its output replaces the placeholder. It is checked against permission rules; outside auto mode anything not allowed aborts the invocation, as does a non-zero exit. `allowed-tools` pre-approves it for the skill.

`code-review/SKILL.md` injects:

```markdown
!`git diff --stat HEAD -- sample-app`
!`git status --short -- sample-app`
!`git diff HEAD -- sample-app`
```

All three match `Bash(git diff *)` / `Bash(git status *)` in the skill's `allowed-tools`, so the skill loads without a prompt from inside `AI-SDLC-frappe/` (the pathspec is relative to the working directory, and the git repository root can be one level up).

Details that bite on a Frappe app:

1. **Untracked files are invisible to `git diff`.** A patch that adds a new DocType folder shows nothing until `git add -N sample-app`. The skill also reads every `??` entry from `git status`.
2. **The diff must be read as a set.** A DocType JSON hunk without a matching `patches.txt` hunk is a finding, so the procedure sorts files into Python, DocType JSON, `patches.txt`, `hooks.py`, fixtures and tests before reviewing any of them.
3. **Arguments are untrusted.** The base ref is validated against `^[A-Za-z0-9._/~^-]+$` before `git diff <base>...HEAD` is built.
4. **`allowed-tools` pre-approves; it does not restrict.** `code-review` sets `disallowed-tools: Edit Write NotebookEdit` so the reviewer cannot edit while the skill is active.

So in practice: inject what the model must not guess, validate what the user types, and use `disallowed-tools` for a hard limit."""},
 {"heading": "Architecture decisions on a Frappe platform: where does the change live?",
  "body_md": """Most architecture questions on a spice-style platform are placement questions, and generic "design review" prompts never ask them. `architecture-review` makes the model decide each axis in `frappe-options.md` explicitly:

1. **Core, country app, integration app, or a core extension point.** A field every country needs is a core DocType change (plus a patch when data must change). A field one country needs is a Custom Field / Property Setter fixture in that country's app. Anything that talks to an external system (telephony, a national ID registry, ERPNext over REST) is an integration app with `required_apps = ["spice_lite"]`, which `install_app` installs first.
2. **Controller method or `doc_events`.** Rules of the DocType's own app live in the controller; behaviour owned by another app is registered through `doc_events` in that app's `hooks.py`. `override_doctype_class` is avoided: only one app can win.
3. **Synchronous or `frappe.enqueue`.** External calls go to a queue with explicit `queue`, `timeout`, `job_id`, `deduplicate=True`, and `enqueue_after_commit=True` when the job reads the triggering document.

Reading the real code for the worked example (ADR-0002, a national health ID for the Kenya deployment) turned up two facts a placement-only answer misses:

- `PATIENT_FIELDS` in `api/fhir.py:33` is a fixed list and `patient_to_fhir` emits one identifier (`mappers.py:52`), so a country Custom Field would never reach the API. The decision adds a small core **extension point**, an app-defined `hooks.py` key read with `frappe.get_hooks`.
- `parse_token` throws the token's system away (`mappers.py:113`): `parse_token('urn:spice:nhid|12345678')` returns `'12345678'`, which `search_patients` then looks up as an MRN. That is risk AR-001, and it exists today.

The Frappe source is evidence too: the ADR cites `apps/frappe/frappe/core/doctype/rq_job/rq_job.py:170` (`arguments=frappe.as_json(job.kwargs)`) to justify passing only the document name to the verification job, because job arguments are visible in desk. The validator's `--bench` flag checks those citations against the bench, `--repo` checks the repository ones."""},
 {"heading": "Reviewing Frappe diffs: what CI does not see",
  "body_md": """Claude Code ships a bundled `/code-review`. Per the docs (addendum in `build/CLAUDE_CODE_FACTS.md`), a project skill with the same name **replaces** the bundled command inside the project, but not its alias: `/review` still runs the bundled one. Inside `AI-SDLC-frappe/`, `/code-review` runs the house review: `context/standards/*` rule numbers, the canonical findings table, per-category `no findings`, and a verdict derived from `review-standards.md`. A personal `~/.claude/skills/code-review/` wins over the project one (personal > project), which is the first thing to check when reviews differ between machines.

The reason for a Frappe-specific review is measured, not assumed. Each golden patch in this module was applied to the app and the suite was run under the bench lock:

| Patch | `bench run-tests --app spice_lite` | What a probe showed |
|---|---|---|
| guest lookup with f-string `frappe.db.sql` | 46, OK | as Guest, an injected `name` returned 3 of 3 patients; `O'Brien` raised `psycopg2.errors.SyntaxError` |
| `frappe.get_all` in a new whitelisted read | 46, OK | `norole@spice-lite.test` got 200 with values; `lastn` gave the same user 403 |
| `reqd` field added to `sl_patient.json`, no patch | 46, OK | after `bench migrate` on a scratch site: `Ran 27 tests`, `FAILED (errors=14)`, all `MandatoryError ... national_id` |
| values in `frappe.log_error` | 46, OK | one Error Log row with `value=72.0` per rejected observation |
| `with_more_info=True` on the audit logger | 46, OK | `Form Dict: {'family': ..., 'identifier': ...}` appended to the audit log line |

CI is green every time. The DocType case is the instructive one: `bench run-tests` does not migrate, so a schema change is invisible to the suite until someone runs `bench migrate`, and then every save of an existing patient fails.

The checklist therefore ties each Frappe rule to a standard (`frappe.get_list` not `get_all`, no `allow_guest`, parameters in `values`, patches for `reqd`/rename/retype, no PHI in `log_error` or `with_more_info`), and the skill states the facts reviewers get wrong: `get_all` checks no permissions, `permission_query_conditions` affects `get_list` only, a DocType JSON is re-imported on migrate by content hash, so a missing `modified` bump is not a finding."""},
 {"heading": "Test strategy mapped to FrappeTestCase and bench run-tests",
  "body_md": """`test-strategy` plans eight categories and maps each to tooling that exists in a Frappe v15 bench (`tooling-map.md`):

- **unit**: stdlib `unittest` on `api/mappers.py`, no site (`python -m unittest discover -s spice_lite/tests/unit -t .`). No pytest: `run-tests --app` imports every `test_*.py`, and the bench venv has none.
- **integration, api, negative, edge**: `FrappeTestCase` plus `tests/utils.py::call`, which calls the whitelisted function in-process and returns `(http_status, body)`.
- **security**: `frappe.set_user` with the two test users, `frappe.guest_methods`, `frappe.allowed_http_methods_for_whitelisted_func`, and User Permissions (deleted in `finally`, because redis is not rolled back).
- **performance**: a query counter.
- **regression**: existing tests plus tests named after the defect id.

Commands go to the right level of `bench run-tests`: `--module` for iteration, `--test` for one method, `--case` for one class, `--app` before handoff, and `bench --verbose` (not `run-tests --verbose`) for names.

Running the plan's tests produced facts that change test design:

- **`assertQueryCount` is unusable on Postgres in Frappe v15.121.2.** It joins `last_query` values into its message, and on Postgres those are `LazyDecode` objects: `TypeError: sequence item 0: expected str instance, LazyDecode found`, even with a limit of 1000. On `mariadb.localhost` the same test passes. `testing-standards.md` names `assertQueryCount` for the performance smoke test, so the plan uses a counter and pins the framework defect with a regression test.
- **Three `lastn` defects besides the planted N+1.** A `system|code` token matches nothing; an `amended` Observation saved without `effective_datetime` loses to the final it replaces; a newer `preliminary` Observation with no value is reported as `0.0` (D-1). Each ships as a `@unittest.skip("SL-13x: ...")` test that fails for the stated reason when the skip is removed.
- **One Java-edition defect does not exist here.** Duplicate subjects are collapsed by `parse_subjects`, so the plan pins that with a passing test instead of reporting it.

So in practice: every `path:line` and every "fails today" claim in a plan is checked by running it on the bench, not by reading."""},
 {"heading": "Output contracts, golden cases, and skills as versioned assets",
  "body_md": """A skill whose output shape varies from run to run cannot feed another agent, CI, or an eval. Each skill here has an **output contract** and a **deterministic validator** (a course pattern, not a built-in feature):

| Skill | Contract | Validator checks |
|---|---|---|
| `architecture-review` | ADR with the H2 sections of `docs/adr/0000-template.md`, plus Requirement, Current architecture (evidence), Risks | section order, `Status: proposed`, 2+ options, `AR-NNN` risks, `test_` names in Verification, every `path:line` resolves (`--repo`, `--bench`) |
| `code-review` | Summary, Findings, Details, Categories checked, Verdict | columns, severity and category enums, sort order, locations inside the (patched) file, quoted evidence, cited rule, verdict consistent with severities, no advice to switch to `frappe.get_all` |
| `test-strategy` | Scope with evidence, findings, cases, coverage over 8 categories | `TestClass#test_method` names, tool names, `existing` tests exist in the app and `new` ones do not, every category covered or `N/A: reason`, a `run-tests` exit criterion |

The validators are zero-dependency Node 22 scripts with `node:test` suites (10, 9 and 10 tests). Each also grades a **golden case** from `skills/<skill>/tests/cases.json`: required findings by category, minimum severity, location and evidence substrings; forbidden findings; expected verdict or required citations.

The asset side lives in `skills/<name>/` (course convention): `README.md` (owner, consumers, invocation, whether it writes files, how to test), `CHANGELOG.md` at 1.0.0 (output-format change = major), and golden cases with `facts` marked `read:` or `run:`. Release rules that follow:

1. A new checklist item needs a golden case that triggers it.
2. A false-positive control (`cr-06-clean-test-only-change`) matters as much as the bug cases.
3. Line numbers are tied to the current app and Frappe 15.121.2; `--repo` and `--bench` turn drift into a failing check.
4. Live golden runs need a model (`claude -p "/code-review" --output-format json`); validators, patches and the example tests run in CI without one.

Module 09-agent-evaluation runs these cases for the agents; module 10-governance packages the skills."""},
]

diagrams = [
 {"title": "architecture-review: from requirement to a gated ADR",
  "mermaid": "flowchart TD\n  R[\"Requirement ($ARGUMENTS or handoff path)\"] --> A[\"1. Requirement analysis<br/>sites, PHI, external systems, acceptance criteria\"]\n  A --> I[\"2. Inspect architecture<br/>overview.md, docs/adr, standards\"]\n  I --> C[\"Trace code path<br/>api/fhir.py, mappers, controller, DocType JSON, hooks.py, tests\"]\n  C --> FS[\"Check Frappe behaviour<br/>apps/frappe source or FRAPPE_FACTS\"]\n  FS --> O[\"3. Options on the Frappe axes<br/>core / country app / integration app / extension point<br/>controller or doc_events, sync or enqueue\"]\n  O --> K[\"4. Risks as findings (AR-NNN)\"]\n  K --> D[\"5. ADR from ADR_TEMPLATE.md<br/>Status: proposed\"]\n  D --> V[\"validate-adr.mjs --repo . --bench BENCH --status proposed\"]\n  V -->|\"fails\"| O\n  V -->|\"passes\"| G{\"Human gate: PR review\"}\n  G -->|\"approve\"| ACC[\"Tech lead sets Status: accepted\"]\n  G -->|\"changes requested\"| O"},
 {"title": "What happens when you type /code-review inside AI-SDLC-frappe",
  "mermaid": "sequenceDiagram\n  participant U as \"Engineer\"\n  participant CC as \"Claude Code\"\n  participant G as \"git (shell)\"\n  participant M as \"Model\"\n  participant V as \"validate-findings.mjs (CI)\"\n  U->>CC: \"/code-review\"\n  CC->>CC: \"project skill replaces bundled /code-review\"\n  CC->>G: \"!git diff --stat, git status --short, git diff HEAD -- sample-app\"\n  Note over CC,G: \"permission check: allowed-tools Bash(git diff *)\"\n  G-->>CC: \"diff text replaces the placeholders\"\n  CC->>M: \"SKILL.md body with the diff\"\n  M->>M: \"sort files: Python, DocType JSON, patches.txt, hooks.py, fixtures, tests\"\n  M->>M: \"Read standards, full files, callers, tests\"\n  M-->>U: \"Findings table, categories checked, verdict\"\n  U->>V: \"saved report\"\n  V-->>U: \"OK or FAIL per rule\""},
]

tables = [
 {"title": "The three skills side by side",
  "columns": ["", "architecture-review", "code-review", "test-strategy"],
  "rows": [
   ["Trigger", "DocType schema, `hooks.py`, permissions, whitelisted-method contract, background jobs, more than one app or country", "Any diff under `sample-app/` before a PR", "Before implementing, or after an ADR"],
   ["Input", "`$ARGUMENTS` requirement or handoff path", "Injected `git diff HEAD -- sample-app`; optional base ref in `$ARGUMENTS`", "`$ARGUMENTS` method, DocType or ADR; injected `git diff --stat` if empty"],
   ["Reads first", "`overview.md`, `docs/adr/*`, `frappe-coding-standards.md`, `.claude/rules/doctype-json.md`, Frappe source", "`review-standards.md`, `frappe-coding-standards.md`, `testing-standards.md`, PHI policy", "`testing-standards.md`, `api-standards.md`, glossary rules, `KNOWN_DEFECTS.md`"],
   ["Output", "ADR (`docs/adr/NNNN-*.md`, status proposed)", "Findings `CR-NNN` + verdict", "Test plan: 8 categories, `TS-NNN` findings, `TC-NN` cases"],
   ["Writes files", "The ADR only (normal permission prompt)", "Never (`disallowed-tools: Edit Write NotebookEdit`)", "Never (the tester agent writes tests)"],
   ["Validator", "`scripts/validate-adr.mjs` (`--repo`, `--bench`)", "`scripts/validate-findings.mjs`", "`scripts/validate-test-plan.mjs`"],
   ["Preloaded by", "`architect`", "`reviewer`", "`tester` (with `run-tests`)"],
   ["Human gate", "PR review sets `accepted`", "`BLOCK` on critical/high per review-standards", "Tech lead approves the `new-failing` tickets"],
  ]},
 {"title": "Where a change lives on a spice-style Frappe platform",
  "columns": ["Option", "Use when", "Mechanism", "Trap found in this repo"],
  "rows": [
   ["Core change in `spice_lite`", "Every country needs it", "DocType JSON + patch in `patches.txt`, controller, `api/fhir.py`", "`reqd` field without a backfill patch: 46 tests pass before migrate, 14 errors after"],
   ["Country app", "One country needs a field or rule", "Custom Field / Property Setter fixtures, `doc_events`", "`PATIENT_FIELDS` is fixed, so the API never sees the Custom Field; fixtures overwrite desk edits on migrate"],
   ["Integration app (`required_apps = [\"spice_lite\"]`)", "An external system is involved", "Own Custom Fields or DocTypes, `doc_events`, `frappe.enqueue` jobs", "Job kwargs are shown in desk (`RQ Job` `arguments`): pass document names only"],
   ["Core extension point", "Several apps plug into one core behaviour", "App-defined `hooks.py` key read with `frappe.get_hooks`", "A new key is a public contract and needs an ADR"],
   ["`frappe.enqueue`", "External or slow work", "`queue`, `timeout`, `job_id`, `deduplicate=True`, `enqueue_after_commit=True`", "A registry outage fills the `short` queue unless retries go to the scheduler"],
  ]},
]

REQ = """---
run_id: 2026-09-30-feat-national-health-id
step: 01
agent: orchestrator
status: complete
inputs: []
next: architect
---
## Summary
The Kenya Ministry of Health requires every clinic to record the national health ID (NHID) of patients who have one.

## Requirement
Store an NHID per patient in the Kenya deployment, let search_patients find a patient by it (identifier token), return it in the Patient resource next to the MRN, and verify each NHID against the national client registry. The registry is an external HTTP API with planned outages. The Uganda deployment does not use an NHID yet; another country is expected to adopt the same registry pattern next year.

## Open questions
- Is the NHID mandatory for new patients? (Walk-in patients often have none.)
- Who may see the verification status?
"""

ex_ar = {
 "id": "03-architecture-review-adr",
 "title": "Build architecture-review and draft ADR-0002 for the national health ID",
 "objective": "Create the `architecture-review` skill (procedure, Frappe decision guide, ADR template, checklist, validator) and run it on the requirement \"store, search, return and verify a national health ID in the Kenya deployment\". The skill must inspect `context/architecture/overview.md`, ADR-0001, the path from `search_patients` through `api/mappers.py` to `hooks.py`, and the Frappe source it relies on; decide core change versus country app versus integration app, controller versus `doc_events`, and synchronous versus `frappe.enqueue`; list codebase-specific risks; and write `docs/adr/0002-national-health-id-integration-app.md` with status `proposed` that passes `validate-adr.mjs --repo . --bench <bench> --status proposed`.",
 "startingFiles": [
  {"path": R + ".ai-sdlc/runs/2026-09-30-feat-national-health-id/01-requirements.md", "content": REQ}
 ],
 "requiredStructure": "AI-SDLC-frappe/\n├── .claude/skills/architecture-review/\n│   ├── SKILL.md                       # frontmatter: name, description, when_to_use, argument-hint, allowed-tools\n│   ├── frappe-options.md              # decision axes: placement, controller vs doc_events, sync vs enqueue, permissions, rollout\n│   ├── ADR_TEMPLATE.md                # H2 sections identical to docs/adr/0000-template.md\n│   ├── checklist.md\n│   ├── examples/0002-national-health-id-integration-app.md\n│   └── scripts/\n│       ├── validate-adr.mjs           # --repo for repo paths, --bench for apps/frappe/... paths\n│       └── validate-adr.test.mjs\n├── docs/adr/0002-national-health-id-integration-app.md   # written by the skill during the exercise\n└── skills/architecture-review/{README.md,CHANGELOG.md,tests/cases.json}",
 "implementation": [
  {"path": f"{AR}/SKILL.md", "language": "markdown", "tag": "verified-format"},
  {"path": f"{AR}/frappe-options.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/ADR_TEMPLATE.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/checklist.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/examples/0002-national-health-id-integration-app.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/scripts/validate-adr.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC-frappe\nclaude -p \"/architecture-review .ai-sdlc/runs/2026-09-30-feat-national-health-id/01-requirements.md\" \\\n  --permission-mode acceptEdits --output-format json | jq -r '.result'\nnode .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0002-national-health-id-integration-app.md \\\n  --repo . --bench /home/user/frappe-bench --status proposed \\\n  --case skills/architecture-review/tests/cases.json#ar-01-national-health-id",
 "expectedOutput": """ADR: docs/adr/0002-national-health-id-integration-app.md
- Decision: integration app spice_nhid (required_apps = ["spice_lite"]) ships Custom Fields national_health_id (unique, search_index, not reqd) and nhid_status as fixtures, registers doc_events on SL Patient, and verifies through frappe.enqueue(queue="short", timeout=60, job_id=f"nhid-verify-{doc.name}", deduplicate=True, enqueue_after_commit=True, patient=doc.name). spice_lite gains an app-defined hooks.py key spice_lite_identifier_systems and system-aware token parsing.
- Top risks: AR-001 mappers.py:113 parse_token drops the system, so urn:spice:nhid|12345678 is searched as an MRN today; AR-002 rq_job.py:170 shows job kwargs in desk, so the job gets the document name only.
- Follow-ups: SL-140 core extension point, SL-141 spice_nhid app, SL-142 registry key per site, SL-143 queue dashboard, SL-144 docs and PHI table.
Validate: node .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0002-national-health-id-integration-app.md --repo . --bench /home/user/frappe-bench --status proposed

Excerpt of the ADR:
| The API reads a fixed field list, so a Custom Field is invisible | `sample-app/spice_lite/spice_lite/api/fhir.py:33` `PATIENT_FIELDS = ["name", "mrn", "first_name", "last_name", "gender", "birth_date", "active", "country"]` |
| The identifier token's system is thrown away | `sample-app/spice_lite/spice_lite/api/mappers.py:113` `return str(value).split("\\|")[-1].strip() or None`; run: `parse_token('urn:spice:ke:nhid\\|12345678')` returns `'12345678'` |

| Option | Pros | Cons | Risk |
|---|---|---|---|
| A. Core field `national_health_id` in the `SL Patient` JSON, registry call in `SLPatient.validate` | Smallest change | Every country gets a Kenya field (standard 12); each save holds a gunicorn worker for the registry round trip | A registry outage stops patient registration in Kenya |
| C. Integration app `spice_nhid` ... (chosen) | Reusable by any country site; registration never waits for the registry | A new `hooks.py` key becomes a contract | Job arguments or logs leak the NHID; fixtures overwrite desk edits |

$ node .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0002-national-health-id-integration-app.md --repo . --bench /home/user/frappe-bench --status proposed --case skills/architecture-review/tests/cases.json#ar-01-national-health-id
OK  ADR-0002 status=proposed options=4 risks=7 citations=26 case=ar-01-national-health-id""",
 "testCases": [
  {"name": "Validator unit tests pass", "input": "cd AI-SDLC-frappe && node --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs", "expected": "# pass 10\n# fail 0"},
  {"name": "Reference ADR is valid and every repo and Frappe citation resolves", "input": "node .claude/skills/architecture-review/scripts/validate-adr.mjs .claude/skills/architecture-review/examples/0002-national-health-id-integration-app.md --repo . --bench /home/user/frappe-bench --status proposed", "expected": "OK  ADR-0002 status=proposed options=4 risks=7 citations=26"},
  {"name": "Human-written ADR-0001 still conforms to the template", "input": "node .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0001-fhir-lite-over-whitelisted-methods.md --repo . --template-only", "expected": "OK  ADR-0001 status=accepted options=3 risks=0 citations=0"},
  {"name": "Risk AR-001 is real today", "input": "cd sample-app/spice_lite && python3 -c \"from spice_lite.api.mappers import parse_token; print(parse_token('urn:spice:nhid|12345678'))\"", "expected": "12345678 (the system is dropped, so search_patients would look this up as an MRN)"},
  {"name": "Generated ADR is never accepted by the agent", "input": "grep -c '^- Status: proposed$' docs/adr/0002-national-health-id-integration-app.md", "expected": "1"},
  {"name": "Generated ADR passes the golden case", "input": "The second command of exampleInput", "expected": "Exit code 0. If it prints `FAIL case ar-01-national-health-id: does not mention parse_token or system`, the skill skipped the mapper: check step 2.4 of SKILL.md and that the model read api/mappers.py."},
  {"name": "Unrelated requirement is not graded as a pass", "input": "node .claude/skills/architecture-review/scripts/validate-adr.mjs .claude/skills/architecture-review/examples/0002-national-health-id-integration-app.md --case skills/architecture-review/tests/cases.json#ar-05-lastn-set-based", "expected": "Exit code 1, first line `FAIL case ar-05-lastn-set-based: does not cite KNOWN_DEFECTS.md`"},
 ],
 "evaluationCriteria": [
  "Every statement about current behaviour carries a `path:line` that resolves: repository paths with `--repo`, Frappe-source paths (`apps/frappe/...`) with `--bench`.",
  "The placement axis is decided explicitly (core, country app, integration app, extension point) and each rejected placement says why it loses in this codebase.",
  "Controller versus `doc_events` and synchronous versus `frappe.enqueue` are decided, with concrete `queue`, `timeout`, `job_id` and `deduplicate` values.",
  "Risks are specific to spice_lite and Frappe v15 (token parsing, fixed `PATIENT_FIELDS`, RQ job arguments, unique blank values, fixtures overwrite, `run-tests` not migrating), not generic.",
  "Status stays `proposed`; acceptance happens only in PR review.",
  "`SKILL.md` uses only documented frontmatter keys and stays under 500 lines, with the decision guide, template and checklist as supporting files.",
 ],
 "improvements": [
  "Run the inspection phase with `context: fork` and `agent: Explore`, then write the ADR in the main session.",
  "Add golden cases for requirements that need no ADR (a bug fix inside one controller method).",
  "Teach the skill to list which sites get which app in a small table, and have module 06's automation check it against `sites/apps.txt` (not the site config).",
  "Have the orchestrator (module 08-workflow-orchestration) pass the ADR path to test-strategy automatically (golden case `ts-05-national-health-id-adr`).",
 ],
}

PATCH = f(f"{CR}/examples/front-desk-lookup.patch")
ex_cr = {
 "id": "03-code-review-diff",
 "title": "Build code-review and review a guest-accessible lookup with f-string SQL",
 "objective": "Create the project `code-review` skill that replaces the bundled `/code-review` inside `AI-SDLC-frappe/`, injects the working-tree diff with `!` commands, reviews Python, DocType JSON, `patches.txt`, `hooks.py` and fixtures together against `context/standards/*`, and emits findings in the canonical format with a verdict. Apply the provided patch (a front-desk `find_patients` method with `allow_guest=True`, an f-string passed to `frappe.db.sql`, the search term in `frappe.log_error`, raw rows returned, no tests), confirm the suite stays green, run the skill, and validate the report.",
 "startingFiles": [
  {"path": f"{CR}/examples/front-desk-lookup.patch", "content": PATCH}
 ],
 "requiredStructure": "AI-SDLC-frappe/\n├── .claude/skills/code-review/\n│   ├── SKILL.md               # allowed-tools: git diff/status/log/show; disallowed-tools: Edit Write NotebookEdit\n│   ├── review-checklist.md    # 8 categories, Frappe checks, each cites a standard rule\n│   ├── output-format.md\n│   ├── examples/\n│   │   ├── front-desk-lookup.patch\n│   │   └── expected-review-front-desk-lookup.md\n│   └── scripts/\n│       ├── validate-findings.mjs\n│       └── validate-findings.test.mjs\n└── skills/code-review/{README.md,CHANGELOG.md,tests/cases.json,tests/patches/*.patch}",
 "implementation": [
  {"path": f"{CR}/SKILL.md", "language": "markdown", "tag": "verified-format"},
  {"path": f"{CR}/review-checklist.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{CR}/output-format.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{CR}/examples/expected-review-front-desk-lookup.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{CR}/scripts/validate-findings.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC-frappe\nP=.claude/skills/code-review/examples/front-desk-lookup.patch\ngit apply --directory=\"$(git rev-parse --show-prefix)\" \"$P\"\n# CI view (from the bench directory, as the bench user): bench --site test.localhost run-tests --app spice_lite\nclaude -p \"/code-review\" --output-format json | jq -r '.result' > /tmp/review.md\nnode .claude/skills/code-review/scripts/validate-findings.mjs /tmp/review.md --repo . \\\n  --case skills/code-review/tests/cases.json#cr-01-front-desk-lookup\ngit apply -R --directory=\"$(git rev-parse --show-prefix)\" \"$P\"   # undo",
 "expectedOutput": """$ bench --site test.localhost run-tests --app spice_lite     # with the patch applied
Ran 46 tests in 3.151s

OK

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-001 | critical | security | `sample-app/spice_lite/spice_lite/api/fhir.py:193-196` | `rows = frappe.db.sql(` ... `where last_name like '%{name}%'` (f-string); probe as Guest with `name="zz%' or last_name is not null or '%'='"` returned `3 of 3` patients | Use `frappe.get_list(... filters=[["last_name", "like", f"{family}%"]] ...)` or `%(name)s` values (`frappe-coding-standards.md#4`, threat-model.md "SQL injection" row). |
| CR-002 | critical | security | `sample-app/spice_lite/spice_lite/api/fhir.py:190` | `@frappe.whitelist(allow_guest=True)`; probe: `fhir.find_patients in frappe.guest_methods` is `True` | `@frappe.whitelist(methods=["GET"])` (`frappe-coding-standards.md#3`). |
| CR-003 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:193` | `rows = frappe.db.sql(` with no `frappe.has_permission("SL Patient", "read")` before it | Check `frappe.has_permission` and read through `frappe.get_list` (`frappe-coding-standards.md#2`). |
| CR-004 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:201` | `frappe.log_error(title="find_patients: no match", message=f"No patient matched '{name}'")`; probe: one Error Log row per unmatched lookup, containing the search term | Remove; audit with `log_access(...)` names only (`frappe-coding-standards.md#10`). |
| CR-005 | high | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:196` | probe with `name="O'Brien"`: `psycopg2.errors.SyntaxError syntax error at or near "Brien"` | Fixed by CR-001 (`frappe-coding-standards.md#4`). |
| CR-006 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:196` | `like '%{name}%'`; probe as Guest with `name="%"` returned `3 of 3` patients | Reject `%`, `_`, `\\` like `search_patients` (glossary business rule 6). |
| CR-007 | high | design | `sample-app/spice_lite/spice_lite/api/fhir.py:202` | `return rows` where `rows` has keys `['birth_date', 'first_name', 'last_name', 'mrn', 'name']` | Return `bundle([patient_to_fhir(r) for r in rows])` (`api-standards.md` "Success returns"). |
| CR-008 | high | testing | `sample-app/spice_lite/spice_lite/api/fhir.py:190` | `test_whitelisted_methods_are_not_guest_accessible` checks four named functions only (`tests/test_fhir_api.py:106`) | FrappeTestCase tests for match, apostrophe, `%`, 403, guest (`testing-standards.md`). |
...
## Categories checked
- correctness: CR-005
- readability: no findings
- security: CR-001, CR-002, CR-003, CR-004, CR-006

## Verdict
BLOCK

$ node .claude/skills/code-review/scripts/validate-findings.mjs /tmp/review.md --repo . --case skills/code-review/tests/cases.json#cr-01-front-desk-lookup
OK  11 findings {"critical":2,"high":6,"medium":2,"low":1,"info":0} verdict=BLOCK case=cr-01-front-desk-lookup""",
 "testCases": [
  {"name": "Patch applies to the unmodified app", "input": "cd AI-SDLC-frappe && git apply --check -v --directory=\"$(git rev-parse --show-prefix)\" .claude/skills/code-review/examples/front-desk-lookup.patch", "expected": "Checking patch AI-SDLC-frappe/sample-app/spice_lite/spice_lite/api/fhir.py...\nexit code 0"},
  {"name": "CI does not catch the bug", "input": "With the patch applied, from the bench directory: bench --site test.localhost run-tests --app spice_lite", "expected": "Ran 46 tests ... OK. The review, not the build, blocks this change."},
  {"name": "Validator unit tests pass", "input": "node --test .claude/skills/code-review/scripts/validate-findings.test.mjs", "expected": "# pass 9\n# fail 0"},
  {"name": "Reference review passes its golden case", "input": "node .claude/skills/code-review/scripts/validate-findings.mjs .claude/skills/code-review/examples/expected-review-front-desk-lookup.md --case skills/code-review/tests/cases.json#cr-01-front-desk-lookup", "expected": "OK  11 findings {\"critical\":2,\"high\":6,\"medium\":2,\"low\":1,\"info\":0} verdict=BLOCK case=cr-01-front-desk-lookup"},
  {"name": "The project skill answers /code-review", "input": "claude -p \"/code-review\" --output-format json | jq -r '.result' | grep -c '^| CR-'", "expected": "A number >= 1, with headings `## Findings` and `## Verdict`; the bundled review would produce no `CR-` ids."},
  {"name": "Reviewer cannot edit while reviewing", "input": "grep '^disallowed-tools:' .claude/skills/code-review/SKILL.md", "expected": "disallowed-tools: Edit Write NotebookEdit"},
  {"name": "Wrong advice is rejected", "input": "A report whose recommendation says `Use frappe.get_all to avoid the permission overhead`, validated with validate-findings.mjs", "expected": "`FAIL row 1 (CR-001): recommendation suggests frappe.get_all, which ignores permissions; use frappe.get_list` and exit code 1."},
  {"name": "False-positive control", "input": "Apply skills/code-review/tests/patches/test-only-plain-mrn-search.patch, run /code-review, validate with `--case skills/code-review/tests/cases.json#cr-06-clean-test-only-change`", "expected": "Verdict APPROVE, no finding above low, exit code 0 (the suite reports Ran 47 tests, OK)."},
 ],
 "evaluationCriteria": [
  "Finds the f-string SQL and `allow_guest=True` as two separate critical security findings, each citing its rule (`frappe-coding-standards.md#4`, `#3`).",
  "Flags the permission bypass of `frappe.db.sql`, the PHI in `frappe.log_error`, the D-5 wildcard regression and the raw-row return as separate root causes.",
  "Evidence is verbatim from the diff or quoted probe output; locations use post-patch line numbers that exist in the patched file (`--repo` passes).",
  "Every one of the eight categories is listed as ids or `no findings`.",
  "Does not report `TEACHING-DEFECT(perf-n+1)` in `lastn`, which the diff does not touch.",
  "Verdict follows review-standards.md (any critical or high means BLOCK) and is not described as a merge approval.",
 ],
 "improvements": [
  "Add `context: fork` with a custom `agent: reviewer` so a long diff does not fill the main session's context.",
  "Post findings as inline PR comments through the GitHub MCP server (module 06-mcp-and-tooling-architecture).",
  "Extend `test_whitelisted_methods_are_not_guest_accessible` (through the bug-fix workflow) to iterate over every function in `spice_lite.api.fhir`, so a new guest method fails CI.",
  "Add golden cases for a fixture that overwrites desk edits and for `frappe.enqueue` without `queue`/`timeout`.",
 ],
}

ex_ts = {
 "id": "03-test-strategy-lastn",
 "title": "Build test-strategy and plan the tests for spice_lite.api.fhir.lastn",
 "objective": "Create the `test-strategy` skill (procedure, test-plan template, tooling map, validator) and use it to plan tests for `lastn` across all eight categories, mapped to stdlib `unittest`, `FrappeTestCase`, `tests/utils.py::call`, `frappe.set_user`, User Permissions, a query counter and `bench run-tests` flags. Implement the plan's new cases, prove on the bench that the `new` ones pass and the `new-failing` ones fail for the documented reasons, and remove the test files from the app afterwards.",
 "startingFiles": [],
 "requiredStructure": "AI-SDLC-frappe/\n├── .claude/skills/test-strategy/\n│   ├── SKILL.md\n│   ├── TEST_PLAN_TEMPLATE.md\n│   ├── tooling-map.md\n│   ├── examples/\n│   │   ├── lastn-test-plan.md\n│   │   ├── test_lastn_plan.py            # FrappeTestCase: api, negative, edge, performance, security, regression\n│   │   └── test_lastn_mappers_unit.py    # stdlib unittest, no site\n│   └── scripts/\n│       ├── validate-test-plan.mjs\n│       └── validate-test-plan.test.mjs\n└── skills/test-strategy/{README.md,CHANGELOG.md,tests/cases.json}",
 "implementation": [
  {"path": f"{TS}/SKILL.md", "language": "markdown", "tag": "verified-format"},
  {"path": f"{TS}/TEST_PLAN_TEMPLATE.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{TS}/tooling-map.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{TS}/examples/lastn-test-plan.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{TS}/examples/test_lastn_plan.py", "language": "python", "tag": "illustrative"},
  {"path": f"{TS}/examples/test_lastn_mappers_unit.py", "language": "python", "tag": "illustrative"},
  {"path": f"{TS}/scripts/validate-test-plan.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC-frappe\nclaude -p \"/test-strategy spice_lite.api.fhir.lastn\" --permission-mode plan --output-format json | jq -r '.result' > /tmp/lastn-plan.md\nnode .claude/skills/test-strategy/scripts/validate-test-plan.mjs /tmp/lastn-plan.md --repo . --bench /home/user/frappe-bench \\\n  --case skills/test-strategy/tests/cases.json#ts-01-lastn",
 "expectedOutput": """## Risks and defects found while planning
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TS-001 | high | performance | `sample-app/spice_lite/spice_lite/api/fhir.py:155` | Measured with a query counter on Postgres: 1 subject `2` queries, 5 subjects `10`, 20 subjects `40` | Pre-existing `TEACHING-DEFECT(perf-n+1)`; detect with TC-16 (SL-130). |
| TS-002 | medium | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:175-176` | `code="http://loinc.org\\|8480-6"` returns `total` 0 | Parse the token like `search_patients`; SL-131, TC-13. |
| TS-003 | medium | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:174` | an `amended` Observation without `effective_datetime` loses to the final it replaces | Require `effective_datetime` for final and amended; SL-132, TC-14. |
| TS-004 | medium | correctness | `sample-app/spice_lite/spice_lite/api/fhir.py:183-184` | a newer `preliminary` Observation with no value is returned as `0.0` (D-1) | Filter `status in ("final", "amended")`; SL-133, TC-15. |
| TS-005 | medium | testing | `sample-app/spice_lite/spice_lite/tests/test_fhir_api.py:171-179` | `TypeError: sequence item 0: expected str instance, LazyDecode found` from `assertQueryCount` on Postgres | Use a query counter; pinned by TC-24. |

## Test cases (excerpt)
| id | category | tool | test | scenario | expected | status |
|---|---|---|---|---|---|---|
| TC-11 | negative | FrappeTestCase + call() | `TestLastnPlan#test_lastn_with_101_subjects_is_400_too_costly` | 101 ids, then 100 ids | 400 `too-costly`, then 200 | new |
| TC-16 | performance | query counter | `TestLastnPlan#test_lastn_query_count_is_constant_for_20_subjects` | 20 subjects, caches warmed | `<= 10` queries | new-failing |
| TC-21 | security | frappe.set_user | `TestLastnPlan#test_lastn_skips_patients_outside_the_users_user_permissions` | Clinician with a User Permission for one of two patients | Only that patient's entry | new |
| TC-23 | regression | FrappeTestCase + call() | `TestFhirApi#test_lastn_returns_latest_per_patient` | Guard named in KNOWN_DEFECTS T-1 | Keeps passing | existing |

$ node .claude/skills/test-strategy/scripts/validate-test-plan.mjs /tmp/lastn-plan.md --repo . --bench /home/user/frappe-bench --case skills/test-strategy/tests/cases.json#ts-01-lastn
OK  24 cases {"unit":4,"integration":2,"api":2,"negative":3,"edge":4,"performance":2,"security":5,"regression":2} {"existing":8,"new":12,"new-failing":4} findings=7 case=ts-01-lastn

$ bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_plan      # example copied into the app
Ran 14 tests in 3.510s
OK (skipped=4)

$ (same module with the four @unittest.skip lines removed)
AssertionError: Lists differ: [] != ['SLO-00002']
AssertionError: 0.0 == 0.0
AssertionError: 'SLO-00009' != 'SLO-00010'
AssertionError: 40 not less than or equal to 10
FAILED (failures=4)""",
 "testCases": [
  {"name": "Validator unit tests pass", "input": "cd AI-SDLC-frappe && node --test .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs", "expected": "# pass 10\n# fail 0"},
  {"name": "Reference plan is valid against the real app tests", "input": "node .claude/skills/test-strategy/scripts/validate-test-plan.mjs .claude/skills/test-strategy/examples/lastn-test-plan.md --repo . --bench /home/user/frappe-bench", "expected": "OK  24 cases {\"unit\":4,\"integration\":2,\"api\":2,\"negative\":3,\"edge\":4,\"performance\":2,\"security\":5,\"regression\":2} {\"existing\":8,\"new\":12,\"new-failing\":4} findings=7"},
  {"name": "Plan does not invent existing tests", "input": "A generated plan validated with --repo .", "expected": "No `FAIL test case TC-..: marked existing but ... is not in sample-app/spice_lite/spice_lite` lines. Real lastn tests: `TestFhirApi#test_lastn_returns_latest_per_patient`, `#test_lastn_requires_subjects`, `#test_lastn_query_count_grows_with_subjects`."},
  {"name": "Example integration tests pass on Postgres and MariaDB", "input": "cp .claude/skills/test-strategy/examples/test_lastn_plan.py sample-app/spice_lite/spice_lite/tests/ && (from the bench) bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_plan; bench --site mariadb.localhost run-tests --module spice_lite.tests.test_lastn_plan; then rm the copy", "expected": "Both: Ran 14 tests, OK (skipped=4)."},
  {"name": "Skipped tests really detect the defects", "input": "Same module after sed '/@unittest.skip(/d'", "expected": "FAILED (failures=4): `[] != ['SLO-...']` (SL-131), `'SLO-...' != 'SLO-...'` (SL-132), `0.0 == 0.0` (SL-133), `40 not less than or equal to 10` (SL-130)."},
  {"name": "Unit example runs without a site", "input": "cp .claude/skills/test-strategy/examples/test_lastn_mappers_unit.py sample-app/spice_lite/spice_lite/tests/unit/ && cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .; then rm the copy", "expected": "Ran 11 tests ... OK"},
  {"name": "assertQueryCount is broken on Postgres", "input": "Run TestLastnPlan#test_framework_defect_assert_query_count_breaks_on_postgres on test.localhost and mariadb.localhost", "expected": "Passes on both: TypeError is raised only when frappe.db.db_type == \"postgres\"."},
  {"name": "Sample app is left unchanged", "input": "git status --short sample-app", "expected": "No output after the copies are removed."},
 ],
 "evaluationCriteria": [
  "Covers all eight categories, each with a concrete `TestClass#test_method` and a tool that exists in a Frappe v15 bench.",
  "Uses the real harness: `tests/utils.py` helpers, the two test users, per-class rollback, explicit cleanup of redis-cached User Permissions.",
  "Finds the token, undated-amendment and zero-value behaviour, not only the planted N+1, and does not re-report the duplicate-subject behaviour that `parse_subjects` already handles.",
  "Marks existing tests as `existing` and does not re-plan them.",
  "Performance is a query count, measured with a counter because `assertQueryCount` fails on Postgres, not a wall-clock timing.",
  "`new-failing` cases name the finding and ticket and ship with `@unittest.skip(\"SL-13x: ...\")`.",
 ],
 "improvements": [
  "Let the tester agent run the plan's cases through the run-tests skill (module 02) and attach the parsed summary to the handoff.",
  "Add a `bench --site mariadb.localhost` column to the plan for cases whose behaviour differs between databases (NULL ordering, D-2).",
  "Generate the plan for ADR-0002 (golden case `ts-05-national-health-id-adr`) and feed its test names into the ADR's Verification section.",
 ],
}

ex_assets = {
 "id": "03-skill-assets-golden-cases",
 "title": "Ship the three skills as versioned assets with golden cases",
 "objective": "Give each skill an asset folder under `AI-SDLC-frappe/skills/<name>/` with owner, version, changelog and at least six golden cases built from the real spice_lite code and from behaviour measured on the bench; make the deterministic parts (validators, patches) pass without a model; and prove that a golden case catches a skill regression that the verdict alone would miss.",
 "startingFiles": [],
 "requiredStructure": "AI-SDLC-frappe/skills/\n├── architecture-review/\n│   ├── README.md\n│   ├── CHANGELOG.md          # 1.0.0\n│   └── tests/cases.json      # 7 requirements\n├── code-review/\n│   ├── README.md\n│   ├── CHANGELOG.md          # 1.0.0\n│   └── tests/\n│       ├── cases.json        # 6 cases, testsAfterPatch + probe measured on the bench\n│       └── patches/          # 5 patches (+ the example patch in .claude/skills/code-review/examples/)\n└── test-strategy/\n    ├── README.md\n    ├── CHANGELOG.md          # 1.0.0\n    └── tests/cases.json      # 6 cases",
 "implementation": [
  {"path": R + "skills/code-review/README.md", "language": "markdown", "tag": "illustrative"},
  {"path": R + "skills/code-review/CHANGELOG.md", "language": "markdown", "tag": "illustrative"},
  {"path": R + "skills/code-review/tests/cases.json", "language": "json", "tag": "illustrative"},
  {"path": R + "skills/code-review/tests/patches/observations-get-all-no-permission.patch", "language": "diff", "tag": "illustrative"},
  {"path": R + "skills/code-review/tests/patches/patient-national-id-no-patch.patch", "language": "diff", "tag": "illustrative"},
  {"path": R + "skills/code-review/tests/patches/create-observation-error-log-values.patch", "language": "diff", "tag": "illustrative"},
  {"path": R + "skills/code-review/tests/patches/audit-logger-with-more-info.patch", "language": "diff", "tag": "illustrative"},
  {"path": R + "skills/code-review/tests/patches/test-only-plain-mrn-search.patch", "language": "diff", "tag": "illustrative"},
  {"path": R + "skills/architecture-review/README.md", "language": "markdown", "tag": "illustrative"},
  {"path": R + "skills/architecture-review/CHANGELOG.md", "language": "markdown", "tag": "illustrative"},
  {"path": R + "skills/architecture-review/tests/cases.json", "language": "json", "tag": "illustrative"},
  {"path": R + "skills/test-strategy/README.md", "language": "markdown", "tag": "illustrative"},
  {"path": R + "skills/test-strategy/CHANGELOG.md", "language": "markdown", "tag": "illustrative"},
  {"path": R + "skills/test-strategy/tests/cases.json", "language": "json", "tag": "illustrative"},
  {"path": f"{CR}/scripts/validate-findings.test.mjs", "language": "javascript", "tag": "illustrative"},
  {"path": f"{AR}/scripts/validate-adr.test.mjs", "language": "javascript", "tag": "illustrative"},
  {"path": f"{TS}/scripts/validate-test-plan.test.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC-frappe\n# 1. Deterministic checks (no model): validator suites\nnode --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs .claude/skills/code-review/scripts/validate-findings.test.mjs .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs\n# 2. Every golden patch still applies to the current app\nfor p in .claude/skills/code-review/examples/*.patch skills/code-review/tests/patches/*.patch; do git apply --check --directory=\"$(git rev-parse --show-prefix)\" \"$p\" && echo \"applies $p\"; done\n# 3. Simulate a skill regression: the reviewer downgrades the allow_guest finding; the verdict stays BLOCK\nsed 's/^| CR-002 | critical | security |/| CR-002 | low | security |/' .claude/skills/code-review/examples/expected-review-front-desk-lookup.md > /tmp/regressed.md\nnode .claude/skills/code-review/scripts/validate-findings.mjs /tmp/regressed.md --case skills/code-review/tests/cases.json#cr-01-front-desk-lookup",
 "expectedOutput": """# tests 29
# suites 0
# pass 29
# fail 0

applies .claude/skills/code-review/examples/front-desk-lookup.patch
applies skills/code-review/tests/patches/audit-logger-with-more-info.patch
applies skills/code-review/tests/patches/create-observation-error-log-values.patch
applies skills/code-review/tests/patches/observations-get-all-no-permission.patch
applies skills/code-review/tests/patches/patient-national-id-no-patch.patch
applies skills/code-review/tests/patches/test-only-plain-mrn-search.patch

FAIL row 3 (CR-003): findings must be sorted by severity (critical first)
FAIL case cr-01-front-desk-lookup: no finding matches {"category":"security","minSeverity":"critical","location":"api/fhir.py:190","evidenceIncludes":"allow_guest"}
INVALID  11 findings {"critical":1,"high":6,"medium":2,"low":2,"info":0} verdict=BLOCK case=cr-01-front-desk-lookup""",
 "testCases": [
  {"name": "At least six golden cases per skill", "input": "for s in architecture-review code-review test-strategy; do node -e \"console.log(process.argv[1], JSON.parse(require('fs').readFileSync('skills/'+process.argv[1]+'/tests/cases.json','utf8')).cases.length)\" $s; done", "expected": "architecture-review 7\ncode-review 6\ntest-strategy 6"},
  {"name": "Every case has input and expected", "input": "node -e \"for (const s of ['architecture-review','code-review','test-strategy']) for (const c of JSON.parse(require('fs').readFileSync('skills/'+s+'/tests/cases.json','utf8')).cases) if (!c.input || !c.expected) console.log('bad', s, c.id)\"", "expected": "No output."},
  {"name": "Patch outcomes are recorded from real runs", "input": "Under the bench lock, from AI-SDLC-frappe/: git apply --directory=$(git rev-parse --show-prefix) skills/code-review/tests/patches/observations-get-all-no-permission.patch, run `bench --site test.localhost run-tests --app spice_lite`, then revert", "expected": "Ran 46 tests, OK, matching `testsAfterPatch` of cr-02; the recorded probe says a user without roles got 200 with values from the new method."},
  {"name": "Schema patch outcome depends on migrate", "input": "Read testsAfterPatch of cr-03 in skills/code-review/tests/cases.json", "expected": "Green on the unmigrated test site (46, OK); after `bench migrate` on a scratch site: Ran 27 tests, FAILED (errors=14), all MandatoryError on national_id."},
  {"name": "Versions agree", "input": "grep -h '^## 1.0.0' skills/{architecture-review,code-review,test-strategy}/CHANGELOG.md | wc -l; grep -h '\"skillVersion\"' skills/{architecture-review,code-review,test-strategy}/tests/cases.json | sort -u", "expected": "3\n  \"skillVersion\": \"1.0.0\","},
  {"name": "Regression is caught although the verdict is unchanged", "input": "Step 3 of exampleInput", "expected": "Exit code 1 with `FAIL case cr-01-front-desk-lookup: no finding matches {...\"allow_guest\"}` while the report still says verdict=BLOCK."},
 ],
 "evaluationCriteria": [
  "Each README names owner, consumers (which agent preloads the skill), invocation, whether it writes files, and how to test.",
  "Golden cases cite real files and line-level facts, marked `read:` or `run:`; `run:` facts were measured on the bench (Postgres, and MariaDB where it differs).",
  "Every patch applies with `git apply --check --directory=$(git rev-parse --show-prefix)`, and `testsAfterPatch` records the real suite result, including the migrate caveat for DocType changes.",
  "At least one false-positive control case exists (a clean change that must be approved).",
  "Validators and their tests run with Node 22 and no dependencies, so CI can run them without a model or API key.",
  "CHANGELOG uses semantic versioning with the output-format change rule stated.",
 ],
 "improvements": [
  "Add a CI job that runs the three validator suites and `git apply --check --directory=...` for every golden patch on each pull request that touches `sample-app/` or `.claude/skills/`.",
  "Automate the apply, run-tests, revert loop as a script that takes the bench lock, so `testsAfterPatch` can be re-measured after every app change.",
  "Wire the live golden runs into the eval harness of module 09-agent-evaluation and track pass rate per skill version.",
 ],
}

for x in (ex_ar, ex_cr, ex_ts, ex_assets):
    for i in x["implementation"]:
        i["content"] = f(i["path"])
        i_sorted = {"path": i["path"], "language": i["language"], "content": i["content"], "tag": i["tag"]}
        i.clear(); i.update(i_sorted)

mod = {
 "id": "03-skills-architecture-code-test",
 "level": 3,
 "title": "Production skills on Frappe: architecture review, code review, test strategy",
 "summary": "Build three production-grade skills that the architect, reviewer and tester agents preload: architecture-review (requirement to ADR, deciding core DocType change versus country app versus integration app, controller versus doc_events, synchronous versus frappe.enqueue), code-review (a Frappe diff against the house standards in the canonical findings format, replacing the bundled /code-review in this project), and test-strategy (an eight-category plan mapped to FrappeTestCase, unittest, frappe.set_user, a query counter and bench run-tests flags). Each ships with templates, a zero-dependency validator and golden cases built from behaviour measured on the real spice_lite bench.",
 "prerequisites": ["02-first-agent-skill-tools", "00-example", "A working bench with spice_lite on test.localhost (`AI-SDLC-frappe/sample-app/scripts/setup-bench.sh`)", "Node 22", "Comfort reading whitelisted methods, DocType JSON and FrappeTestCase tests"],
 "concepts": concepts,
 "diagrams": diagrams,
 "comparisonTables": tables,
 "exercises": [ex_ar, ex_cr, ex_ts, ex_assets],
 "agentContracts": [],
 "checklist": [
  "`.claude/skills/{architecture-review,code-review,test-strategy}/SKILL.md` exist and use only documented frontmatter keys (no `disable-model-invocation`, so agents can preload them).",
  "`node --test` on the three validator test files reports 29 passing tests.",
  "`validate-adr.mjs` on `examples/0002-national-health-id-integration-app.md` with `--repo . --bench <bench> --status proposed` prints `OK  ADR-0002`.",
  "The ADR decides placement (core, country app, integration app, extension point), controller versus `doc_events`, and synchronous versus `frappe.enqueue`, with concrete values.",
  "Inside `AI-SDLC-frappe/`, `/code-review` produces a findings table with `CR-` ids (the project skill replaced the bundled one).",
  "With the front-desk patch applied, `bench --site test.localhost run-tests --app spice_lite` still passes, and the review verdict is `BLOCK` with critical findings for the f-string SQL and `allow_guest=True`.",
  "The `lastn` plan covers all eight categories and validates with `--repo .`; its performance case uses a query counter, not `assertQueryCount`, on Postgres.",
  "The example tests give `Ran 14 tests`, `OK (skipped=4)` on Postgres and MariaDB, and the four skipped tests fail for the documented reasons when enabled.",
  "Each skill has `skills/<name>/README.md`, `CHANGELOG.md` at 1.0.0 and `tests/cases.json` with at least six cases.",
  "Every golden patch passes `git apply --check --directory=$(git rev-parse --show-prefix)` from `AI-SDLC-frappe/`.",
  "`git status --short sample-app` prints nothing after the exercises: patches reverted, example tests removed, no scratch site left behind.",
 ],
}
out = ROOT / "content-frappe/modules/03-skills-architecture-code-test.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
