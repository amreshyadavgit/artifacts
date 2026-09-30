# Generator for content/modules/04-skills-security-performance-rca.json. Run: python3 build/sources/04-skills-security-performance-rca.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()

SR = "AI-SDLC/.claude/skills/security-review/"
PR = "AI-SDLC/.claude/skills/performance-review/"
RC = "AI-SDLC/.claude/skills/production-rca/"
EV = RC + "examples/INC-2026-0922-lastn/"

report_md = f("AI-SDLC/skills/security-review/tests/expected/sample-app-report.md")
report_excerpt = "\n".join(report_md.splitlines()[:19])

mod = {
 "id": "04-skills-security-performance-rca",
 "level": 3,
 "title": "Production Skills: Security Review, Performance Review and Production RCA",
 "summary": "Build three production-grade skills the security and sre agents depend on: a PHI-first security-review that replaces the bundled /security-review and emits schema-validated JSON, a measure-first performance-review that proves the $lastn N+1 (40 statements for 20 subjects, 1 after the fix), and a production-rca skill that turns a synthetic incident evidence pack into a cited, blameless RCA. Each skill ships with instruments (schema, zero-dependency scripts, patch and test) and is versioned as an engineering asset with golden cases.",
 "prerequisites": [
  "03-skills-architecture-code-test",
  "Java 21 and Maven 3.9 (`cd AI-SDLC/sample-app && mvn -q -B test` passes with 25 tests)",
  "Node 22 (the helper scripts have no dependencies)",
  "Claude Code CLI authenticated, for the live `claude -p` steps"
 ],
 "concepts": [
  {"heading": "A production skill is a procedure plus instruments",
   "body_md": "Module 03-skills-architecture-code-test built skills that are mostly procedure: what to read, what to check, how to format findings. The three skills in this module add **instruments**: files the model runs or validates against, so part of the result is deterministic.\n\n| Skill | Procedure (`SKILL.md`) | Reference (loaded on demand) | Instrument (executed) |\n|---|---|---|---|\n| `security-review` | scope, ten categories, severity calibration | `checklist.md`, `report.schema.json` | `scripts/render-report.mjs` |\n| `performance-review` | measure first, severity, output | `checklist.md`, `examples/lastn-fix/` | `scripts/count-queries.mjs`, `LastnQueryCountTest.java` |\n| `production-rca` | guard, analysis order, reasoning rules | `rca-template.md`, evidence pack | `scripts/build-timeline.mjs` |\n\nWhy this split matters (from `build/CLAUDE_CODE_FACTS.md` §2):\n\n- The skill **description** is always in context; the **body** loads when the skill is invoked; supporting files load only when Claude reads them. Keep `SKILL.md` short (the docs say under 500 lines) and link the rest.\n- Scripts are **executed, not loaded**. A 150-line validator costs no context; its exit code does the talking.\n- `${CLAUDE_SKILL_DIR}` resolves to the skill's own folder, so `node ${CLAUDE_SKILL_DIR}/scripts/count-queries.mjs` works wherever the skill is installed.\n\nThe rule of thumb: anything a reviewer would otherwise re-check by hand every time (schema shape, severity counts, statement counts, timestamp ordering, PHI patterns) becomes a script. The model does the judgement; the script makes the judgement checkable.\n\nSo in practice, when you write a skill, ask for each step: *could a 50-line Node script decide this?* If yes, write the script and make the skill call it."},
  {"heading": "Replacing the bundled /security-review, and the frontmatter choices",
   "body_md": "Claude Code ships a bundled `/security-review`. Per the FACTS addendum, **a project skill with the same name replaces the bundled command** (but not its aliases). Inside `AI-SDLC/`, `/security-review` now runs `.claude/skills/security-review/SKILL.md`, with this repo's PHI table, severity scale and report schema. Outside the project the bundled one still runs. Say this in the skill's README so nobody is surprised.\n\nFrontmatter, and why each key is there:\n\n- `description` + `when_to_use`: what Claude matches on for automatic use. Both appear in the skill listing (truncated at 1,536 characters combined).\n- `argument-hint: \"[diff | path | git-range]\"`: autocomplete hint. Quote it: an unquoted `[...]` is a YAML list.\n- `allowed-tools: Read Grep Glob Bash(git diff *) Bash(git log *) Bash(node */security-review/scripts/render-report.mjs *)`: **pre-approves** these while the skill is active. It does not restrict anything; restriction comes from the `security` agent's `tools` list (module 05-agent-roster) and from `disallowed-tools` if you need it.\n- **No** `disable-model-invocation`. The security agent preloads this skill through its `skills:` field, and the docs say skills with `disable-model-invocation: true` cannot be preloaded.\n\nThe body injects the pending diff before the model starts:\n\n```markdown\n!`git diff --stat`\n```\n\nDynamic injection is checked against permission rules. `Bash(git diff *)` is already allowed in `.claude/settings.json`, so it runs without a prompt. A non-zero exit aborts the whole invocation, which is why the command is `git diff --stat` (exit 0 with no changes) and not something that fails on a clean tree.\n\nThe same reasoning shaped `production-rca`'s `allowed-tools`: it pre-approves `Bash(kubectl get events *)` and `Bash(kubectl get pods *)` but **not** `Bash(kubectl get *)`, which would also pre-approve `kubectl get secret fhir-lite-secrets -o yaml`."},
  {"heading": "Structured security findings with a healthcare severity scale",
   "body_md": "A security review that returns prose cannot gate a merge. `security-review` returns one JSON object that validates against `report.schema.json`: `scope`, `summary` (counts per severity plus `verdict`), `findings[]` (`id`, `severity`, `category`, `title`, `location`, `evidence`, `recommendation`, `confidence`, `phi`, optional `cwe`), `checkedClean[]` and `limitations[]`.\n\nHeadless, the documented `--json-schema` flag makes Claude return that object in `structured_output`:\n\n```bash\nclaude -p \"/security-review sample-app/\" --permission-mode plan --output-format json \\\n  --json-schema \"$(cat .claude/skills/security-review/report.schema.json)\" | jq '.structured_output'\n```\n\n`render-report.mjs` then does what a model should not be trusted to do alone: validate the schema, check that `summary` counts equal the findings, recompute the verdict (`block` on any critical/high, `needs-decision` on medium, else `pass`), reject evidence containing a non-synthetic MRN, and exit `1` under `--fail-on high`.\n\n**Severity calibration** is where healthcare differs. `context/security/phi-and-secrets-policy.md` lists \"PHI exposure\" under critical. The skill sharpens it: PHI disclosed to an unauthorized **caller** is `critical`; PHI written to an **internal sink** (application logs) is `high`. Both block the merge; the distinction drives incident response.\n\nThe review of the unmodified sample app is not empty. The answer key (`skills/security-review/tests/expected/sample-app-report.json`) has 1 high, 5 medium, 3 low, 1 info. The high one was reproduced while building this module: `PatientResource.HumanName.given` has no `@Size`, the column is `VARCHAR(255)`, and a 280-character given name produces a 500 whose H2 error message, containing the name, is logged at ERROR by Hibernate's `SqlExceptionHelper` and by `GlobalExceptionHandler.handleUnexpected` (`log.error(\"Unhandled exception\", ex)`, line 71). The code *looks* PHI-safe: `AuditLogger` logs ids only, validation errors echo field names only. The leak is in the path nobody wrote on purpose.\n\nSo in practice: every category ends in findings or a `checkedClean` entry. A silent category is a category nobody checked."},
  {"heading": "Measure before you fix: statements per request",
   "body_md": "\"This looks like an N+1\" is an opinion. \"`$lastn` issues 40 statements for 20 subjects and 1 after the patch\" is a finding. `performance-review` requires a number for every `high`.\n\nTwo instruments, both verified against the sample app:\n\n1. **Hibernate statistics in a test.** `examples/lastn-fix/LastnQueryCountTest.java` extends `ApiTestSupport`, adds `@TestPropertySource(properties = \"spring.jpa.properties.hibernate.generate_statistics=true\")`, clears `Statistics`, calls `GET /fhir/Observation/$lastn` through MockMvc and asserts `getPrepareStatementCount() <= 2`. This is the \"performance smoke: query-count assertion\" row in `context/standards/testing-standards.md`, and it becomes the regression test.\n2. **SQL log plus a parser.** Run the same test with `-Dspring.jpa.show-sql=true` and feed the output to `scripts/count-queries.mjs --from LASTN_BEGIN --to LASTN_QUERY_COUNT`. It groups statements by shape (literals and `IN (...)` lists collapsed), flags any `select` shape repeated five or more times, and never prints bind values.\n\nMeasured in a scratch copy of the app:\n\n| | statements (20 subjects) | shapes | tests |\n|---|---|---|---|\n| `TEACHING-DEFECT(perf-n+1)` as shipped | 40 | 2, both N+1 suspects | `LastnQueryCountTest`: 2 of 4 fail |\n| `lastn-set-based.patch` applied | 1 | 1 | full suite: 29 pass |\n\nThe log also surfaces things nobody asked about: the derived query `findByPatientIdOrderByEffectiveDateTimeDesc` generates `join patient p1_0 on p1_0.id=o1_0.patient_id where p1_0.id=?`, and `findByFamilyNameIgnoreCaseOrderByIdAsc` generates `upper(p1_0.family_name)=upper(?)`, which cannot use `ix_patient_family_name` on PostgreSQL.\n\nThe fix is set-based, not a cache: one `ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY effective_date_time DESC, id DESC)` query over `patient_id IN (:patientIds)`, the code predicate pushed into SQL, results re-ordered to request order, and a 100-subject cap. A cache in front of an N+1 hides it until the first cold miss under load, which is exactly the incident in the next concept."},
  {"heading": "RCA is evidence discipline, not storytelling",
   "body_md": "The `production-rca` skill works from an evidence pack, `examples/INC-2026-0922-lastn/`: incident brief, change calendar, application logs from two pods, ingress access log, Kubernetes events, `kubectl describe pod`, rollout history, and metrics including a `pg_stat_statements` diff. It is synthetic, internally consistent and PHI-free.\n\nThe skill enforces four habits:\n\n1. **Guard the evidence first.** `build-timeline.mjs` refuses to print anything if a line looks like PHI (MRN, birth date, name fields, database errors that echo submitted values) and exits `3`. Evidence from a real incident can contain exactly the leak found by security-review SEC-001; the RCA must not copy it into a document that gets shared widely.\n2. **Always weigh the boring candidates.** Bad deploy, database degradation, resource exhaustion, traffic or data change. Each gets evidence for and evidence against. Here `rollout-history.txt` rejects the deploy; `pg_stat_statements` (mean 1.62 ms per call) rejects the database; `Reason: Error, Exit Code: 137` rejects OOM, because a SIGKILL after a liveness failure and the grace period is not `OOMKilled`.\n3. **Quantify across sources.** 431,616 calls of the per-patient query = 843 requests x 512 subjects; 176,099,328 rows / 431,616 calls = 408 rows per call = the import's average history. When numbers from independent sources agree, the causal chain is real.\n4. **Separate trigger, root cause and contributing factors.** Trigger: the dashboard go-live. Root cause: the N+1 in `ObservationService.lastN` plus no cap on `subjects`. Contributing: probes with a 1 s timeout on the traffic connector, 30 s pool timeout, no application metrics, a load test with 20 patients x 2 observations, a shared `clinician` account.\n\nHealthcare adds two impact rows most templates lack: **clinical safety** (could a clinician act on stale data?) and **PHI exposure** (and how you checked). Both are in `rca-template.md`."},
  {"heading": "Skills as versioned engineering assets",
   "body_md": "A skill that the `security` agent preloads on every review is production code for your SDLC. The runtime/asset split (`.claude/skills/<name>/` versus `skills/<name>/` with `README.md`, `CHANGELOG.md` and `tests/cases.json`) and the release discipline are introduced in module 03-skills-architecture-code-test; the three skills here follow them and add answer keys in `skills/<name>/tests/expected/`.\n\nWhere the answer key lives is deliberate. If the answer key lived inside `.claude/skills/security-review/`, a `Glob` during a review could find the expected report and copy it. Keep answers outside the directory the skill reads.\n\nGolden cases come in two kinds:\n\n| Kind | Needs a model | Example | What it proves |\n|---|---|---|---|\n| deterministic | no | `perf-06`: `count-queries.mjs` on the real before-log exits 1 with 40 statements | the instruments work |\n| live | yes | `sec-05`: moving the DELETE matcher below `/fhir/**` must yield an `authz` finding of at least `high` | the procedure works |\n\nLive cases include **negative controls**: `sec-07` (a README-only diff must pass), `rca-02` (an `OOMKilled` incident must not be blamed on the N+1), `rca-05` (thin evidence must end in \"not determined\"). A skill that finds the N+1 in every incident is not a good RCA skill; it is a pattern matcher.\n\nEvery change re-runs the cases and records the pass rate in the CHANGELOG (versioning rule: module 03; library-wide policy: module 10-governance). Module 09-agent-evaluation builds the harness that runs these at scale."}
 ],
 "diagrams": [
  {"title": "security-review: from invocation to merge gate",
   "mermaid": "sequenceDiagram\n  participant H as Human or orchestrator\n  participant C as claude -p (security agent)\n  participant S as security-review skill\n  participant R as render-report.mjs\n  H->>C: /security-review sample-app/ --json-schema report.schema.json\n  C->>S: load SKILL.md, inject git diff --stat\n  S->>C: read checklist.md, threat model, PHI table\n  C->>C: Grep and Read across ten categories\n  C-->>H: structured_output (JSON report)\n  H->>R: report.json --fail-on high\n  R-->>H: exit 2: invalid schema, counts or real MRN\n  R-->>H: exit 1: high or critical present, block merge\n  R-->>H: exit 0: Markdown report, no blocking finding"},
  {"title": "INC-2026-0922-01 causal chain",
   "mermaid": "flowchart TD\n  A[\"CHG-4471: 208,896 observations imported for 512 patients\"] --> C\n  B[\"CHG-4472: dashboard polls $lastn for 512 subjects every 30 s\"] --> C\n  C[\"ObservationService.lastN: 2 queries per subject, full history loaded\"] --> D[\"1,024 statements and about 209k rows per request\"]\n  D --> E[\"CPU throttling and GC stalls (1 CPU, about 576Mi heap)\"]\n  D --> F[\"Hikari pool exhausted: 10 of 10 active, up to 63 waiting\"]\n  E --> G[\"Probes time out after 1 s\"]\n  F --> H[\"Other endpoints wait 30 s, then 500 or 504\"]\n  G --> I[\"Readiness fails, traffic concentrates on the other pod\"]\n  I --> J[\"Liveness kills pods: exit 137, Reason Error\"]\n  J -->|\"restarted pods get the same load\"| C\n  K[\"No cap on subjects (ObservationController.java:43)\"] -.->|\"root cause\"| C"},
  {"title": "performance-review: measure, fix, prove",
   "mermaid": "flowchart LR\n  M1[\"LastnQueryCountTest on the shipped app\"] -->|\"40 statements, 2 of 4 fail\"| F1[\"count-queries.mjs: 2 N+1 suspects\"]\n  F1 --> P[\"Apply lastn-set-based.patch in a scratch copy\"]\n  P --> M2[\"LastnQueryCountTest again\"]\n  M2 -->|\"1 statement, 4 of 4 pass\"| S[\"Full suite: 29 tests pass\"]\n  S --> O[\"Finding PERF-001 with before and after numbers\"]"}
 ],
 "comparisonTables": [
  {"title": "The three skills side by side",
   "columns": ["", "security-review", "performance-review", "production-rca"],
   "rows": [
    ["Invocation", "`/security-review [diff | path | git-range]`", "`/performance-review [diff | path | endpoint]`", "`/production-rca [evidence-dir] [incident-id]`"],
    ["Preloaded by", "`security` agent", "`sre` agent", "`sre` agent"],
    ["Primary input", "code and manifests", "code, SQL logs, a query-count test", "evidence pack (logs, events, metrics, changes)"],
    ["Output", "JSON valid against `report.schema.json`, rendered to Markdown", "findings table + measurements + proposed patch", "11-section RCA from `rca-template.md`, `status: needs-human`"],
    ["Instrument", "`render-report.mjs` (schema, counts, verdict, MRN guard, `--fail-on`)", "`count-queries.mjs` (shapes, N+1 suspects, `--fail-on-suspect`)", "`build-timeline.mjs` (UTC merge, refs, PHI guard exit 3)"],
    ["Pre-approved tools", "Read, Grep, Glob, `git diff`, `git log`, renderer", "Read, Grep, Glob, `git diff`, `mvn -q -B test`, helper", "Read, Grep, Glob, read-only `kubectl` subcommands, helper"],
    ["Blocking signal", "`verdict: block` / renderer exit 1", "`high` finding with a measurement", "none: an RCA always needs human review"],
    ["Negative-control case", "`sec-07` README-only diff passes", "`perf-02` patched app has no N+1", "`rca-02` OOMKilled, `rca-05` thin evidence"]
   ]},
  {"title": "Discriminating evidence for the RCA candidates",
   "columns": ["Hypothesis", "Would predict", "Observed", "Verdict"],
   "rows": [
    ["Bad deploy", "new ReplicaSet or image near 08:00", "last rollout 2026-09-18, same `fhir-lite-api:0.1.0`", "rejected"],
    ["OOM", "`Reason: OOMKilled`", "`Reason: Error`, `Exit Code: 137` after liveness Killing events", "rejected (memory pressure contributes via GC)"],
    ["Database degradation", "slow calls, lock waits, lag", "1.62 ms per call for 408 rows, no lock waits, lag under 1 s", "rejected (load was a consequence)"],
    ["Ingress or network", "`upstream_response_time` far below `request_time`", "they are equal on every slow line", "rejected"],
    ["N+1 x 512 subjects x deep history", "calls = requests x 512, rows per call = history depth", "431,616 = 843 x 512; 408 rows per call; recovery when the dashboard stopped", "confirmed"]
   ]}
 ],
 "exercises": [
  {"id": "04-security-review-skill",
   "title": "Build security-review: PHI-first checks, a JSON schema and a merge gate",
   "objective": "Replace the bundled /security-review inside AI-SDLC with a project skill that covers authN, authZ, input validation, secrets, PHI, SQL injection, API security, dependencies, logging and infrastructure, returns a JSON report that validates against a schema, and renders it to Markdown with a script that can fail a CI step. Run it against the unmodified sample app and confirm it finds the real PHI-in-logs path through GlobalExceptionHandler.",
   "startingFiles": [
    {"path": "AI-SDLC/.claude/skills/security-review/SKILL.md", "content": "---\nname: security-review\ndescription: Review code for security issues\n---\n\nReview the code for security vulnerabilities and list them.\n"}
   ],
   "requiredStructure": "AI-SDLC/.claude/skills/security-review/\n├── SKILL.md                      # frontmatter: name, description, when_to_use, argument-hint, allowed-tools\n├── checklist.md                  # ten categories, files to open, Grep patterns\n├── report.schema.json            # schemaVersion 1.0, severity critical..info\n├── scripts/\n│   └── render-report.mjs         # validate + render + --fail-on (exit 0/1/2)\n└── examples/\n    └── example-report.json       # one-finding format example (not the answer key)",
   "implementation": [
    {"path": SR + "SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": SR + "checklist.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": SR + "report.schema.json", "language": "json", "content": "", "tag": "illustrative"},
    {"path": SR + "scripts/render-report.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": SR + "examples/example-report.json", "language": "json", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude -p \"/security-review sample-app/\" --permission-mode plan --output-format json \\\n  --json-schema \"$(cat .claude/skills/security-review/report.schema.json)\" \\\n  | jq '.structured_output' > /tmp/security-report.json\nnode .claude/skills/security-review/scripts/render-report.mjs /tmp/security-report.json --fail-on high; echo \"exit=$?\"",
   "expectedOutput": report_excerpt + "\n(finding details omitted)\nrender-report: 1 finding(s) at or above high: SEC-001\nexit=1",
   "testCases": [
    {"name": "Renderer accepts the answer key and gates on high", "input": "node .claude/skills/security-review/scripts/render-report.mjs skills/security-review/tests/expected/sample-app-report.json --fail-on high; echo exit=$?", "expected": "Markdown with 'Verdict: **block**' and '| SEC-001 | high | phi |', stderr 'render-report: 1 finding(s) at or above high: SEC-001', exit=1"},
    {"name": "Renderer rejects inconsistent counts", "input": "node -e \"const r=require('./skills/security-review/tests/expected/sample-app-report.json'); r.summary.high=0; require('fs').writeFileSync('/tmp/bad.json', JSON.stringify(r))\" && node .claude/skills/security-review/scripts/render-report.mjs /tmp/bad.json; echo exit=$?", "expected": "stderr 'summary.high is 0 but findings contain 1', exit=2"},
    {"name": "Renderer rejects a non-synthetic MRN", "input": "Golden case sec-08 in skills/security-review/tests/cases.json", "expected": "exit 2, stderr contains 'MRN-483920, which is not a synthetic MRN; redact it'"},
    {"name": "The PHI finding is real", "input": "In a scratch copy of sample-app, add a MockMvc test that POSTs a Patient with a 280-character given name and run it with mvn -q -B test -Dtest=<that test>", "expected": "Response is 500 OperationOutcome 'Internal server error'; the console shows ERROR lines from o.h.engine.jdbc.spi.SqlExceptionHelper and o.e.fhir.error.GlobalExceptionHandler containing 'Value too long for column \"given_names CHARACTER VARYING(255)\"' followed by the submitted value"},
    {"name": "Live review finds the key findings and no injection", "input": "The exampleInput command, then jq '[.findings[] | {id, severity, category, location}]' /tmp/security-report.json", "expected": "A high 'phi' finding located at GlobalExceptionHandler.java (or PatientResource.java), a medium 'logging-audit' finding at ObservationService.java, a medium finding at ObservationController.java:43; no 'injection' finding; 'injection' appears in checkedClean"},
    {"name": "Project skill replaces the bundled one", "input": "cd AI-SDLC && claude -p \"/security-review diff\" --permission-mode plan --output-format json | jq -r '.result' | head -5", "expected": "Output follows this skill (JSON report with schemaVersion 1.0 and severities critical..info), not the bundled command's free-form review"}
   ],
   "evaluationCriteria": [
    "All ten categories are either in findings or in checkedClean with concrete evidence.",
    "Every critical or high finding quotes code and cites path:line relative to AI-SDLC/.",
    "No PHI in the report: patient values are [REDACTED] or synthetic MRN-000xxx.",
    "Severity follows the calibration table (PHI to caller = critical, PHI to logs = high).",
    "Frontmatter uses only documented keys; the skill stays preloadable (no disable-model-invocation).",
    "render-report.mjs exits 0/1/2 exactly as documented."
   ],
   "improvements": [
    "Add a `sarif` output mode to render-report.mjs so findings show up as code-scanning alerts on the PR.",
    "Add a `paths` frontmatter glob (`sample-app/**`) so the skill auto-activates only when Claude works on the app.",
    "Add a PreToolUse hook (module 10-governance) that blocks `git commit` while the latest report in the run folder has verdict block.",
    "Extend the MRN guard to the glossary's other PHI fields using a machine-readable phi-fields.json."
   ]},
  {"id": "04-performance-review-lastn",
   "title": "Build performance-review and prove the $lastn fix with a query count",
   "objective": "Create a performance-review skill that measures before it recommends, ship a zero-dependency SQL-log parser and a Hibernate-statistics test, then use them to prove the TEACHING-DEFECT(perf-n+1) in ObservationService.lastN (40 statements for 20 subjects) and that the set-based patch reduces it to 1 while the full suite still passes. Apply the patch only to a scratch copy; sample-app keeps the defect.",
   "startingFiles": [
    {"path": PR + "examples/lastn-fix/LastnQueryCountTest.java", "content": f(PR + "examples/lastn-fix/LastnQueryCountTest.java")}
   ],
   "requiredStructure": "AI-SDLC/.claude/skills/performance-review/\n├── SKILL.md                         # measure-first procedure, severity, output format\n├── checklist.md                     # queries, indexes, n+1, caching, latency, concurrency, memory, cpu, network\n├── scripts/\n│   └── count-queries.mjs            # Hibernate log -> statements by shape, N+1 suspects\n└── examples/lastn-fix/\n    ├── APPLY.md                     # scratch-copy commands\n    ├── LastnQueryCountTest.java     # starting file: 4 MockMvc tests, statement-count assertion\n    ├── lastn-set-based.patch        # ROW_NUMBER() query + 100-subject cap\n    ├── show-sql-before.log          # real excerpt, 40 statements\n    └── show-sql-after.log           # real excerpt, 1 statement",
   "implementation": [
    {"path": PR + "SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": PR + "checklist.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": PR + "scripts/count-queries.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": PR + "examples/lastn-fix/lastn-set-based.patch", "language": "diff", "content": "", "tag": "illustrative"},
    {"path": PR + "examples/lastn-fix/APPLY.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": PR + "examples/lastn-fix/show-sql-before.log", "language": "plaintext", "content": "", "tag": "illustrative"},
    {"path": PR + "examples/lastn-fix/show-sql-after.log", "language": "plaintext", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nclaude -p \"/performance-review GET /fhir/Observation/\\$lastn\" --permission-mode plan --output-format json | jq -r '.result'\n\n# then prove it in a scratch copy (commands from examples/lastn-fix/APPLY.md)\nrm -rf /tmp/lastn-copy && cp -r sample-app /tmp/lastn-copy && rm -rf /tmp/lastn-copy/target\ncp .claude/skills/performance-review/examples/lastn-fix/LastnQueryCountTest.java /tmp/lastn-copy/src/test/java/org/example/fhir/\n(cd /tmp/lastn-copy && mvn -q -B test -Dtest=LastnQueryCountTest) | grep -E \"LASTN_QUERY_COUNT|Tests run\"\n(cd /tmp/lastn-copy && git apply \"$OLDPWD/.claude/skills/performance-review/examples/lastn-fix/lastn-set-based.patch\" && mvn -q -B test | grep -E \"LASTN_QUERY_COUNT|FAIL\"; echo \"mvn exit ${PIPESTATUS[0]}\")\nnode .claude/skills/performance-review/scripts/count-queries.mjs .claude/skills/performance-review/examples/lastn-fix/show-sql-before.log --from LASTN_BEGIN --to LASTN_QUERY_COUNT",
   "expectedOutput": "## Findings\n| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| PERF-001 | high | n+1 | sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69 | `for (Long subjectId : subjectIds) { patients.findById(subjectId).ifPresent(patient -> observations.findByPatientIdOrderByEffectiveDateTimeDesc(patient.getId())...findFirst()` issues 2 statements per subject and loads each subject's full history to keep one row. Measured: 40 statements for 20 subjects. | One ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY effective_date_time DESC, id DESC) query over patient_id IN (:patientIds); code filter in SQL; patch examples/lastn-fix/lastn-set-based.patch |\n| PERF-002 | high | latency | sample-app/src/main/java/org/example/fhir/api/ObservationController.java:43 | `public Bundle lastN(@RequestParam List<Long> subjects, ...)` has no upper bound | Reject more than 100 subjects with 400 OperationOutcome |\n| PERF-004 | medium | indexes | sample-app/src/main/resources/db/migration/V1__init.sql:29 | `CREATE INDEX ix_observation_patient_code ON observation (patient_id, code);` does not cover ORDER BY effective_date_time DESC | New V2__ migration with (patient_id, effective_date_time DESC) |\n\nLASTN_QUERY_COUNT subjects=20 statements=40\n[ERROR] Tests run: 4, Failures: 2, Errors: 0, Skipped: 0\nLASTN_QUERY_COUNT subjects=20 statements=1\nmvn exit 0\nstatements: 40  distinct shapes: 2  n+1 threshold: 5\n    20  select o1_0.id,o1_0.code,o1_0.code_display,o1_0.code_system,o1_0.effective_date_time,o1_0.patient_id,o1_0.status,o1_0.value_quantity,o1_0...  <-- N+1 suspect\n    20  select p1_0.id,p1_0.active,p1_0.birth_date,p1_0.family_name,p1_0.gender,p1_0.given_names,p1_0.mrn,p1_0.mrn_system from patient p1_0 where...  <-- N+1 suspect",
   "testCases": [
    {"name": "Defect is measurable", "input": "In the scratch copy before the patch: mvn -q -B test -Dtest=LastnQueryCountTest", "expected": "'LASTN_QUERY_COUNT subjects=20 statements=40'; 2 of 4 tests fail (statement count and the 101-subject cap)"},
    {"name": "Patch fixes it without regressions", "input": "git apply --directory=$(git rev-parse --show-prefix) lastn-set-based.patch in the scratch copy, then mvn -q -B test", "expected": "exit 0 (29 tests: 25 existing + 4 new), 'LASTN_QUERY_COUNT subjects=20 statements=1'"},
    {"name": "Helper flags the N+1 in the real log", "input": "node .claude/skills/performance-review/scripts/count-queries.mjs .claude/skills/performance-review/examples/lastn-fix/show-sql-before.log --from LASTN_BEGIN --to LASTN_QUERY_COUNT --fail-on-suspect; echo exit=$?", "expected": "'statements: 40  distinct shapes: 2', two lines ending '<-- N+1 suspect', exit=1"},
    {"name": "Helper is clean on the after log", "input": "node .claude/skills/performance-review/scripts/count-queries.mjs .claude/skills/performance-review/examples/lastn-fix/show-sql-after.log --from LASTN_BEGIN --to LASTN_QUERY_COUNT --fail-on-suspect; echo exit=$?", "expected": "'statements: 1  distinct shapes: 1', 'no N+1 suspects', exit=0"},
    {"name": "sample-app still carries the teaching defect", "input": "grep -c 'TEACHING-DEFECT(perf-n+1)' sample-app/src/main/java/org/example/fhir/service/ObservationService.java", "expected": "1"},
    {"name": "Review does not lead with a cache", "input": "The claude -p command in exampleInput", "expected": "PERF-001 recommends the set-based query and the cap; no @Cacheable or second-level cache as the primary fix"}
   ],
   "evaluationCriteria": [
    "Every high finding carries a measured number or the exact command to obtain it.",
    "The fix keeps behaviour: latest per subject, code filter, unknown subjects skipped, lastnReturnsMostRecentObservationPerSubject still passes, and the discovered defects D-02 and D-03 in sample-app/docs/KNOWN_DEFECTS.md are neither fixed nor worsened (they get their own changes).",
    "The patch is applied only in a scratch copy; AI-SDLC/sample-app is unchanged.",
    "Index proposals go into a new V2__ migration, never into V1__init.sql.",
    "count-queries.mjs never prints bind values or row contents."
   ],
   "improvements": [
    "Add a V2__ migration with (patient_id, effective_date_time DESC) and compare EXPLAIN (ANALYZE, BUFFERS) on PostgreSQL with 500 synthetic patients x 400 observations.",
    "Turn LastnQueryCountTest into a parameterised test (1, 20, 100 subjects) asserting a constant count.",
    "Run count-queries.mjs --fail-on-suspect over the whole test suite's show-sql output in CI.",
    "Offer POST /fhir/Observation/$lastn with a JSON body for batches, removing the URL-length limit."
   ]},
  {"id": "04-production-rca-incident",
   "title": "Build production-rca and analyse the $lastn onboarding incident",
   "objective": "Create a production-rca skill with an RCA template and a timeline builder that guards against PHI, then run it on the synthetic INC-2026-0922-01 evidence pack. The RCA must reject bad deploy, database degradation, OOM and ingress hypotheses with evidence, identify the N+1 in ObservationService.lastN plus the missing subject cap as root cause, name CHG-4472 as the trigger, and propose mechanisms, not intentions, as preventive actions.",
   "startingFiles": [
    {"path": EV + p, "content": f(EV + p)} for p in ["incident-brief.md", "changes.md", "app-logs.log", "ingress-access.log", "k8s-events.txt", "pod-describe.txt", "rollout-history.txt", "metrics.md"]
   ],
   "requiredStructure": "AI-SDLC/.claude/skills/production-rca/\n├── SKILL.md                          # guard, read-only cluster access, analysis order, reasoning rules\n├── rca-template.md                   # 11 sections incl. clinical safety and PHI exposure\n├── scripts/\n│   └── build-timeline.mjs            # UTC merge with file:line refs; PHI guard exit 3\n└── examples/INC-2026-0922-lastn/     # starting files: the evidence pack (8 files)",
   "implementation": [
    {"path": RC + "SKILL.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": RC + "rca-template.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": RC + "scripts/build-timeline.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC\nnode .claude/skills/production-rca/scripts/build-timeline.mjs .claude/skills/production-rca/examples/INC-2026-0922-lastn/*.log .claude/skills/production-rca/examples/INC-2026-0922-lastn/*.txt .claude/skills/production-rca/examples/INC-2026-0922-lastn/*.md --collapse | sed -n '1,16p'\n\nclaude -p \"/production-rca .claude/skills/production-rca/examples/INC-2026-0922-lastn INC-2026-0922-01\" --permission-mode plan --output-format json | jq -r '.result' | tee /tmp/rca.md",
   "expectedOutput": "| # | time (UTC) | source | event | ref |\n|---|---|---|---|---|\n| 1 | 2026-09-22 06:30:00 | changes.md | \\| CHG-4471 \\| to 2026-09-22T07:41:00Z \\| clinical data platform \\| Historical import for Clinic C-017 onboarding: 512 patients, 208,896 observations (average 408 per patient, up to... | changes.md:5 |\n(rows 2 to 7 omitted)\n| 8 | 2026-09-22 08:00:41 | app-logs.log (q9m4t) | INFO 1 AUDIT : action=SEARCH resource=Observation results=512 user=clinician | app-logs.log:4 |\n(rows 9 to 13 omitted)\n| 14 | 2026-09-22 08:02:14 | app-logs.log (k2x7p) | WARN 1 com.zaxxer.hikari.pool.HikariPool : HikariPool-1 - Thread starvation or clock leap detected (housekeeper delta=41s512ms). | app-logs.log:8 |\nbuild-timeline: 86 events from 8 file(s)\n\n## 6. Root-cause candidates\n| # | hypothesis | evidence for | evidence against | verdict |\n|---|---|---|---|---|\n| H1 | Bad deploy or config change | none | rollout-history.txt: no rollout since 2026-09-18, same image fhir-lite-api:0.1.0 | rejected |\n| H3 | Memory leak or OOM kill | working set 757Mi of 768Mi | pod-describe.txt: Reason: Error, Exit Code: 137 (SIGKILL after liveness failure), no OOMKilled | rejected as cause; GC stalls contribute |\n| H5 | N+1 in $lastn x 512 subjects x deep history | pg_stat_statements: 431,616 calls = 843 x 512, 408 rows per call; AUDIT results=512; recovery when the dashboard stopped | none | confirmed |\n\n## 7. Root cause\n- Trigger: CHG-4472 (dashboard go-live), on top of CHG-4471 (history import).\n- Root cause: ObservationService.lastN (sample-app/src/main/java/org/example/fhir/service/ObservationService.java:69-74) issues two queries per subject and loads full histories, and ObservationController.java:43 accepts any number of subjects.\n- Contributing: probes with timeout=1s on the traffic connector, HikariCP 30 s connection timeout, no application metrics (include: health,info), load test with 20 patients x 2 observations, shared clinician account.",
   "testCases": [
    {"name": "Evidence pack is PHI-free and merges cleanly", "input": "Golden case rca-06 in skills/production-rca/tests/cases.json", "expected": "exit 0, stderr 'build-timeline: 86 events from 8 file(s)', first row is CHG-4471 at 06:30:00"},
    {"name": "PHI guard stops the analysis", "input": "printf '2026-10-11T09:14:03Z INFO lookup MRN-483920\\n' > /tmp/rca07.log && node .claude/skills/production-rca/scripts/build-timeline.mjs /tmp/rca07.log; echo exit=$?", "expected": "stderr lists 'rca07.log:1: MRN value' without the value; nothing on stdout; exit=3"},
    {"name": "Exit code 137 is not read as OOM", "input": "grep -n 'OOM' /tmp/rca.md", "expected": "OOM appears only as a rejected candidate citing 'Reason: Error' from pod-describe.txt"},
    {"name": "All template sections present", "input": "grep -cE '^## (1|2|3|4|5|6|7|8|9|10|11)\\. ' /tmp/rca.md", "expected": "11"},
    {"name": "Negative control: OOMKilled variant", "input": "Golden case rca-02 (write its files to /tmp/rca-02, run the invoke command)", "expected": "Root cause names OOMKilled and the MaxRAMPercentage=90 change; the N+1 is not blamed"},
    {"name": "Preventive actions are mechanisms", "input": "Read section 9 of the RCA", "expected": "Each row names a test, limit, probe setting, alert, gate or credential change with an owner role; none says 'be careful' or 'monitor more closely'"}
   ],
   "evaluationCriteria": [
    "Every causal link in section 7 cites an evidence id or file:line.",
    "At least four candidates, each with evidence for and against.",
    "Numbers are cross-checked between sources (pg_stat_statements vs AUDIT vs change calendar).",
    "Impact covers clinical safety, data integrity and PHI exposure, each with how it was checked.",
    "Blameless: changes and missing controls are named, people are not.",
    "Output is a handoff with status needs-human."
   ],
   "improvements": [
    "Add a --metrics mode to build-timeline.mjs that reads the Markdown metrics table and marks threshold crossings as timeline events.",
    "Link the incident workflow (module 08-workflow-orchestration) so the orchestrator runs performance-review on the code location the RCA names.",
    "Collect GC logs (-Xlog:gc*) in the Deployment so the next RCA can measure pause times instead of inferring them from HikariCP.",
    "Add a runbook under docs/ for the first 15 minutes of a $lastn-style overload: identify the client by user agent, throttle, then scale."
   ]},
  {"id": "04-skill-assets-golden-cases",
   "title": "Version the three skills as assets with golden cases",
   "objective": "Give each skill an asset folder with README (owner, version, who preloads it), CHANGELOG at 1.0.0 recording what was and was not verified, at least five golden cases mixing deterministic checks of the instruments and live checks of the procedure (including negative controls), and an answer key stored outside the skill's runtime folder. Run every deterministic case and record the result.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC/skills/\n├── security-review/\n│   ├── README.md  CHANGELOG.md\n│   └── tests/cases.json  tests/expected/sample-app-report.json  tests/expected/sample-app-report.md\n├── performance-review/\n│   ├── README.md  CHANGELOG.md\n│   └── tests/cases.json  tests/expected/sample-app-findings.md\n└── production-rca/\n    ├── README.md  CHANGELOG.md\n    └── tests/cases.json  tests/expected/INC-2026-0922-01-rca.md",
   "implementation": [
    {"path": "AI-SDLC/skills/" + s + "/" + p, "language": ("json" if p.endswith(".json") else "markdown"), "content": "", "tag": "illustrative"}
    for s, ps in [
     ("security-review", ["README.md", "CHANGELOG.md", "tests/cases.json", "tests/expected/sample-app-report.json", "tests/expected/sample-app-report.md"]),
     ("performance-review", ["README.md", "CHANGELOG.md", "tests/cases.json", "tests/expected/sample-app-findings.md"]),
     ("production-rca", ["README.md", "CHANGELOG.md", "tests/cases.json", "tests/expected/INC-2026-0922-01-rca.md"])]
    for p in ps
   ],
   "exampleInput": "cd AI-SDLC\nnode --input-type=module <<'EOF'\nimport { spawnSync } from \"node:child_process\";\nimport { readFileSync } from \"node:fs\";\nlet failed = 0;\nfor (const skill of [\"security-review\", \"performance-review\", \"production-rca\"]) {\n  const doc = JSON.parse(readFileSync(`skills/${skill}/tests/cases.json`, \"utf8\"));\n  const live = doc.cases.filter((c) => c.kind === \"live\").length;\n  for (const c of doc.cases.filter((c) => c.kind === \"deterministic\")) {\n    const r = spawnSync(\"bash\", [\"-c\", c.input.command], { encoding: \"utf8\" });\n    const e = c.expect;\n    const problems = [];\n    if (e.exitCode !== undefined && r.status !== e.exitCode) problems.push(`exit ${r.status} != ${e.exitCode}`);\n    for (const s of e.stdoutContains || []) if (!r.stdout.includes(s)) problems.push(`stdout lacks ${JSON.stringify(s)}`);\n    for (const s of e.stderrContains || []) if (!r.stderr.includes(s)) problems.push(`stderr lacks ${JSON.stringify(s)}`);\n    for (const s of e.mustNotContain || []) if ((r.stdout + r.stderr).includes(s)) problems.push(`output contains ${JSON.stringify(s)}`);\n    if (problems.length) failed++;\n    console.log(`${problems.length ? \"FAIL\" : \"PASS\"}  ${skill}  ${c.id}${problems.length ? \"  \" + problems.join(\"; \") : \"\"}`);\n  }\n  console.log(`      ${skill}: ${live} live case(s) need a model run`);\n}\nprocess.exit(failed ? 1 : 0);\nEOF",
   "expectedOutput": "PASS  security-review  sec-08-renderer-rejects-real-mrn\nPASS  security-review  sec-09-renderer-gate\n      security-review: 7 live case(s) need a model run\nPASS  performance-review  perf-06-helper-before-log\nPASS  performance-review  perf-07-helper-after-log\nPASS  performance-review  perf-08-helper-json\n      performance-review: 5 live case(s) need a model run\nPASS  production-rca  rca-06-timeline-pack\nPASS  production-rca  rca-07-timeline-phi-guard\nPASS  production-rca  rca-08-timeline-window\n      production-rca: 5 live case(s) need a model run",
   "testCases": [
    {"name": "At least five cases per skill", "input": "for s in security-review performance-review production-rca; do node -e \"console.log('$s', require('./skills/$s/tests/cases.json').cases.length)\"; done", "expected": "security-review 9\nperformance-review 8\nproduction-rca 8"},
    {"name": "Every case has id, kind, input and expect", "input": "node -e \"for (const s of ['security-review','performance-review','production-rca']) for (const c of require('./skills/'+s+'/tests/cases.json').cases) if (!c.id || !['live','deterministic'].includes(c.kind) || !c.input || !c.expect) console.log('bad', s, c.id)\"", "expected": "No output"},
    {"name": "Deterministic cases pass", "input": "The exampleInput runner", "expected": "8 PASS lines, exit code 0"},
    {"name": "Answer keys are outside the runtime folder", "input": "grep -rlE 'SEC-006|PERF-004|843 requests' .claude/skills/ || echo none", "expected": "none"},
    {"name": "CHANGELOG states version and verification", "input": "grep -h '^## \\[1.0.0\\]' skills/{security-review,performance-review,production-rca}/CHANGELOG.md | wc -l; grep -l 'Not yet verified' skills/{security-review,performance-review,production-rca}/CHANGELOG.md | wc -l", "expected": "3\n3"},
    {"name": "Negative controls exist", "input": "node -e \"const c=require('./skills/security-review/tests/cases.json').cases.find(c=>c.id==='sec-07-docs-only-diff'); console.log(c.expect.verdict)\"", "expected": "pass"}
   ],
   "evaluationCriteria": [
    "Each README names owner, version, runtime location, the agent that preloads the skill and the invocation.",
    "Each CHANGELOG separates what was verified (with numbers) from what still needs a model run.",
    "Live cases include at least one negative control per skill.",
    "Golden inputs use synthetic data only; any MRN is MRN-000xxx or a deliberately invalid value used to test a guard.",
    "The answer key is not reachable from the skill's own folder."
   ],
   "improvements": [
    "Feed these cases into the eval harness from module 09-agent-evaluation and track the live pass rate per skill version.",
    "Add a cost column (total_cost_usd from claude -p --output-format json) to each live case run.",
    "Package the three skills as a plugin in the company skill library (module 10-governance) with the asset folders as its docs."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`.claude/skills/security-review/SKILL.md`, `performance-review/SKILL.md` and `production-rca/SKILL.md` use only documented frontmatter keys and none sets `disable-model-invocation` (the agents preload them).",
  "Inside `AI-SDLC/`, `/security-review` runs the project skill, not the bundled command.",
  "`render-report.mjs` exits 1 on the answer key with `--fail-on high` and 2 on an invalid or inconsistent report.",
  "The security review of the unmodified app reports the given-name PHI-in-logs path through `GlobalExceptionHandler.java:71` as high and has no injection finding.",
  "`LastnQueryCountTest` shows 40 statements for 20 subjects on the shipped app and 1 after `lastn-set-based.patch` in a scratch copy, with 29 tests passing.",
  "`AI-SDLC/sample-app` is unchanged and still contains `TEACHING-DEFECT(perf-n+1)`.",
  "`build-timeline.mjs` merges the eight evidence files (86 events) and exits 3 on PHI-like input without printing it.",
  "The RCA rejects bad deploy, database degradation, OOM and ingress with evidence and cites file:line for every causal link.",
  "Each skill has README, CHANGELOG (1.0.0) and at least five golden cases; all eight deterministic cases pass.",
  "Answer keys live under `AI-SDLC/skills/<name>/tests/expected/`, not under `.claude/skills/`."
 ]
}

for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content/modules/04-skills-security-performance-rca.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
