# Generator for content/modules/03-skills-architecture-code-test.json. Run: python3 build/sources/03-skills-architecture-code-test.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

AR = "AI-SDLC/.claude/skills/architecture-review"
CR = "AI-SDLC/.claude/skills/code-review"
TS = "AI-SDLC/.claude/skills/test-strategy"

concepts = [
 {"heading": "A skill is a procedure plus the files it needs",
  "body_md": """A **skill** is a directory, not a prompt. `.claude/skills/<name>/SKILL.md` holds YAML frontmatter and a Markdown procedure; everything else in the directory is a supporting file that Claude reads or runs only when the procedure points to it. Per the skills docs (`build/CLAUDE_CODE_FACTS.md` §2):

- The **description** (plus `when_to_use`) is always in context, so Claude can decide to load the skill. Keep the pair under the 1,536-character listing limit and make it name the trigger situations.
- The **body** loads when the skill is invoked (`/code-review`, or automatically by description) and stays in context for the rest of the session.
- **Supporting files** (`review-checklist.md`, `ADR_TEMPLATE.md`, `tooling-map.md`) are read on demand. **Scripts** (`scripts/validate-findings.mjs`) are executed, not loaded, so a 200-line validator costs no context.
- Keep `SKILL.md` under 500 lines and link out.

So in practice each skill in this module has the same shape:

```text
.claude/skills/code-review/
├── SKILL.md              # when, inputs, procedure, rules (about 70 lines)
├── review-checklist.md   # checks tied to rule numbers in context/standards/
├── output-format.md      # the exact report structure
├── examples/             # a real input and the expected output
└── scripts/              # zero-dependency Node validator + node:test tests
```

The procedure says *how a senior engineer does the job in this repository*: which context files to read in which order, which classes to trace, what evidence counts. The supporting files hold the parts that change independently (a checklist grows, a template gets a new section) so a change to one does not force a rewrite of the other.

Frontmatter fields used here, all from the documented list: `name`, `description`, `when_to_use`, `argument-hint`, `allowed-tools`, `disallowed-tools`. We deliberately do **not** set `disable-model-invocation: true`: per the subagent docs, a skill with that flag cannot be preloaded into a subagent, and the architect, reviewer and tester agents (module 05-agent-roster) preload these three skills through their `skills:` field."""},
 {"heading": "Feeding the skill real input: $ARGUMENTS and !`cmd` injection",
  "body_md": """A review skill is only as good as the diff it sees. Two documented mechanisms get the input in before the model starts reasoning:

- **`$ARGUMENTS`** is replaced by everything after the command name (`/code-review main` → `main`). `$0` is the *first* argument, `$1` the second. If the body has no placeholder, Claude Code appends `ARGUMENTS: <value>` instead.
- **`` !`command` ``** at the start of a line (or after whitespace) runs *before* the content is sent to the model, and its output replaces the placeholder. The command is checked against permission rules; outside auto mode anything not allowed aborts the whole invocation, as does a non-zero exit. `allowed-tools` pre-approves it for this skill.

`code-review/SKILL.md` injects three commands:

```markdown
!`git diff --stat HEAD`
!`git status --short`
!`git diff HEAD -- sample-app`
```

All three match `Bash(git diff *)` / `Bash(git status *)` in the skill's `allowed-tools` (and `git diff` is already in `permissions.allow` in `.claude/settings.json`), so the skill loads without a prompt.

Three details that bite in practice:

1. **Untracked files are invisible to `git diff`.** A patch that adds `PatientNameSearch.java` shows only the controller change unless you run `git add -N sample-app` after `git apply`. The skill also injects `git status --short` and tells Claude to Read every `??` file.
2. **Arguments are untrusted input.** The skill validates the base ref against `^[A-Za-z0-9._/~^-]+$` before building `git diff <base>...HEAD`. Anything else is rejected, never passed to the shell.
3. **`allowed-tools` does not restrict tools; it pre-approves them.** To stop the reviewer editing files while the skill is active, `code-review` sets `disallowed-tools: Edit Write NotebookEdit`, which removes those tools until the next user message.

So in practice: inject what the model must not guess (the diff, the date, the git status), validate what the user types, and use `disallowed-tools` for any hard limit."""},
 {"heading": "Replacing the bundled /code-review inside this project",
  "body_md": """Claude Code ships bundled skills, including `/code-review`. The skills docs state (verified, see the addendum in `build/CLAUDE_CODE_FACTS.md`): *a project skill with the same name replaces the bundled command, but not its aliases*. The bundled alias `/review` never runs your skill.

Consequences for `AI-SDLC/`:

- Inside the project, `/code-review` runs `.claude/skills/code-review/SKILL.md`: standards from `context/standards/`, findings in the canonical `id | severity | category | location | evidence | recommendation` format, and a `BLOCK` / `NEEDS-DECISION` / `APPROVE` verdict derived from `context/standards/review-standards.md`.
- Outside the project (any other repository), the bundled one runs as before.
- `/review` still runs the bundled review. Teach the team to type `/code-review`, or tell them `/review` is the generic one.
- Skill precedence for the same name is enterprise > personal > project. A developer with a personal `~/.claude/skills/code-review/` gets *their* skill, not the team's, in this repository. If the reviewer agent's evals (module 09-agent-evaluation) look inconsistent between machines, check for this first.
- The `disableBundledSkills` and `skillOverrides` settings exist for org-wide control; governance of those is module 10-governance.

Why replace rather than add `/standards-review`? Because muscle memory wins. Engineers already type `/code-review`; making the project's version the one that answers means the house rules apply without anyone changing habits. The cost is that the skill must be at least as good as the bundled one on correctness bugs, which is exactly what the golden cases in `skills/code-review/tests/cases.json` measure: six patches, including an authorization regression and a false-positive control that must be approved."""},
 {"heading": "Output contracts turn a skill into something you can test",
  "body_md": """A skill whose output shape varies run to run cannot be consumed by another agent, a CI job, or an eval. Each skill here therefore has an **output contract** and a **deterministic validator** (pattern, not a built-in feature):

| Skill | Contract | Validator checks |
|---|---|---|
| `architecture-review` | ADR with the exact H2 sections of `docs/adr/0000-template.md`, plus `### Requirement`, `### Current architecture (evidence)`, `### Risks` | section order, `Status: proposed`, 2+ option rows with 4 filled cells, risk ids `AR-NNN`, every backticked `path:line` resolves (`--repo`) |
| `code-review` | Summary, Findings table, Details, Categories checked, Verdict | column names, severity and category enums, sorted by severity, `path:line` locations inside the file, quoted evidence, cited rule, verdict consistent with severities, every category listed as ids or `no findings` |
| `test-strategy` | Scope with evidence, findings, test cases, coverage matrix over 8 categories | `TestClass#method` names, tool names, `existing` tests really exist and `new` ones do not (`--repo`), every category covered or `N/A: reason` |

The validators are zero-dependency Node 22 scripts with `node:test` suites (8, 8 and 9 tests), all run in this build. Each also grades a **golden case** (`--case skills/<skill>/tests/cases.json#<id>`): required findings by category, minimum severity, location substring and evidence substring; forbidden findings; expected verdict.

What a validator cannot check is whether the evidence is *true*. Two mitigations: `--repo` rejects citations to lines that do not exist, and the golden cases were built from behaviour **measured** on a scratch copy of the app, not from reading alone. For example the `code-review` case `cr-02` records that the patched app fails `SecurityTest.clinicianCannotDelete:33 Status expected:<403> but was:<204>`.

So in practice: write the contract first, write the validator second, and only then tune the procedure until the golden cases pass."""},
 {"heading": "Grounding: every claim points at the real sample app",
  "body_md": """The failure mode of an unskilled review is plausible text: \"consider adding pagination\", \"validate inputs\". The procedures in this module force **evidence** instead: every claim about current behaviour carries a `path:line` and a verbatim quote, and anything inferred without running is labelled \"reasoned from code\".

Running the skills' reasoning against the real code turned up facts a generic review would miss:

- **CI is green on a critical bug.** The code-review exercise patch concatenates user input into JPQL. With it applied, all 25 existing tests still pass. On a scratch copy, `name=zzz%' or p.id > 0 or '1' like '1` returns every patient, and `name=O'Brien` returns HTTP 500 while `GlobalExceptionHandler` logs the JPQL, name included.
- **The obvious index fix does not port.** Hibernate generates `where upper(p1_0.family_name)=upper(?)` for `findByFamilyNameIgnoreCaseOrderByIdAsc`, so `ix_patient_family_name` cannot serve it on PostgreSQL. And H2 2.3.232 rejects `CREATE INDEX ... (lower(family_name))`, which matters because `V1__init.sql` must run on both. ADR-0002 records this as risk AR-001 and a spike ticket.
- **Two real defects in `$lastn` besides the planted one.** An Observation without `effectiveDateTime` sorts first in `DESC` order (H2 runs with `DEFAULT_NULL_ORDERING=HIGH`; PostgreSQL defaults to `NULLS FIRST` for `DESC`) and wins `$lastn`; `subjects=1,1` returns the same Observation twice. The test-strategy example ships both as `@Disabled` tests that fail with `expected:<80> but was:<99>` and `expected:<1> but was:<2>` when enabled.

`sample-app/docs/KNOWN_DEFECTS.md` says any defect other than the planted N+1 is a real bug; these two are listed there as D-02 and D-03. They are reported as findings, not fixed here, because other modules depend on the app as it is.

So in practice: a skill that demands `path:line` evidence produces findings a human can verify in a minute, and it is the evidence requirement, more than the model, that finds these bugs."""},
 {"heading": "Skills are engineering assets: owner, version, changelog, tests",
  "body_md": """A skill that the reviewer agent preloads is production code for your SDLC: when it changes, every review changes. Treat it that way. The runtime files live in `.claude/skills/<name>/`; the asset metadata lives beside them in `skills/<name>/` (course convention, not a Claude Code feature):

- `README.md`: owner, consumers (which agents preload it), invocation, whether it writes files, how to test, change policy.
- `CHANGELOG.md`: semantic versions. For these skills a change to the output structure is **major** (downstream agents and CI parse it), a new check or golden case is **minor**, wording is a **patch**.
- `tests/cases.json`: golden tasks with fixed inputs and expected findings. `code-review` has six patches in `skills/code-review/tests/patches/`, each verified to apply cleanly with `git apply --check` and each annotated with what `mvn -q -B test` does once applied.

Release discipline that follows from this:

1. A new checklist item needs a golden case that triggers it, or you cannot tell whether it works.
2. A false-positive control (case `cr-06-clean-test-only-change`) is as important as the bug cases. A reviewer that blocks everything is ignored within a week.
3. Line numbers in `facts` and in the example outputs are tied to the current sample app; the `--repo` flag makes staleness a failing check rather than a silent drift.
4. Live golden runs need a model (`claude -p "/code-review" --output-format json`). The deterministic parts (validators, example outputs, patches) run in CI without one.

Module 09-agent-evaluation builds the harness that runs these golden cases for the agents; module 10-governance packages the skills for other teams."""},
]

diagrams = [
 {"title": "architecture-review: from requirement to a gated ADR",
  "mermaid": "flowchart TD\n  R[\"Requirement ($ARGUMENTS or handoff path)\"] --> A[\"1. Requirement analysis<br/>functional, non-functional, acceptance criteria\"]\n  A --> I[\"2. Inspect architecture<br/>overview.md, docs/adr/*, standards\"]\n  I --> C[\"Trace code path<br/>controller, service, repository, migration, tests\"]\n  C --> O[\"3. Options table<br/>Option / Pros / Cons / Risk\"]\n  O --> K[\"4. Risks as findings (AR-NNN)\"]\n  K --> D[\"5. ADR from ADR_TEMPLATE.md<br/>Status: proposed\"]\n  D --> V[\"validate-adr.mjs --repo . --status proposed\"]\n  V -->|\"fails\"| O\n  V -->|\"passes\"| G{\"Human gate: PR review\"}\n  G -->|\"approve\"| ACC[\"Tech lead sets Status: accepted\"]\n  G -->|\"changes requested\"| O"},
 {"title": "What happens when you type /code-review main",
  "mermaid": "sequenceDiagram\n  participant U as \"Engineer\"\n  participant CC as \"Claude Code\"\n  participant G as \"git (shell)\"\n  participant M as \"Model\"\n  participant V as \"validate-findings.mjs (CI)\"\n  U->>CC: \"/code-review main\"\n  CC->>CC: \"project skill replaces bundled /code-review\"\n  CC->>G: \"!git diff --stat HEAD, git status --short, git diff HEAD\"\n  Note over CC,G: \"permission check: allowed-tools Bash(git diff *)\"\n  G-->>CC: \"diff text replaces the placeholders\"\n  CC->>M: \"SKILL.md body with diff, $ARGUMENTS = main\"\n  M->>G: \"git diff main...HEAD -- sample-app (after validating the ref)\"\n  M->>M: \"Read standards, full files, callers, tests\"\n  M-->>U: \"Findings table, categories checked, verdict\"\n  U->>V: \"saved report\"\n  V-->>U: \"OK or FAIL per rule\""},
]

tables = [
 {"title": "The three skills side by side",
  "columns": ["", "architecture-review", "code-review", "test-strategy"],
  "rows": [
   ["Trigger", "New endpoint contract, data model, dependency or cross-cutting change", "Any diff under `sample-app/` before a PR", "Before implementing, or after an ADR"],
   ["Input", "`$ARGUMENTS` requirement or handoff path", "Injected `git diff HEAD`; optional base ref in `$ARGUMENTS`", "`$ARGUMENTS` endpoint/ADR; injected `git diff --stat` if empty"],
   ["Reads first", "`context/architecture/overview.md`, `docs/adr/*`, api/coding standards", "`review-standards.md`, `coding-standards.md`, `testing-standards.md`", "`testing-standards.md`, `api-standards.md`, glossary business rules"],
   ["Output", "ADR (`docs/adr/NNNN-*.md`, status proposed)", "Findings `CR-NNN` + verdict", "Test plan: 8 categories, `TS-NNN` findings, `TC-NN` cases"],
   ["Writes files", "The ADR only (normal permission prompt)", "Never (`disallowed-tools: Edit Write NotebookEdit`)", "Never (tester agent writes tests)"],
   ["Validator", "`scripts/validate-adr.mjs`", "`scripts/validate-findings.mjs`", "`scripts/validate-test-plan.mjs`"],
   ["Preloaded by", "`architect`", "`reviewer`", "`tester` (with `run-tests`)"],
   ["Human gate", "PR review sets `accepted`", "`BLOCK` on critical/high per review-standards", "Tech lead approves `new-failing` tickets"],
  ]},
 {"title": "Bundled /code-review versus this project's code-review skill",
  "columns": ["Aspect", "Bundled `/code-review`", "Project `.claude/skills/code-review`"],
  "rows": [
   ["Where it applies", "Every repository", "Only inside `AI-SDLC/` (replaces the bundled one there)"],
   ["Alias `/review`", "Runs the bundled review", "Not affected; still runs the bundled review"],
   ["Standards", "General correctness and cleanup", "`context/standards/*` rule numbers, PHI policy, threat model"],
   ["Output", "Free-form findings", "Canonical table, per-category `no findings`, verdict"],
   ["Testable", "No project golden cases", "6 golden cases + validator in CI"],
   ["Overridden by", "Project skill of the same name", "A personal `~/.claude/skills/code-review` (personal > project)"],
  ]},
]

REQ = """---
run_id: 2026-09-30-feat-patient-search-paging
step: 01
agent: orchestrator
status: complete
inputs: []
next: architect
---
## Summary
Front-desk users search patients by family name. Common names return thousands of rows in one response.

## Requirement
Add pagination to Patient search: support `_count` (default 20, max 100) on `GET /fhir/Patient` and let clients fetch the next page. Existing clients that send no `_count` must keep working.

## Open questions
- Should `_count` above 100 be rejected or reduced to 100?
"""

ex_ar = {
 "id": "03-architecture-review-adr",
 "title": "Build architecture-review and draft ADR-0002 for Patient search pagination",
 "objective": "Create the `architecture-review` skill (procedure, ADR template, checklist, validator) and run it on the requirement \"add pagination (`_count`, max 100) to Patient search\". The skill must inspect `context/architecture/overview.md`, the existing ADRs and the real code path, compare at least two options, list codebase-specific risks, and write `docs/adr/0002-paginate-patient-search.md` with status `proposed` that passes `validate-adr.mjs --repo . --status proposed`.",
 "startingFiles": [
  {"path": "AI-SDLC/.ai-sdlc/runs/2026-09-30-feat-patient-search-paging/01-requirements.md", "content": REQ}
 ],
 "requiredStructure": "AI-SDLC/\n├── .claude/skills/architecture-review/\n│   ├── SKILL.md                       # frontmatter: name, description, when_to_use, argument-hint, allowed-tools\n│   ├── ADR_TEMPLATE.md                # H2 sections identical to docs/adr/0000-template.md\n│   ├── checklist.md\n│   ├── examples/0002-paginate-patient-search.md\n│   └── scripts/\n│       ├── validate-adr.mjs\n│       └── validate-adr.test.mjs\n├── docs/adr/0002-paginate-patient-search.md   # written by the skill during the exercise\n└── skills/architecture-review/{README.md,CHANGELOG.md,tests/cases.json}",
 "implementation": [
  {"path": f"{AR}/SKILL.md", "language": "markdown", "tag": "verified-format"},
  {"path": f"{AR}/ADR_TEMPLATE.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/checklist.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/examples/0002-paginate-patient-search.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{AR}/scripts/validate-adr.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC\nclaude -p \"/architecture-review .ai-sdlc/runs/2026-09-30-feat-patient-search-paging/01-requirements.md\" \\\n  --permission-mode acceptEdits --output-format json | jq -r '.result'\nnode .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0002-paginate-patient-search.md \\\n  --repo . --status proposed --case skills/architecture-review/tests/cases.json#ar-01-patient-search-pagination",
 "expectedOutput": """ADR: docs/adr/0002-paginate-patient-search.md
- Decision: page-number paging via Spring Data Pageable; _count default 20, >100 served as 100, <1 or non-numeric -> 400 invalid; Bundle gains link[self,next]; total = full match count.
- Top risks: AR-001 ix_patient_family_name cannot serve `upper(p1_0.family_name)=upper(?)`; AR-002 Bundle.java:11 sets total to resources.size().
- Follow-ups: FHIR-120 implement, FHIR-121 Observation search paging, FHIR-122 case-insensitive index spike (H2 2.3.232 rejects expression indexes).
Validate: node .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0002-paginate-patient-search.md --repo .

Excerpt of the ADR:
### Current architecture (evidence)
| Fact | Evidence |
|---|---|
| Service loads all matches by family name | `sample-app/src/main/java/org/example/fhir/service/PatientService.java:44` `result = patients.findByFamilyNameIgnoreCaseOrderByIdAsc(family.trim());` |
| `total` is the size of the list, not the match count | `sample-app/src/main/java/org/example/fhir/api/Bundle.java:11` `return new Bundle("Bundle", "searchset", resources.size(),` |

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| A. Hard cap only: `_count` limits the list, no paging | Smallest change | Clients cannot reach result 101+ | Clinicians silently miss patients beyond the cap |
| B. Page-number paging via Spring Data `Pageable` (chosen) | `Page<Patient>` gives content and total | One extra `count` query per request | `total` count on `upper(family_name)` is a full scan on PostgreSQL |

$ node .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0002-paginate-patient-search.md --repo . --status proposed --case skills/architecture-review/tests/cases.json#ar-01-patient-search-pagination
OK  ADR-0002 status=proposed options=4 risks=5 citations=17 case=ar-01-patient-search-pagination""",
 "testCases": [
  {"name": "Validator unit tests pass", "input": "cd AI-SDLC && node --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs", "expected": "# pass 8\n# fail 0"},
  {"name": "Reference ADR is valid and every citation resolves", "input": "node .claude/skills/architecture-review/scripts/validate-adr.mjs .claude/skills/architecture-review/examples/0002-paginate-patient-search.md --repo . --status proposed", "expected": "OK  ADR-0002 status=proposed options=4 risks=5 citations=17"},
  {"name": "Human-written ADR-0001 still conforms to the template", "input": "node .claude/skills/architecture-review/scripts/validate-adr.mjs docs/adr/0001-fhir-lite-instead-of-hapi.md --repo . --template-only", "expected": "OK  ADR-0001 status=accepted options=2 risks=0 citations=0"},
  {"name": "Generated ADR is never accepted by the agent", "input": "grep -c '^- Status: proposed$' docs/adr/0002-paginate-patient-search.md", "expected": "1"},
  {"name": "Generated ADR passes the golden case", "input": "The second command of exampleInput", "expected": "Exit code 0. If it prints `FAIL case ar-01-patient-search-pagination: does not mention H2`, the skill skipped the portability risk: check that step 4 of SKILL.md names H2 and that the model read V1__init.sql."},
  {"name": "Unrelated requirement is not graded as a pass", "input": "node .claude/skills/architecture-review/scripts/validate-adr.mjs .claude/skills/architecture-review/examples/0002-paginate-patient-search.md --case skills/architecture-review/tests/cases.json#ar-03-oauth2-bearer-tokens", "expected": "Exit code 1 with `FAIL case ar-03-oauth2-bearer-tokens: does not cite SecurityConfig.java`"},
 ],
 "evaluationCriteria": [
  "Every statement about current behaviour in the ADR carries a `path:line` that resolves (`--repo` passes).",
  "At least two genuine options, each naming the classes it changes; the rejected options say why they lose.",
  "Risks are specific to this codebase (H2/PostgreSQL portability, shared test database, `Bundle.total`), not generic.",
  "The decision gives concrete values (default 20, max 100, 400 for invalid) and ticket ids for follow-ups.",
  "Status stays `proposed`; acceptance happens only in PR review.",
  "`SKILL.md` uses only documented frontmatter keys and stays under 500 lines, with template and checklist as supporting files.",
 ],
 "improvements": [
  "Run the skill with `context: fork` and `agent: Explore` for the read-only inspection phase, then write the ADR in the main session.",
  "Add a Mermaid sequence diagram section to `ADR_TEMPLATE.md` for decisions that change request flow.",
  "Add golden cases for requirements that should produce \"no ADR needed\" (for example a pure refactor inside one class).",
  "Have the orchestrator (module 08-workflow-orchestration) pass the ADR path to the test-strategy skill automatically.",
 ],
}

PATCH = f(f"{CR}/examples/patient-by-name.patch")
ex_cr = {
 "id": "03-code-review-diff",
 "title": "Build code-review and review a patch that concatenates JPQL and returns an entity",
 "objective": "Create the project `code-review` skill that replaces the bundled `/code-review` inside `AI-SDLC/`, injects the working-tree diff with `!` commands, reviews it against `context/standards/*`, and emits findings in the canonical format with a verdict. Apply the provided patch (a front-desk name search that builds JPQL by string concatenation and returns `List<Patient>` from the controller), run the skill, and validate the report.",
 "startingFiles": [
  {"path": f"{CR}/examples/patient-by-name.patch", "content": PATCH}
 ],
 "requiredStructure": "AI-SDLC/\n├── .claude/skills/code-review/\n│   ├── SKILL.md               # allowed-tools: git diff/status/log/show; disallowed-tools: Edit Write NotebookEdit\n│   ├── review-checklist.md    # 8 categories, each check cites a standard rule\n│   ├── output-format.md\n│   ├── examples/\n│   │   ├── patient-by-name.patch\n│   │   └── expected-review-patient-by-name.md\n│   └── scripts/\n│       ├── validate-findings.mjs\n│       └── validate-findings.test.mjs\n└── skills/code-review/{README.md,CHANGELOG.md,tests/cases.json,tests/patches/*.patch}",
 "implementation": [
  {"path": f"{CR}/SKILL.md", "language": "markdown", "tag": "verified-format"},
  {"path": f"{CR}/review-checklist.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{CR}/output-format.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{CR}/examples/expected-review-patient-by-name.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{CR}/scripts/validate-findings.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC\nP=.claude/skills/code-review/examples/patient-by-name.patch\ngit apply --directory=\"$(git rev-parse --show-prefix)\" \"$P\" && git add -N sample-app   # -N makes the new file visible to git diff\nclaude -p \"/code-review\" --output-format json | jq -r '.result' > /tmp/review.md\nnode .claude/skills/code-review/scripts/validate-findings.mjs /tmp/review.md --repo . \\\n  --case skills/code-review/tests/cases.json#cr-01-jpql-concat-entity-return\ngit apply -R --directory=\"$(git rev-parse --show-prefix)\" \"$P\" && git reset -q -- sample-app   # undo",
 "expectedOutput": """## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-001 | critical | security | `sample-app/src/main/java/org/example/fhir/repository/PatientNameSearch.java:19-20` | `String jpql = "select p from Patient p where lower(p.familyName) like '%" + fragment.toLowerCase() + "%' order by p.id";` | Bind the value with `@Query(... :fragment ...)` on `PatientRepository`; escape `%` and `_` (`coding-standards.md#6`, threat-model.md "SQL injection" row). |
| CR-002 | high | correctness | `sample-app/src/main/java/org/example/fhir/repository/PatientNameSearch.java:21` | with `name=O'Brien`: `org.hibernate.query.SyntaxException: At 1:59 and token 'brien'` and HTTP 500 | Fixed by CR-001's bound parameter; add an apostrophe-name test (`coding-standards.md#4`). |
| CR-003 | high | security | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:54` | `log.info("Patient name search: {}", name);` | Remove; use `audit.recordSearch("Patient", result.size())` (glossary PHI table). |
| CR-004 | high | design | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:53` | `public List<Patient> byName(@RequestParam String name) {` | Return `Bundle.searchset(...PatientMapper::toResource...)` (`coding-standards.md#2`). |
| CR-005 | high | security | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:53-55` | `name=` becomes `like '%%'` and returns every patient | Reject blank fragments with `FhirApiException.badRequest`, cap results (overview.md "Patient search without parameters returns 400"). |
| CR-006 | high | testing | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:52` | `git diff --stat HEAD` lists nothing under `sample-app/src/test/` | MockMvc tests for match, apostrophe, blank -> 400, anonymous -> 401 (testing-standards.md). |
| CR-007 | medium | design | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:31` | `private final PatientNameSearch nameSearch;` | Query in `PatientRepository`, call from a `@Transactional(readOnly = true)` service method (`coding-standards.md#1`, `#5`). |
| CR-008 | medium | standards | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:55` | `return nameSearch.byFamilyFragment(name);` | Record through `AuditLogger.recordSearch` (`coding-standards.md#7`). |
...
## Categories checked
- correctness: CR-002
- readability: no findings
- security: CR-001, CR-003, CR-005

## Verdict
BLOCK

$ node .claude/skills/code-review/scripts/validate-findings.mjs /tmp/review.md --repo . --case skills/code-review/tests/cases.json#cr-01-jpql-concat-entity-return
OK  10 findings {"critical":1,"high":5,"medium":2,"low":2,"info":0} verdict=BLOCK case=cr-01-jpql-concat-entity-return""",
 "testCases": [
  {"name": "Patch applies to the unmodified sample app", "input": "cd AI-SDLC && git apply --check -v --directory=\"$(git rev-parse --show-prefix)\" .claude/skills/code-review/examples/patient-by-name.patch", "expected": "Checking patch .../PatientController.java...\nChecking patch .../PatientNameSearch.java...\nexit code 0"},
  {"name": "CI does not catch the bug", "input": "With the patch applied: cd sample-app && mvn -q -B test", "expected": "Exit code 0; 25 tests, 0 failures. The review, not the build, blocks this change."},
  {"name": "Validator unit tests pass", "input": "node --test .claude/skills/code-review/scripts/validate-findings.test.mjs", "expected": "# pass 8\n# fail 0"},
  {"name": "Reference review passes its golden case", "input": "node .claude/skills/code-review/scripts/validate-findings.mjs .claude/skills/code-review/examples/expected-review-patient-by-name.md --case skills/code-review/tests/cases.json#cr-01-jpql-concat-entity-return", "expected": "OK  10 findings {\"critical\":1,\"high\":5,\"medium\":2,\"low\":2,\"info\":0} verdict=BLOCK case=cr-01-jpql-concat-entity-return"},
  {"name": "The project skill answers /code-review", "input": "claude -p \"/code-review\" --output-format json | jq -r '.result' | grep -c '^| CR-'", "expected": "A number >= 1 and headings `## Findings` / `## Verdict`; the bundled review's free-form output would contain no `CR-` ids."},
  {"name": "Reviewer cannot edit while reviewing", "input": "grep '^disallowed-tools:' .claude/skills/code-review/SKILL.md", "expected": "disallowed-tools: Edit Write NotebookEdit"},
  {"name": "False-positive control", "input": "Apply skills/code-review/tests/patches/test-only-empty-identifier-search.patch, run /code-review, validate with `node .claude/skills/code-review/scripts/validate-findings.mjs /tmp/review.md --repo . --case skills/code-review/tests/cases.json#cr-06-clean-test-only-change`", "expected": "Verdict APPROVE and no finding above low; exit code 0."},
 ],
 "evaluationCriteria": [
  "Finds the JPQL concatenation as critical security and cites `coding-standards.md#6`.",
  "Flags the entity return (`List<Patient>`) and the PHI log line as separate root causes.",
  "Evidence is quoted verbatim from the diff; locations use post-change line numbers that exist in the patched files (`--repo` passes).",
  "Every one of the eight categories is listed as ids or `no findings`.",
  "Does not report the planted `TEACHING-DEFECT(perf-n+1)`, which the diff does not touch.",
  "Verdict follows review-standards.md (any critical or high means BLOCK).",
 ],
 "improvements": [
  "Add `context: fork` with a custom `agent: reviewer` so a long diff does not fill the main session's context.",
  "Post findings as inline PR comments through the GitHub MCP server (module 06-mcp-and-tooling-architecture).",
  "Add golden cases for Flyway migration edits (`coding-standards.md#10`) and for a controller that swallows exceptions.",
  "Emit the findings table as JSON with `claude -p --json-schema` so CI can gate on `structured_output` directly.",
 ],
}

ex_ts = {
 "id": "03-test-strategy-lastn",
 "title": "Build test-strategy and plan the tests for GET /fhir/Observation/$lastn",
 "objective": "Create the `test-strategy` skill (procedure, test-plan template, tooling map, validator) and use it to plan tests for `$lastn` across all eight categories, mapped to JUnit 5, Mockito, MockMvc, H2 and Hibernate statistics. Implement the plan's cases in two test classes, prove the passing ones pass and the `new-failing` ones fail for the documented reasons on a scratch copy of the app.",
 "startingFiles": [],
 "requiredStructure": "AI-SDLC/\n├── .claude/skills/test-strategy/\n│   ├── SKILL.md\n│   ├── TEST_PLAN_TEMPLATE.md\n│   ├── tooling-map.md\n│   ├── examples/\n│   │   ├── lastn-test-plan.md\n│   │   ├── ObservationLastnTest.java           # api, negative, edge, security, integration\n│   │   └── ObservationServiceLastnTest.java    # unit (Mockito)\n│   └── scripts/\n│       ├── validate-test-plan.mjs\n│       └── validate-test-plan.test.mjs\n└── skills/test-strategy/{README.md,CHANGELOG.md,tests/cases.json}",
 "implementation": [
  {"path": f"{TS}/SKILL.md", "language": "markdown", "tag": "verified-format"},
  {"path": f"{TS}/TEST_PLAN_TEMPLATE.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{TS}/tooling-map.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{TS}/examples/lastn-test-plan.md", "language": "markdown", "tag": "illustrative"},
  {"path": f"{TS}/examples/ObservationLastnTest.java", "language": "java", "tag": "illustrative"},
  {"path": f"{TS}/examples/ObservationServiceLastnTest.java", "language": "java", "tag": "illustrative"},
  {"path": f"{TS}/scripts/validate-test-plan.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC\nclaude -p \"/test-strategy GET /fhir/Observation/\\$lastn\" --permission-mode plan --output-format json | jq -r '.result' > /tmp/lastn-plan.md\nnode .claude/skills/test-strategy/scripts/validate-test-plan.mjs /tmp/lastn-plan.md --repo . \\\n  --case skills/test-strategy/tests/cases.json#ts-01-lastn-endpoint",
 "expectedOutput": """## Risks and defects found while planning
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| TS-001 | medium | correctness | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:71` | patient with an undated value 99 and a dated value 80 -> `$lastn` returns `"valueQuantity":{"value":99` | NULL sorts first in DESC (H2 `DEFAULT_NULL_ORDERING=HIGH`, PostgreSQL default); exclude undated rows or order NULLS LAST; FHIR-130, TC-10. |
| TS-002 | low | correctness | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43` | `subjects=1,1` -> `"total":2` | De-duplicate ids; FHIR-131, TC-11. |
| TS-003 | high | performance | `sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69` | 1 subject -> 2 statements, 10 -> 20, 50 -> 100 | Planted `TEACHING-DEFECT(perf-n+1)`; detect with TC-13, fix in module 04. |
| TS-004 | medium | security | `sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43` | `@RequestParam List<Long> subjects` has no size limit | Cap at 100 with 400 OperationOutcome; FHIR-132, TC-14. |

## Test cases (excerpt)
| id | category | tool | test | scenario | expected | status |
|---|---|---|---|---|---|---|
| TC-02 | unit | JUnit 5 + Mockito | `ObservationServiceLastnTest#lastNSkipsUnknownSubjectsAndAuditsOnlyTheCount` | findById empty for 41, 42 | empty, no observation query, `audit.recordSearch("Observation", 0)` | new |
| TC-07 | negative | MockMvc | `ObservationLastnTest#lastnWithNonNumericSubjectIs400` | `subjects=abc` | 400 `invalid`, `Invalid value for parameter: subjects` | new |
| TC-10 | edge | MockMvc + H2 | `ObservationLastnTest#lastnPrefersDatedObservationOverUndated` | undated 99, dated 80 | value 80 | new-failing |
| TC-18 | regression | MockMvc + H2 | `ObservationApiTest#lastnReturnsMostRecentObservationPerSubject` | existing guard | keeps passing | existing |

$ node .claude/skills/test-strategy/scripts/validate-test-plan.mjs /tmp/lastn-plan.md --repo . --case skills/test-strategy/tests/cases.json#ts-01-lastn-endpoint
OK  18 cases {"unit":2,"integration":1,"api":2,"negative":2,"edge":5,"performance":2,"security":3,"regression":1} {"existing":1,"new":13,"new-failing":4} findings=6 case=ts-01-lastn-endpoint

$ (copy both example classes into a scratch copy of sample-app) mvn -q -B test
Tests run: 14, Failures: 0, Errors: 0, Skipped: 3 -- in org.example.fhir.ObservationLastnTest
Tests run: 2, Failures: 0, Errors: 0, Skipped: 0 -- in org.example.fhir.service.ObservationServiceLastnTest

$ (remove the three @Disabled lines) mvn -q -B test -Dtest=ObservationLastnTest
[ERROR]   ObservationLastnTest.lastnPrefersDatedObservationOverUndated:117 JSON path "$.entry[0].resource.valueQuantity.value" expected:<80> but was:<99>
[ERROR]   ObservationLastnTest.lastnRejectsMoreThanHundredSubjects:147 Status expected:<400> but was:<200>
[ERROR]   ObservationLastnTest.lastnReturnsOneEntryPerDistinctSubject:128 JSON path "$.total" expected:<1> but was:<2>""",
 "testCases": [
  {"name": "Validator unit tests pass", "input": "cd AI-SDLC && node --test .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs", "expected": "# pass 9\n# fail 0"},
  {"name": "Reference plan is valid against the real test sources", "input": "node .claude/skills/test-strategy/scripts/validate-test-plan.mjs .claude/skills/test-strategy/examples/lastn-test-plan.md --repo .", "expected": "OK  18 cases {\"unit\":2,\"integration\":1,\"api\":2,\"negative\":2,\"edge\":5,\"performance\":2,\"security\":3,\"regression\":1} {\"existing\":1,\"new\":13,\"new-failing\":4} findings=6"},
  {"name": "Plan does not invent existing tests", "input": "Generated plan validated with --repo .", "expected": "No `FAIL test case TC-..: marked existing but ... is not in sample-app/src/test/java` lines. The only existing $lastn test is `ObservationApiTest#lastnReturnsMostRecentObservationPerSubject`."},
  {"name": "Example tests compile and pass with defects disabled", "input": "cp -r sample-app /tmp/sa && cp .claude/skills/test-strategy/examples/ObservationLastnTest.java /tmp/sa/src/test/java/org/example/fhir/ && mkdir -p /tmp/sa/src/test/java/org/example/fhir/service && cp .claude/skills/test-strategy/examples/ObservationServiceLastnTest.java /tmp/sa/src/test/java/org/example/fhir/service/ && (cd /tmp/sa && mvn -q -B test)", "expected": "Exit code 0; 41 tests run, 3 skipped, 0 failures."},
  {"name": "Disabled tests really detect the defects", "input": "In /tmp/sa: sed -i 's/^    @Disabled(.*)$//' src/test/java/org/example/fhir/ObservationLastnTest.java && mvn -q -B test -Dtest=ObservationLastnTest", "expected": "3 failures: expected:<80> but was:<99>; Status expected:<400> but was:<200>; expected:<1> but was:<2>."},
  {"name": "All eight categories covered", "input": "node .claude/skills/test-strategy/scripts/validate-test-plan.mjs /tmp/lastn-plan.md --json | jq '.byCategory | to_entries | map(select(.value == 0)) | length'", "expected": "0"},
 ],
 "evaluationCriteria": [
  "Covers unit, integration, api, negative, edge, performance, security and regression, each with a concrete `TestClass#method`.",
  "Uses the real harness: `ApiTestSupport` helpers, `CLINICIAN`/`ADMIN` post-processors, unique family names because the H2 database is shared.",
  "Finds the undated-observation and duplicate-subject behaviour, not only the planted N+1.",
  "Marks the only existing `$lastn` test as `existing` and does not re-plan it.",
  "`new-failing` cases name the finding and ticket they prove and ship `@Disabled` with that ticket id.",
  "Performance is a statement-count assertion with Hibernate statistics, not a wall-clock timing.",
 ],
 "improvements": [
  "Let the tester agent run the plan's `new` cases through the run-tests skill (module 02) and attach the Surefire summary to the handoff.",
  "Add mutation testing (PIT) as an optional ninth column to check that the new tests kill mutants in `ObservationService.lastN`.",
  "Generate the plan for ADR-0002 (golden case `ts-05-patient-search-pagination`) and feed its test names into the ADR's Verification section.",
 ],
}

ex_assets = {
 "id": "03-skill-assets-golden-cases",
 "title": "Ship the three skills as versioned assets with golden cases",
 "objective": "Give each skill an asset folder under `AI-SDLC/skills/<name>/` with owner, version, changelog and golden cases (at least five per skill, with inputs and expected findings against the real sample app), make the deterministic parts pass in CI without a model, and prove the golden cases catch a regression in a skill's output.",
 "startingFiles": [],
 "requiredStructure": "AI-SDLC/skills/\n├── architecture-review/\n│   ├── README.md\n│   ├── CHANGELOG.md          # 1.0.0\n│   └── tests/cases.json      # 6 requirements\n├── code-review/\n│   ├── README.md\n│   ├── CHANGELOG.md          # 1.0.0\n│   └── tests/\n│       ├── cases.json        # 6 cases\n│       └── patches/          # 5 patches (+ the example patch in .claude/skills/code-review/examples/)\n└── test-strategy/\n    ├── README.md\n    ├── CHANGELOG.md          # 1.0.0\n    └── tests/cases.json      # 6 cases",
 "implementation": [
  {"path": "AI-SDLC/skills/code-review/README.md", "language": "markdown", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/code-review/CHANGELOG.md", "language": "markdown", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/code-review/tests/cases.json", "language": "json", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/code-review/tests/patches/delete-open-to-clinician.patch", "language": "diff", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/code-review/tests/patches/test-only-empty-identifier-search.patch", "language": "diff", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/architecture-review/README.md", "language": "markdown", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/architecture-review/CHANGELOG.md", "language": "markdown", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/architecture-review/tests/cases.json", "language": "json", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/test-strategy/README.md", "language": "markdown", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/test-strategy/CHANGELOG.md", "language": "markdown", "tag": "illustrative"},
  {"path": "AI-SDLC/skills/test-strategy/tests/cases.json", "language": "json", "tag": "illustrative"},
  {"path": f"{CR}/scripts/validate-findings.test.mjs", "language": "javascript", "tag": "illustrative"},
  {"path": f"{AR}/scripts/validate-adr.test.mjs", "language": "javascript", "tag": "illustrative"},
  {"path": f"{TS}/scripts/validate-test-plan.test.mjs", "language": "javascript", "tag": "illustrative"},
 ],
 "exampleInput": "cd AI-SDLC\n# 1. Deterministic checks (no model): validator suites\nnode --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs .claude/skills/code-review/scripts/validate-findings.test.mjs .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs\n# 2. Every golden patch still applies to the current sample app\nfor p in skills/code-review/tests/patches/*.patch; do git apply --check --directory=\"$(git rev-parse --show-prefix)\" \"$p\" && echo \"applies $p\"; done\n# 3. Simulate a skill regression: drop the Categories checked section from the reference review\nsed '/^## Categories checked/,/^## Verdict/{/^## Verdict/!d}' .claude/skills/code-review/examples/expected-review-patient-by-name.md > /tmp/regressed.md\nnode .claude/skills/code-review/scripts/validate-findings.mjs /tmp/regressed.md --case skills/code-review/tests/cases.json#cr-01-jpql-concat-entity-return",
 "expectedOutput": """# tests 25
# suites 0
# pass 25
# fail 0

applies skills/code-review/tests/patches/delete-open-to-clinician.patch
applies skills/code-review/tests/patches/drop-observation-read-audit.patch
applies skills/code-review/tests/patches/lastn-debug-logs-values.patch
applies skills/code-review/tests/patches/test-only-empty-identifier-search.patch
applies skills/code-review/tests/patches/update-skips-id-check.patch

FAIL missing section "## Categories checked"
FAIL Categories checked: "correctness" not listed (write "correctness: no findings" if clean)
FAIL Categories checked: "design" not listed (write "design: no findings" if clean)
FAIL Categories checked: "readability" not listed (write "readability: no findings" if clean)
FAIL Categories checked: "testing" not listed (write "testing: no findings" if clean)
FAIL Categories checked: "security" not listed (write "security: no findings" if clean)
FAIL Categories checked: "performance" not listed (write "performance: no findings" if clean)
FAIL Categories checked: "standards" not listed (write "standards: no findings" if clean)
FAIL Categories checked: "docs" not listed (write "docs: no findings" if clean)
INVALID  10 findings {"critical":1,"high":5,"medium":2,"low":2,"info":0} verdict=BLOCK case=cr-01-jpql-concat-entity-return""",
 "testCases": [
  {"name": "At least five golden cases per skill", "input": "for s in architecture-review code-review test-strategy; do node -e \"console.log(process.argv[1], JSON.parse(require('fs').readFileSync('skills/'+process.argv[1]+'/tests/cases.json','utf8')).cases.length)\" $s; done", "expected": "architecture-review 6\ncode-review 6\ntest-strategy 6"},
  {"name": "Every case has input and expected", "input": "node -e \"for (const s of ['architecture-review','code-review','test-strategy']) for (const c of JSON.parse(require('fs').readFileSync('skills/'+s+'/tests/cases.json','utf8')).cases) if (!c.input || !c.expected) console.log('bad', s, c.id)\"", "expected": "No output."},
  {"name": "Patch outcomes are recorded from real runs", "input": "Apply skills/code-review/tests/patches/delete-open-to-clinician.patch to a scratch copy and run mvn -q -B test", "expected": "Tests run: 25, Failures: 1; `SecurityTest.clinicianCannotDelete:33 Status expected:<403> but was:<204>`, matching `testsAfterPatch` in case cr-02."},
  {"name": "Versions agree", "input": "grep -h '^## 1.0.0' skills/{architecture-review,code-review,test-strategy}/CHANGELOG.md | wc -l; grep -h '\"skillVersion\"' skills/{architecture-review,code-review,test-strategy}/tests/cases.json | sort -u", "expected": "3\n  \"skillVersion\": \"1.0.0\","},
  {"name": "Regression is caught", "input": "Step 3 of exampleInput", "expected": "Exit code 1 and `FAIL missing section \"## Categories checked\"`."},
 ],
 "evaluationCriteria": [
  "Each README names owner, consumers (which agent preloads the skill), invocation, whether it writes files, and how to test.",
  "Golden cases cite real files and line-level facts; patches apply with `git apply --check` to the current sample app.",
  "At least one false-positive control case exists (a clean change that must be approved).",
  "Validators and their tests run with Node 22 and no dependencies, so CI can run them without a model or API key.",
  "CHANGELOG uses semantic versioning with the output-format change rule stated.",
 ],
 "improvements": [
  "Add a CI job that runs the three validator test files with `node --test` and `git apply --check` for every golden patch on each pull request.",
  "Wire the live golden runs into the eval harness in module 09-agent-evaluation and track pass rate per skill version.",
  "Package the three skills as a plugin for other teams (module 10-governance), keeping `skills/<name>/` as the source of truth for versions.",
 ],
}

for x in (ex_ar, ex_cr, ex_ts, ex_assets):
    for i in x["implementation"]:
        i["content"] = f(i["path"])
        # keep key order path, language, content, tag
        i_sorted = {"path": i["path"], "language": i["language"], "content": i["content"], "tag": i["tag"]}
        i.clear(); i.update(i_sorted)

mod = {
 "id": "03-skills-architecture-code-test",
 "level": 3,
 "title": "Production skills: architecture review, code review, test strategy",
 "summary": "Build three production-grade skills that the architect, reviewer and tester agents preload: architecture-review (requirement to ADR with evidence and risks), code-review (a diff against the house standards in the canonical findings format, replacing the bundled /code-review in this project), and test-strategy (an eight-category test plan mapped to JUnit 5, MockMvc and H2). Each ships with templates, a zero-dependency validator, and golden cases built from behaviour measured on the real sample app.",
 "prerequisites": ["02-first-agent-skill-tools", "00-example", "Node 22 and Java 21 / Maven 3.9 installed", "Comfort reading Spring Data JPA queries and MockMvc tests"],
 "concepts": concepts,
 "diagrams": diagrams,
 "comparisonTables": tables,
 "exercises": [ex_ar, ex_cr, ex_ts, ex_assets],
 "agentContracts": [],
 "checklist": [
  "`.claude/skills/{architecture-review,code-review,test-strategy}/SKILL.md` exist and use only documented frontmatter keys (no `disable-model-invocation`, so agents can preload them).",
  "`node --test` on the three validator test files (`validate-adr.test.mjs`, `validate-findings.test.mjs`, `validate-test-plan.test.mjs`) reports 25 passing tests.",
  "`validate-adr.mjs` on `examples/0002-paginate-patient-search.md` with `--repo . --status proposed` prints `OK  ADR-0002`.",
  "Inside `AI-SDLC/`, `/code-review` produces a findings table with `CR-` ids (the project skill replaced the bundled one).",
  "The code-review patch applies cleanly, `mvn -q -B test` still passes with it, and the review verdict is `BLOCK` with a critical JPQL-injection finding.",
  "The `$lastn` test plan covers all eight categories and validates with `--repo .`.",
  "The two example test classes pass on a scratch copy (41 tests, 3 skipped) and the three disabled tests fail for the documented reasons when enabled.",
  "Each skill has `skills/<name>/README.md`, `CHANGELOG.md` at 1.0.0 and `tests/cases.json` with at least five cases.",
  "Every golden patch passes `git apply --check`.",
  "`sample-app/` is unchanged: `git status --short sample-app` prints nothing after the exercises.",
 ],
}
out = ROOT / "content/modules/03-skills-architecture-code-test.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
