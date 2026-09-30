# Generator for content-frappe/modules/04-skills-security-performance-rca.json (Frappe edition, writer F4).
# Run: python3 build/sources-frappe/04-skills-security-performance-rca.py
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
def f(p): return (ROOT / p).read_text()
R = "AI-SDLC-frappe/"
SR = R + ".claude/skills/security-review/"
PR = R + ".claude/skills/performance-review/"
RC = R + ".claude/skills/production-rca/"
PACK = RC + "examples/INC-2026-0922-lastn/"
A = R + "skills/"

def impl(path, language, tag="illustrative"):
    return {"path": path, "language": language, "content": "", "tag": tag}

mod = {
 "id": "04-skills-security-performance-rca",
 "level": 3,
 "title": "Production Skills on Frappe: Security Review, Performance Review and Production RCA",
 "summary": "Build the three skills the security and sre agents depend on, for a Frappe v15 clinical app on PostgreSQL 16: a PHI-first security-review that knows what get_all, permission_query_conditions, Error Log tracebacks and track_changes really do and proves its findings with probes on the bench; a measure-first performance-review that shows the lastn N+1 (200 queries for 100 subjects) and a permission-aware patch that makes it 3; and a production-rca skill that turns a synthetic country-site incident (nginx, gunicorn, RQ, Redis, Error Log, Postgres slow log) into a cited, blameless RCA. Each ships with instruments, tests, and an asset folder with golden cases.",
 "prerequisites": [
  "03-skills-architecture-code-test",
  "A bench with the spice_lite test site: `bench --site test.localhost run-tests --app spice_lite` passes (46 tests)",
  "Node 22 (the helper scripts have no dependencies)",
  "Claude Code CLI authenticated, for the live `claude -p` steps"
 ],
 "concepts": [
  {"heading": "A production skill is a procedure plus instruments",
   "body_md": "A skill that only says \"check for N+1 queries and PHI leaks\" produces opinions. The three skills in this module each pair a **procedure** (`SKILL.md`: scope, order of work, severity scale, output contract) with **instruments** that turn a claim into something checkable:\n\n| Skill | Procedure decides | Instruments |\n|---|---|---|\n| `security-review` | ten categories, Frappe facts, severity for PHI | `report.schema.json`, `render-report.mjs` (validate, gate), `probes/test_security_probes.py` |\n| `performance-review` | measure first, nine areas, fix shape | `test_lastn_query_count.py`, `count-queries.mjs`, `lastn-set-based.patch` |\n| `production-rca` | guard evidence, candidates, causal chain | `build-timeline.mjs` (UTC merge, PHI guard), `rca-template.md`, an evidence pack |\n\nThe instruments are plain code you can run without a model. That matters twice. First, the agent using the skill gets a deterministic answer to the questions a model is bad at (how many statements did this call issue, does this JSON match the schema, is there an MRN in this log). Second, you can test the skill itself: every script here has a `node --test` file, and the Frappe probes run under `bench run-tests`.\n\nKeep `SKILL.md` short and link the rest (Claude Code loads supporting files when the body points at them; keep the body under 500 lines). The agent reads `checklist.md` when it needs it, runs the scripts through `${CLAUDE_SKILL_DIR}`, and never has to paste 200 lines of Grep patterns into its context up front.\n\nSo in practice: when you write a skill, write the check that would catch the skill being wrong before you write the prose."},
  {"heading": "Frappe facts a security review must not guess",
   "body_md": "Most security mistakes in Frappe code come from a wrong mental model of the framework, so `security-review/SKILL.md` section 3 states the facts that decide findings, each verified in the v15 source on this bench:\n\n- **`frappe.get_all` is `get_list` with `ignore_permissions=True`.** It skips DocType permissions, User Permissions and `permission_query_conditions`. So do `frappe.qb`, `frappe.db.sql`, `frappe.db.get_value` and `frappe.db.exists`.\n- **`permission_query_conditions` applies to `get_list` only**, and a `has_permission` Frappe hook can only deny. A country app that restricts observations by facility through either hook is silently bypassed by any `get_all` in a request path.\n- **A 5xx copies request data into two sinks.** `frappe.app.handle_exception` calls `log_error_snapshot`: the Error Log stores `get_traceback(with_context=True)`, which prints **local variables**, and `frappe.logger(with_more_info=True)` appends `Form Dict: {...}` to `logs/frappe.log`. Only keys containing `password`, `secret`, `token`, `key`, `pwd` are masked.\n- **Postgres logs failed statements with their values**, because Frappe interpolates values before sending the query.\n- **`track_changes: 1` writes old and new values to `Version.data`** on every save.\n- **`allow_error_traceback` defaults to 1**, so error responses carry a traceback, also for guests.\n\nThe probes file turns each of these into a test against the real app. Probe 1 gives a Clinician a User Permission for one observation and shows `get_list` returns only it while `lastn` returns the other:\n\n```text\nPROBE SEC-PROBE-1 get_list=['SLO-00001'] has_permission(new)=False lastn_status=200 lastn_returned=['SLO-00002']\n```\n\nSo in practice: a finding that depends on framework behaviour cites the behaviour and, where possible, the probe that shows it."},
  {"heading": "Where PHI leaks on a Frappe site",
   "body_md": "spice_lite's own code is careful: `audit.log_access` logs document names only, the `SLP-.#####` series keeps MRNs out of names, and `search_patients` rejects LIKE wildcards. The review still finds three **high** PHI or permission issues, and none of them is a `log.info(patient.last_name)` line. They come from the platform around the code:\n\n1. **Error sinks.** `create_observation` catches `PermissionError` and `ValidationError`. A malformed `effective_datetime` string reaches `doc.insert()`, Postgres raises `InvalidDatetimeFormat` (a `DataError`), and the request becomes a 500. Probe 5: `value_in_error_log_traceback=True value_in_frappe_log_line=True`, and the Postgres server log shows the failed `INSERT` with the measurement value.\n2. **Access logs.** `search_patients` is `methods=[\"GET\"]`, so `family` and `identifier` (an MRN) travel in the query string. gunicorn with an access log and `bench serve` both print the full request line; bench's nginx template logs `$request` too.\n3. **Row-level permissions.** `lastn` reads observations with `frappe.get_all`, so any User Permission or `permission_query_conditions` on `SL Observation` is ignored (SEC-001, inside the teaching defect).\n\nLower down the list: `Version` holds PHI diffs (readable by System Manager only, so `low`), and a 403/404 difference lets a user enumerate which patient names exist.\n\nThe healthcare calibration of the scale: PHI returned to a user who may not read it is `critical`; a permission bypass or PHI in an internal sink (Error Log, access log, DB log) is `high`. SEC-001 is `high` and not `critical` because no User Permission or `permission_query_conditions` exists in spice_lite today. On a country site that restricts observations by facility, it discloses PHI.\n\nSo in practice: review the defaults of every sink a request can reach, not only the lines in the diff."},
  {"heading": "Measure before you fix: statements per request",
   "body_md": "The performance-review skill refuses a `high` finding without a number. For collection endpoints the number is **SQL statements per request at two input sizes**: constant is fine, linear is an N+1.\n\nOn spice_lite the instrument is `test_lastn_query_count.py`, a `FrappeTestCase` that wraps `frappe.db.sql`, creates 100 synthetic patients with 4 matching observations each (rolled back at class end), and prints:\n\n```text\nLASTN_QUERY_COUNT subjects=1 queries=2 rows_returned_by_sql=5\nLASTN_QUERY_COUNT subjects=20 queries=40 rows_returned_by_sql=100\nLASTN_QUERY_COUNT subjects=100 queries=200 rows_returned_by_sql=500\n```\n\nTwo statements per subject: `frappe.get_doc(\"SL Patient\", s)` and `frappe.get_all(\"SL Observation\", ..., fields=[\"*\"])` that returns every matching observation to keep `rows[0]`. `count-queries.mjs` reads the captured statements (or a Postgres slow log) and shows two shapes repeated 20 times each, with literals masked.\n\nThe fix, `lastn-set-based.patch`, stays **permission-aware**: one `frappe.get_list(\"SL Patient\", filters={\"name\": (\"in\", subjects)}, pluck=\"name\")`, one `get_list` for `max(effective_datetime)` grouped by patient, and one for only the rows at those timestamps. After it: 3 statements for 1, 20 or 100 subjects, 3 rows per subject, the full suite at 49 tests OK on Postgres, and the same numbers on MariaDB. Security probes 1 and 2 stop reproducing, so the same patch closes SEC-001.\n\nOne Frappe v15 trap: `FrappeTestCase.assertQueryCount` crashes on Postgres (`TypeError: ... LazyDecode found`, KNOWN_DEFECTS.md D-10) even under the limit, because it joins `LazyDecode` objects into its failure message eagerly. The proof therefore uses the test's own counter, and the file carries a small `PostgresQueryCountMixin` that makes `assertQueryCount` usable as a second check.\n\nSo in practice: do not reach for `frappe.cache` or `frappe.qb` first. A cache hides the N+1 until it misses; `qb` and raw SQL drop permissions."},
  {"heading": "RCA on a Frappe deployment is evidence discipline",
   "body_md": "The production-rca skill analyses `INC-2026-0922-01`: a synthetic Kenya country site where 20 new ward tablets call `lastn` with 100 subjects every 30 seconds, right after a historical import gave each of those patients about 423 heart-rate readings. The pack has nine files from the places a Frappe incident leaves traces: nginx access log, gunicorn `web.error.log`, RQ `worker.log`, `LLEN rq:queue:<bench_id>:default` samples, an Error Log export, the Postgres slow-query log, metrics, the change calendar and the brief.\n\nThe skill's order is fixed: **guard the evidence** (`build-timeline.mjs` exits 3 on MRNs, `Form Dict` dumps, PHI query parameters, API tokens), **build a UTC timeline**, list **symptoms**, weigh at least five **candidates**, then state the **causal chain** with a citation per link.\n\nThe pack contains the traps real Frappe incidents contain:\n\n- gunicorn prints `Worker (pid:2248) was sent SIGKILL! Perhaps out of memory?` for **every** SIGKILL. Each one follows `WORKER TIMEOUT (pid:2248)` by a second: the arbiter's SIGABRT-then-SIGKILL sequence for a stuck worker. Host memory peaked at 58%, and the kernel log has no OOM.\n- Error Log `creation` is naive **site-local** time (+03:00). Without `--offset error-log.txt=+03:00` the first job timeout lands at 11:10 UTC, three hours after the incident.\n- The RQ `default` backlog (0 to 81) is a symptom: jobs share the saturated database.\n- The only deploy (spice_telephony 1.8.0) was rolled back at 08:20 with no effect.\n- Requests killed by `WORKER TIMEOUT` never reach `handle_exception`, so the endpoint that caused it has **no Error Log rows**.\n\nSo in practice: every candidate is rejected with evidence against it, never because another one looks better."},
  {"heading": "Skills as versioned engineering assets",
   "body_md": "The runtime folder (`.claude/skills/<name>/`) is what Claude Code loads. The asset folder (`skills/<name>/`) is what your team maintains: `README.md` (owner, version, who preloads it, how to invoke it headless), `CHANGELOG.md` (what was verified, on which Frappe and Postgres version, and what was not), and `tests/` with golden cases and answer keys.\n\nGolden cases come in three kinds here:\n\n| Kind | Needs | Example |\n|---|---|---|\n| `deterministic` | Node only | `node --test skills/production-rca/tests/build-timeline.test.mjs` (7 pass) |\n| `bench` | the bench and the shared lock | the probes (`Ran 7 tests ... OK`) and the lastn apply, test, revert run |\n| `live` | a model (`claude -p`) | `/security-review sample-app/` must find SEC-001 and must not report injection |\n\nEvery skill has **negative controls**: a docstring-only diff must produce no finding above `low`; with the lastn patch applied, performance-review must not report an N+1 in `lastn`; with a real kernel OOM log added to the pack, the RCA must move memory from rejected to contributing. A skill that finds problems everywhere is as useless as one that finds none.\n\nAnswer keys live under `skills/<name>/tests/expected/`, **outside** the runtime folder, so an agent running the skill cannot read the expected output. Patches in live cases that add a defect are labelled `EXERCISE-INTRODUCED`; spice_lite's own defects stay listed in `sample-app/docs/KNOWN_DEFECTS.md`.\n\nSo in practice: bump the version and re-run the cases whenever `SKILL.md`, a checklist or a guard rule changes, and after every Frappe upgrade, since several findings depend on Frappe defaults."}
 ],
 "diagrams": [
  {"title": "security-review: from invocation to merge gate",
   "mermaid": "sequenceDiagram\n  participant H as Human or orchestrator\n  participant C as claude -p (security agent)\n  participant S as security-review skill\n  participant B as bench probes (tester or human)\n  participant R as render-report.mjs\n  H->>C: /security-review sample-app/ --json-schema report.schema.json\n  C->>S: load SKILL.md, inject git diff --stat and the whitelist inventory\n  S->>C: checklist.md, Frappe facts, PHI table\n  C->>C: Grep and Read across ten categories\n  C-->>H: JSON report (verifiedBy names a probe)\n  H->>B: run probes/test_security_probes.py under the lock\n  B-->>H: PROBE lines confirm SEC-001, SEC-002, SEC-006, SEC-008\n  H->>R: report.json --fail-on high\n  R-->>H: exit 2 invalid schema, counts, MRN, token or Form Dict\n  R-->>H: exit 1 high or critical present, block merge\n  R-->>H: exit 0 Markdown report"},
  {"title": "performance-review: measure, fix, prove, revert",
   "mermaid": "flowchart LR\n  A[\"Copy test_lastn_query_count.py into tests/\"] --> B[\"run-tests: 2, 40, 200 statements\"]\n  B --> C[\"count-queries.mjs: 2 shapes x20, N+1 suspect\"]\n  C --> D[\"git apply lastn-set-based.patch\"]\n  D --> E[\"run-tests: 3, 3, 3 statements\"]\n  E --> F[\"run-tests --app spice_lite: 49 OK\"]\n  F --> G[\"security probes 1 and 2 no longer reproduce\"]\n  G --> H[\"git checkout: sample-app unchanged\"]"},
  {"title": "INC-2026-0922-01 causal chain",
   "mermaid": "flowchart TD\n  T[\"CHG-5103: 20 tablets, lastn with 100 subjects every 30 s\"] --> Q[\"200 statements and about 42,300 rows per call\"]\n  P[\"CHG-5102: about 423 observations per patient\"] --> Q\n  RC[\"Root cause: lastn N+1 and full-history read (fhir.py:155-184)\"] --> Q\n  Q --> W[\"9 of 9 gunicorn sync workers busy by 08:02\"]\n  W --> N[\"nginx 504 at 120 s, 502 on killed workers, desk and login included\"]\n  Q --> DB[\"ke-db-1 CPU 71 to 88 percent\"]\n  DB --> J[\"reminder job exceeds 300 s, default queue backlog to 81\"]\n  X1[\"spice_telephony deploy\"] -. \"rejected: rollback changed nothing\" .-> N\n  X2[\"OOM\"] -. \"rejected: SIGKILL follows WORKER TIMEOUT, memory 58 percent\" .-> N\n  X3[\"Redis failure\"] -. \"rejected: memory flat, drained without action\" .-> J"}
 ],
 "comparisonTables": [
  {"title": "The three skills side by side",
   "columns": ["", "security-review", "performance-review", "production-rca"],
   "rows": [
    ["Preloaded by", "`security`", "`sre`", "`sre`"],
    ["Input", "diff, path or git range", "diff, path or whitelisted method", "evidence directory and incident id"],
    ["Output", "JSON report (schema 1.0) plus Markdown", "findings, measurements, fix, checked clean", "11-section RCA, `status: needs-human`"],
    ["Deterministic instrument", "`render-report.mjs` (exit 0/1/2)", "`count-queries.mjs`, query-count test", "`build-timeline.mjs` (exit 0/2/3)"],
    ["Bench evidence", "7 probes, gunicorn access-log run", "2/40/200 before, 3/3/3 after, 49 OK", "numbers consistent with the measured lastn cost"],
    ["Frappe trap it encodes", "`get_all` skips permissions; 5xx copies locals and Form Dict", "`assertQueryCount` crashes on Postgres; `search_index` name collision", "`Perhaps out of memory?` on every SIGKILL; Error Log in site time"],
    ["Negative control", "docstring-only diff: nothing above low", "patched lastn: no N+1", "kernel OOM log: memory becomes contributing"]
   ]},
  {"title": "Discriminating evidence for the RCA candidates",
   "columns": ["Hypothesis", "Would predict", "Observed", "Verdict"],
   "rows": [
    ["spice_telephony 1.8.0 deploy", "degradation from 07:41; rollback fixes it", "healthy 07:41 to 08:00; rollback at 08:20 changed nothing", "rejected"],
    ["Database degradation", "many statement shapes slow; lock waits; no recovery without DB action", "one shape (the lastn per-subject query) 100x more frequent; no lock waits; recovered when tablets stopped", "rejected"],
    ["Memory exhaustion (OOM)", "kernel oom-kill lines; memory near limit", "`SIGKILL! Perhaps out of memory?` always one second after `WORKER TIMEOUT` for the same pid; memory peak 58%; no kernel OOM", "rejected"],
    ["Queue or Redis failure", "Redis errors or memory pressure; all queues affected", "only `default` backed up; Redis 3.1 to 3.8 MB; drained without action", "rejected (symptom)"],
    ["Traffic and data change plus the lastn cost model", "load starts at 08:00 with 100-subject calls; stops when they stop", "first slow call 08:00:31 from the tablets; 118,400 per-subject queries in 31 min; recovery at 08:31", "confirmed"]
   ]}
 ],
 "exercises": [
  {"id": "04-security-review-skill",
   "title": "Build security-review for Frappe and prove its findings on the bench",
   "objective": "Replace the bundled /security-review inside AI-SDLC-frappe with a project skill that covers authN/authZ (whitelist, allow_guest, methods), DocType permissions, permission_query_conditions and has_permission Frappe hooks, ignore_permissions, get_all vs get_list, input validation, site_config and API-key secrets, PHI in logger, Error Log, Version and frappe.throw, SQL injection through frappe.db.sql, API security, dependencies and logging. It returns a JSON report valid against a schema, rendered by a script that can fail a CI step. Run it on the unmodified app, then confirm each high finding with the probes under the bench lock.",
   "startingFiles": [
    {"path": SR + "SKILL.md", "content": "---\nname: security-review\ndescription: Security review.\n---\n\nReview the code for security problems and list them.\n"}
   ],
   "requiredStructure": "AI-SDLC-frappe/.claude/skills/security-review/\n├── SKILL.md                      # name, description, when_to_use, argument-hint, allowed-tools; ! injections\n├── checklist.md                  # ten categories, Grep patterns, Frappe behaviour per pattern\n├── report.schema.json            # schemaVersion 1.0, severity critical..info, optional verifiedBy\n├── scripts/\n│   └── render-report.mjs         # validate, counts, verdict, MRN/token/Form Dict guard, --fail-on (exit 0/1/2)\n├── examples/\n│   └── example-report.json       # one-finding format example (not the answer key)\n└── probes/\n    ├── test_security_probes.py   # 7 FrappeTestCase probes, copied into tests/ for one run\n    └── RUN.md                    # one-shot commands, recorded output, access-log check",
   "implementation": [
    impl(SR + "SKILL.md", "markdown", "verified-format"),
    impl(SR + "checklist.md", "markdown"),
    impl(SR + "report.schema.json", "json"),
    impl(SR + "scripts/render-report.mjs", "javascript"),
    impl(SR + "examples/example-report.json", "json"),
    impl(SR + "probes/test_security_probes.py", "python"),
    impl(SR + "probes/RUN.md", "markdown")
   ],
   "exampleInput": "cd AI-SDLC-frappe\nclaude -p \"/security-review sample-app/\" --permission-mode plan --output-format json \\\n  --json-schema \"$(cat .claude/skills/security-review/report.schema.json)\" \\\n  | jq '.structured_output' > /tmp/security-report.json\nnode .claude/skills/security-review/scripts/render-report.mjs /tmp/security-report.json --fail-on high; echo \"exit=$?\"",
   "expectedOutput": "# Security review: sample-app/ (spice_lite, unmodified)\n\n- Mode: path (ref HEAD)\n- Verdict: **block**\n- Findings: critical 0, high 3, medium 2, low 5, info 1\n\n## Findings\n\n| id | severity | category | location | title | PHI |\n|---|---|---|---|---|---|\n| SEC-001 | high | authz | `sample-app/spice_lite/spice_lite/api/fhir.py:177-182` | lastn() reads SL Observation with frappe.get_all, so row-level permissions are ignored | yes |\n| SEC-002 | high | phi | `sample-app/spice_lite/spice_lite/api/fhir.py:124-133` | A malformed effective_datetime makes create_observation fail with a 500 that copies the request values into Error Log, frappe.log and the Postgres log | yes |\n| SEC-003 | high | phi | `sample-app/spice_lite/spice_lite/api/fhir.py:63-64` | search_patients takes family and identifier (MRN) in a GET query string, which web access logs record | yes |\n| SEC-004 | medium | api-security | `sample-app/spice_lite/spice_lite/install.py:17-18` | Error responses include a full Python traceback, also for guests, because allow_error_traceback is on | no |\n| SEC-005 | medium | api-security | `sample-app/spice_lite/spice_lite/api/fhir.py:149-150` | lastn accepts 100 subjects per call and costs 2 queries per subject | no |\n| SEC-006 | low | api-security | `sample-app/spice_lite/spice_lite/api/fhir.py:52-57` | get_patient answers 404 for missing and 403 for forbidden documents, so names outside the user's permissions can be enumerated | no |\n| SEC-007 | low | logging-audit | `sample-app/spice_lite/spice_lite/api/fhir.py:44-45` | Refused requests (403) are not recorded in the audit log | no |\n| SEC-008 | low | phi | `sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json:106` | track_changes copies PHI into Version.data on every SL Patient save | yes |\n(finding details, checked clean: authn, authz, injection, input-validation, secrets, infrastructure)\nrender-report: 3 finding(s) at or above high: SEC-001, SEC-002, SEC-003\nexit=1\n\nThen, under the bench lock (probes/RUN.md):\nRan 7 tests in 2.312s\nOK\nPROBE SEC-PROBE-1 get_list=['SLO-00001'] has_permission(new)=False lastn_status=200 lastn_returned=['SLO-00002'] hidden=SLO-00002\nPROBE SEC-PROBE-5 error=InvalidDatetimeFormat value_in_error_log_traceback=True value_in_frappe_log_line=True traceback_has_locals=True",
   "testCases": [
    {"name": "Renderer accepts the answer key and gates on high", "input": "node .claude/skills/security-review/scripts/render-report.mjs skills/security-review/tests/expected/sample-app-report.json --fail-on high > /dev/null; echo exit=$?", "expected": "stderr 'render-report: 3 finding(s) at or above high: SEC-001, SEC-002, SEC-003', exit=1"},
    {"name": "Renderer guards against PHI and tokens", "input": "node --test skills/security-review/tests/render-report.test.mjs", "expected": "# pass 7, # fail 0 (includes: a non-synthetic MRN, an unredacted Form Dict and an api_key:api_secret pair each give exit 2)"},
    {"name": "The get_all bypass is real", "input": "Run the probes as in probes/RUN.md and read the SEC-PROBE-1 and SEC-PROBE-2 lines", "expected": "get_list=['SLO-...'] with one name, has_permission(new)=False, and lastn_returned lists the other (hidden) name; SEC-PROBE-2 get_list=[] while lastn_returned has one observation"},
    {"name": "The Error Log path is real", "input": "Same probe run, SEC-PROBE-5 line; then grep 'not-a-datetime' /var/log/postgresql/postgresql-16-main.log | tail -1", "expected": "error=InvalidDatetimeFormat value_in_error_log_traceback=True value_in_frappe_log_line=True; the Postgres log line is the failed INSERT INTO \"tabSL Observation\" with the synthetic value 187.25"},
    {"name": "Live review: key findings and no injection", "input": "Golden case sec-01 in skills/security-review/tests/cases.json", "expected": "verdict block; an authz finding at api/fhir.py:177 citing frappe.get_all; two high phi findings in api/fhir.py; no injection finding; injection and authn in checkedClean"},
    {"name": "Project skill replaces the bundled one", "input": "cd AI-SDLC-frappe && claude -p \"/security-review diff\" --permission-mode plan --output-format json | jq -r .result | head -3", "expected": "Output follows report.schema.json (report, schemaVersion 1.0, scope ...), not the bundled command's free-form review"},
    {"name": "sample-app is untouched after the probes", "input": "git status --short AI-SDLC-frappe/sample-app", "expected": "No output"}
   ],
   "evaluationCriteria": [
    "All ten categories are either in findings or in checkedClean with concrete evidence.",
    "Every high finding quotes code or probe output and cites path:line relative to AI-SDLC-frappe/.",
    "Framework claims match build/FRAPPE_FACTS.md (get_all, permission_query_conditions, has_permission, methods gives 403).",
    "No PHI or token in the report: patient values are [REDACTED] or synthetic MRN-000xxx.",
    "Frontmatter uses only documented skill keys and stays preloadable (no disable-model-invocation); both ! injections are pre-approved in allowed-tools.",
    "The probes leave no data and no file behind (rolled back, file deleted in the same lock)."
   ],
   "improvements": [
    "Add a probe for `permission_query_conditions` on `frappe.get_all` in other request paths as soon as a country app ships one, and keep it as a regression test.",
    "Add a `sarif` output mode to render-report.mjs so findings appear as code-scanning alerts on the PR.",
    "Add a scheduled job (country app) that counts Error Log rows whose traceback contains a PHI field name, and alerts.",
    "Extend the guard with a machine-readable list of PHI fields generated from the DocType JSON."
   ]},
  {"id": "04-performance-review-lastn",
   "title": "Build performance-review and prove the lastn fix with a query count",
   "objective": "Create a performance-review skill that measures before it recommends, a zero-dependency statement-log parser, and a query-count test. Use them to prove TEACHING-DEFECT(perf-n+1) in lastn (2 queries per subject: 200 for 100 subjects), write a permission-aware set-based patch, apply it under the bench lock, show 3 queries for any number of subjects with the full suite green, and revert so sample-app keeps the defect.",
   "startingFiles": [
    {"path": PR + "examples/lastn-fix/test_lastn_query_count.py", "content": f(PR + "examples/lastn-fix/test_lastn_query_count.py")}
   ],
   "requiredStructure": "AI-SDLC-frappe/.claude/skills/performance-review/\n├── SKILL.md                          # measure-first procedure, severity, output format\n├── checklist.md                      # queries, indexes, n+1, caching, latency, concurrency, memory, cpu, network\n├── scripts/\n│   └── count-queries.mjs             # SQL: lines or Postgres log -> shapes, durations, N+1 suspects\n└── examples/lastn-fix/\n    ├── test_lastn_query_count.py     # starting file: own counter + assertQueryCount (PostgresQueryCountMixin)\n    ├── lastn-set-based.patch         # fhir.py, tests/test_fhir_api.py, tests/utils.py\n    ├── APPLY.md                      # apply, test, revert; recorded numbers\n    ├── sql-before.log                # 40 statements for 20 subjects (captured)\n    └── sql-after.log                 # 3 statements (captured)",
   "implementation": [
    impl(PR + "SKILL.md", "markdown", "verified-format"),
    impl(PR + "checklist.md", "markdown"),
    impl(PR + "scripts/count-queries.mjs", "javascript"),
    impl(PR + "examples/lastn-fix/test_lastn_query_count.py", "python"),
    impl(PR + "examples/lastn-fix/lastn-set-based.patch", "diff"),
    impl(PR + "examples/lastn-fix/APPLY.md", "markdown"),
    impl(PR + "examples/lastn-fix/sql-before.log", "plaintext"),
    impl(PR + "examples/lastn-fix/sql-after.log", "plaintext")
   ],
   "exampleInput": "# on the shared course bench, as root, from /home/user/artifacts/AI-SDLC-frappe:\nflock /tmp/spice-bench.lock bash -c '\n  APP=sample-app/spice_lite; EX=.claude/skills/performance-review/examples/lastn-fix\n  trap \"git checkout -- $APP/spice_lite/api/fhir.py $APP/spice_lite/tests/test_fhir_api.py $APP/spice_lite/tests/utils.py; rm -f $APP/spice_lite/tests/test_lastn_query_count.py\" EXIT\n  cp $EX/test_lastn_query_count.py $APP/spice_lite/tests/ && chown frappe:frappe $APP/spice_lite/tests/test_lastn_query_count.py\n  B=\"source ~/.spice-lite-bench-env && cd /home/user/frappe-bench && bench --site test.localhost run-tests\"\n  su - frappe -c \"$B --module spice_lite.tests.test_lastn_query_count\" 2>&1 | grep -E \"LASTN_QUERY_COUNT|^Ran|^OK|^FAILED|AssertionError\"\n  (cd $APP && git apply ../../$EX/lastn-set-based.patch)\n  su - frappe -c \"$B --module spice_lite.tests.test_lastn_query_count\" 2>&1 | grep -E \"LASTN_QUERY_COUNT|^Ran|^OK\"\n  su - frappe -c \"$B --app spice_lite\" 2>&1 | grep -E \"^Ran|^OK|^FAILED\"'\ngit status --short sample-app",
   "expectedOutput": "AssertionError: 200 not less than or equal to 6 : statements per call: {1: 2, 20: 40, 100: 200}\nRan 3 tests in 9.027s\nFAILED (failures=1)\nLASTN_QUERY_COUNT subjects=1 queries=2 rows_returned_by_sql=5\nLASTN_QUERY_COUNT subjects=20 queries=40 rows_returned_by_sql=100\nLASTN_QUERY_COUNT subjects=100 queries=200 rows_returned_by_sql=500\nRan 3 tests in 6.856s\nOK\nLASTN_QUERY_COUNT subjects=1 queries=3 rows_returned_by_sql=3\nLASTN_QUERY_COUNT subjects=20 queries=3 rows_returned_by_sql=60\nLASTN_QUERY_COUNT subjects=100 queries=3 rows_returned_by_sql=300\nRan 49 tests in 10.309s\nOK\n(git status prints nothing: the patch and the test file were reverted)",
   "testCases": [
    {"name": "Defect is measurable", "input": "The first run-tests in exampleInput (shipped app)", "expected": "FAILED (failures=1) with 'statements per call: {1: 2, 20: 40, 100: 200}'"},
    {"name": "Patch fixes it without regressions", "input": "The second and third run-tests in exampleInput", "expected": "LASTN_QUERY_COUNT ... queries=3 for 1, 20 and 100 subjects; 'Ran 49 tests' and 'OK' for the whole app"},
    {"name": "Same result on MariaDB", "input": "Repeat the patched run with bench --site mariadb.localhost run-tests --module spice_lite.tests.test_lastn_query_count", "expected": "Ran 3 tests ... OK with the same three LASTN_QUERY_COUNT lines"},
    {"name": "Helper flags the N+1 in the captured log", "input": "node .claude/skills/performance-review/scripts/count-queries.mjs .claude/skills/performance-review/examples/lastn-fix/sql-before.log --from LASTN_BEGIN --to LASTN_END --fail-on-suspect; echo exit=$?", "expected": "statements: 40  distinct shapes: 2; two lines '20  select * from \"tabsl ...' marked '<-- N+1 suspect'; exit=1"},
    {"name": "Helper is clean on the after log", "input": "Same command on sql-after.log", "expected": "statements: 3  distinct shapes: 3, 'no N+1 suspects', exit=0"},
    {"name": "sample-app still carries the teaching defect", "input": "grep -c 'TEACHING-DEFECT(perf-n+1)' AI-SDLC-frappe/sample-app/spice_lite/spice_lite/api/fhir.py && git status --short AI-SDLC-frappe/sample-app", "expected": "1, and no git status output"},
    {"name": "assertQueryCount trap is handled", "input": "Remove PostgresQueryCountMixin from the test class and run it on test.localhost with the patch applied", "expected": "ERROR with TypeError: sequence item 0: expected str instance, LazyDecode found (KNOWN_DEFECTS.md D-10), although the count is 3"}
   ],
   "evaluationCriteria": [
    "Every high finding carries a measured number and the command that produced it.",
    "The fix stays on frappe.get_list (permission-aware); no frappe.qb, raw SQL or get_all introduced.",
    "Behaviour is preserved: latest per patient, request order, unknown subjects skipped, the D-2 range filter kept.",
    "Apply, test and revert happen inside one lock, and sample-app is unchanged afterwards.",
    "The review does not lead with a cache and does not print SQL values."
   ],
   "improvements": [
    "Add the composite (patient, code, effective_datetime) index and the D-6 indexes in a post-model-sync patch with explicit index names, and re-measure with EXPLAIN (ANALYZE, BUFFERS) on a synthetic dataset.",
    "Turn count-queries.mjs --fail-on-suspect into a CI step over the SQL: lines of every query-count test.",
    "Add a per-user rate limit on lastn with frappe.rate_limiter and a 429 OperationOutcome.",
    "Accept POST for lastn and search so large subject lists and search terms leave the URL."
   ]},
  {"id": "04-production-rca-incident",
   "title": "Build production-rca and analyse the lastn onboarding incident on a country site",
   "objective": "Create a production-rca skill with an RCA template and a timeline builder that merges Frappe evidence (nginx, gunicorn, RQ, Redis, Error Log in site time, Postgres) into UTC and stops on PHI or secrets. Run it on the synthetic INC-2026-0922-01 pack. The RCA must reject the telephony deploy, database degradation, OOM and Redis hypotheses with evidence, identify the lastn N+1 plus the subject cap as root cause, name CHG-5103 as the trigger, and propose mechanisms, not advice.",
   "startingFiles": [
    {"path": PACK + name, "content": f(PACK + name)} for name in (
     "incident-brief.md", "changes.md", "nginx-access.log", "web.error.log", "worker.log",
     "redis-queue.txt", "error-log.txt", "postgres-slow.log", "metrics.md")
   ],
   "requiredStructure": "AI-SDLC-frappe/.claude/skills/production-rca/\n├── SKILL.md                          # guard first, read-only, analysis order, Frappe reasoning rules\n├── rca-template.md                   # 11 sections incl. background jobs, clinical safety, PHI exposure\n├── scripts/\n│   └── build-timeline.mjs            # UTC merge, --date, --offset, --collapse; guard exit 3\n└── examples/INC-2026-0922-lastn/     # starting files: the evidence pack (9 files)",
   "implementation": [
    impl(RC + "SKILL.md", "markdown", "verified-format"),
    impl(RC + "rca-template.md", "markdown"),
    impl(RC + "scripts/build-timeline.mjs", "javascript")
   ],
   "exampleInput": "cd AI-SDLC-frappe\nE=.claude/skills/production-rca/examples/INC-2026-0922-lastn\nnode .claude/skills/production-rca/scripts/build-timeline.mjs $E/*.log $E/*.txt $E/*.md \\\n  --date 2026-09-22 --offset error-log.txt=+03:00 --offset worker.log=+00:00 --collapse | sed -n '32,41p'\nclaude -p \"/production-rca $E INC-2026-0922-01\" --permission-mode plan --output-format json | jq -r '.result' > /tmp/rca.md",
   "expectedOutput": "| 30 | 2026-09-22 08:03:55 | postgres-slow.log | [18228] spice_ke@_1b2c3d4e5f607182 LOG: duration: 1318.402 ms statement: select \"name\", \"owner\", \"creation\" from \"tabSL Encounter\" where \"tabSL Encounter\".\"patient\" = 'SLP-03902... | postgres-slow.log:8 |\n| 31 | 2026-09-22 08:04:00 | redis-queue.txt | default=4 short=0 long=0 used_memory=3.2M | redis-queue.txt:6 |\n| 32 | 2026-09-22 08:04:05 | nginx-access.log | 10.40.17.101 - - \"GET /api/method/spice_lite.api.fhir.lastn?subjects=[100 ids elided]&code=8867-4 HTTP/1.1\" 504 160 \"-\" \"c017-ward-board/1.0.0 (Android 13)\" 120.001 120.001 | nginx-access.log:9 |\n| 33 | 2026-09-22 08:04:05 | web.error.log | [2211] [CRITICAL] WORKER TIMEOUT (pid:2240) | web.error.log:6 |\n| 34 | 2026-09-22 08:04:05 | web.error.log | [2211] [ERROR] Worker (pid:2240) exited with code 1 | web.error.log:7 |\n(...)\nbuild-timeline: 125 events from 9 file(s)\n\nRCA excerpt (/tmp/rca.md, section 6):\n| H1 | Bad deploy: spice_telephony 1.8.0 (CHG-5104) | the only deploy that day | healthy 07:41 to 08:00 (E2); rollback at 08:20 did not help (E13); slow statements are lastn's shape (E4) | rejected |\n| H3 | Memory exhaustion (OOM) | 'Perhaps out of memory?' six times (E6) | every SIGKILL follows WORKER TIMEOUT for the same pid by about 1 s; memory peak 58%; no kernel OOM (E8) | rejected |\n| H7 | lastn cost model | 200 statements per 100-subject call (E15); 423 rows per statement (E5); fhir.py:155-184 | none found | confirmed as root cause |",
   "testCases": [
    {"name": "Evidence pack is PHI-free and merges cleanly", "input": "The build-timeline command in exampleInput; echo exit=$?", "expected": "Markdown timeline, stderr 'build-timeline: 125 events from 9 file(s)' with no warning, exit=0"},
    {"name": "PHI guard stops the analysis", "input": "node .claude/skills/production-rca/scripts/build-timeline.mjs skills/production-rca/tests/fixtures/phi-leak/*.log; echo exit=$?", "expected": "stderr lists 'frappe.log:3: Form Dict with patient fields' and 'nginx-access.log:1: PHI query parameter', no timeline and no surname printed, exit=3"},
    {"name": "Site-local Error Log times need the offset", "input": "Drop --offset error-log.txt=+03:00 from the command", "expected": "warning '5 timestamp(s) without a zone in error-log.txt taken as UTC', and the first JobTimeoutException row moves from 08:10:00 to 11:10:00"},
    {"name": "SIGKILL is not read as OOM", "input": "grep -n 'OOM\\|out of memory' /tmp/rca.md", "expected": "The OOM hypothesis is rejected with the WORKER TIMEOUT to SIGKILL sequence and the 58% memory peak cited"},
    {"name": "All template sections present", "input": "grep -cE '^## ([1-9]|1[01])\\. ' /tmp/rca.md", "expected": "11"},
    {"name": "Negative control: real OOM", "input": "Golden case rca-04 (pack plus tests/fixtures/oom-variant/kern.log)", "expected": "Resource exhaustion (memory) becomes contributing and the RCA quotes 'Out of memory: Killed process 2248'"},
    {"name": "Preventive actions are mechanisms", "input": "Section 9 of /tmp/rca.md", "expected": "Each action names prevents/detects/mitigates and an owner role (for example: query-count test in CI, per-user rate limit, busy-worker alert); none says 'be more careful'"}
   ],
   "evaluationCriteria": [
    "The guard runs first, and the RCA never quotes a line the guard flagged.",
    "Every causal link and every rejected candidate cites file:line or a named query.",
    "Frappe specifics are read correctly: sync workers, 120 s timeouts, SIGABRT then SIGKILL, Error Log in site time, no Error Log for killed requests.",
    "Trigger, root cause and contributing factors are separate, and the numbers agree across nginx, Postgres and metrics.",
    "The RCA is blameless and has status needs-human."
   ],
   "improvements": [
    "Add a --tz-from-brief option that reads the site time zone from the incident brief instead of --offset flags.",
    "Export RQ Job and Error Log rows with a redacting script (names and locals removed) so the pack can be rebuilt on demand.",
    "Replay the tablet pattern against a synthetic staging site as a game day and attach the timeline to the RCA's verification section."
   ]},
  {"id": "04-skill-assets-golden-cases",
   "title": "Version the three skills as assets with golden cases and tested instruments",
   "objective": "Give each skill an asset folder with README (owner, version, who preloads it, headless use), CHANGELOG at 1.0.0 recording what was and was not verified, golden cases mixing deterministic, bench and live checks (including negative controls), node tests for every script, fixtures, and an answer key stored outside the runtime folder. Run every deterministic case and record the result.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC-frappe/skills/\n├── security-review/\n│   ├── README.md  CHANGELOG.md\n│   └── tests/cases.json  tests/render-report.test.mjs\n│       tests/expected/sample-app-report.json  tests/expected/sample-app-report.md\n├── performance-review/\n│   ├── README.md  CHANGELOG.md\n│   └── tests/cases.json  tests/count-queries.test.mjs  tests/expected/sample-app-findings.md\n└── production-rca/\n    ├── README.md  CHANGELOG.md\n    └── tests/cases.json  tests/build-timeline.test.mjs  tests/expected/INC-2026-0922-01-rca.md\n        tests/fixtures/phi-leak/{frappe.log,nginx-access.log,README.md}\n        tests/fixtures/oom-variant/{kern.log,README.md}",
   "implementation": [
    impl(A + "security-review/README.md", "markdown"),
    impl(A + "security-review/CHANGELOG.md", "markdown"),
    impl(A + "security-review/tests/cases.json", "json"),
    impl(A + "security-review/tests/render-report.test.mjs", "javascript"),
    impl(A + "security-review/tests/expected/sample-app-report.json", "json"),
    impl(A + "security-review/tests/expected/sample-app-report.md", "markdown"),
    impl(A + "performance-review/README.md", "markdown"),
    impl(A + "performance-review/CHANGELOG.md", "markdown"),
    impl(A + "performance-review/tests/cases.json", "json"),
    impl(A + "performance-review/tests/count-queries.test.mjs", "javascript"),
    impl(A + "performance-review/tests/expected/sample-app-findings.md", "markdown"),
    impl(A + "production-rca/README.md", "markdown"),
    impl(A + "production-rca/CHANGELOG.md", "markdown"),
    impl(A + "production-rca/tests/cases.json", "json"),
    impl(A + "production-rca/tests/build-timeline.test.mjs", "javascript"),
    impl(A + "production-rca/tests/expected/INC-2026-0922-01-rca.md", "markdown"),
    impl(A + "production-rca/tests/fixtures/phi-leak/frappe.log", "plaintext"),
    impl(A + "production-rca/tests/fixtures/phi-leak/nginx-access.log", "plaintext"),
    impl(A + "production-rca/tests/fixtures/phi-leak/README.md", "markdown"),
    impl(A + "production-rca/tests/fixtures/oom-variant/kern.log", "plaintext"),
    impl(A + "production-rca/tests/fixtures/oom-variant/README.md", "markdown")
   ],
   "exampleInput": "cd AI-SDLC-frappe\nnode --test skills/security-review/tests/render-report.test.mjs skills/performance-review/tests/count-queries.test.mjs skills/production-rca/tests/build-timeline.test.mjs 2>&1 | grep -E '^# (tests|pass|fail) '\njq -r '.cases[] | \"\\(.id) \\(.kind)\"' skills/{security-review,performance-review,production-rca}/tests/cases.json",
   "expectedOutput": "# tests 20\n# pass 20\n# fail 0\nsec-01-baseline-sample-app live\nsec-02-fstring-sql live\nsec-03-allow-guest live\nsec-04-form-dict-logger live\nsec-05-clinician-delete live\nsec-06-negative-control-docstring live\nsec-07-renderer-tests deterministic\nsec-08-answer-key-gates deterministic\nsec-09-probes-confirm-findings bench\nperf-01-lastn-baseline live\nperf-02-count-in-loop live\nperf-03-negative-control-after-fix live\nperf-04-index-trap live\nperf-05-helper-tests deterministic\nperf-06-helper-flags-real-log deterministic\nperf-07-before-after-on-bench bench\nrca-01-timeline-builder-tests deterministic\nrca-02-pack-is-clean deterministic\nrca-03-full-rca live\nrca-04-negative-control-real-oom live\nrca-05-phi-guard-stops-analysis live\nrca-06-answer-key-template-sections deterministic",
   "testCases": [
    {"name": "At least six cases per skill", "input": "for s in security-review performance-review production-rca; do jq '.cases | length' AI-SDLC-frappe/skills/$s/tests/cases.json; done", "expected": "9, 7, 6"},
    {"name": "Every case has id, kind, input and expect", "input": "jq -e '([.cases[] | select(.id and .kind and .input and .expect)] | length) == (.cases | length)' AI-SDLC-frappe/skills/{security-review,performance-review,production-rca}/tests/cases.json", "expected": "true three times"},
    {"name": "Deterministic cases pass", "input": "Run input.command of every case with kind deterministic from AI-SDLC-frappe/", "expected": "7 of 7 pass: sec-07 (exit 0), sec-08 (exit 1), perf-05 (exit 0), perf-06 (exit 1), rca-01, rca-02, rca-06 (exit 0)"},
    {"name": "Live-case patches apply to the shipped app", "input": "For sec-02, sec-03, sec-04, sec-06 and perf-02: echo \"$patch\" | git apply --check - from AI-SDLC-frappe/", "expected": "All five exit 0"},
    {"name": "Answer keys are outside the runtime folder", "input": "ls -d AI-SDLC-frappe/.claude/skills/{security-review,performance-review,production-rca}/tests 2>/dev/null | wc -l; ls AI-SDLC-frappe/skills/{security-review,performance-review,production-rca}/tests/expected/", "expected": "0; sample-app-report.json, sample-app-report.md, sample-app-findings.md, INC-2026-0922-01-rca.md"},
    {"name": "CHANGELOG states version and verification", "input": "grep -h '^## \\[1.0.0\\]' AI-SDLC-frappe/skills/{security-review,performance-review,production-rca}/CHANGELOG.md; grep -c 'Not yet verified' AI-SDLC-frappe/skills/{security-review,performance-review,production-rca}/CHANGELOG.md", "expected": "three 1.0.0 entries dated 2026-09-30, each with a 'Not yet verified' section for the live cases"},
    {"name": "Negative controls exist", "input": "jq -r '.cases[].id' AI-SDLC-frappe/skills/{security-review,performance-review,production-rca}/tests/cases.json | grep -c negative-control", "expected": "3"}
   ],
   "evaluationCriteria": [
    "Each skill has README, CHANGELOG (1.0.0) and a cases.json whose deterministic cases pass.",
    "Every script has a node test; fixtures cover both a hit and a must-not-hit for each guard.",
    "Live cases name the exact patch, invocation and mustFind/mustNotFind; defect-adding patches are labelled EXERCISE-INTRODUCED.",
    "No token-shaped string or real-looking PHI is committed (the token test generates its input at run time).",
    "CHANGELOGs separate what was verified (with versions) from what needs a model run."
   ],
   "improvements": [
    "Feed the live cases into the eval harness of module 09-agent-evaluation and track pass rate per skill version.",
    "Add a Claude Code hook (module 10-governance) that blocks editing SKILL.md without a CHANGELOG entry in the same change.",
    "Package the three skills as a plugin for other Frappe benches, with the answer keys kept out of the package."
   ]}
 ],
 "agentContracts": [],
 "checklist": [
  "`.claude/skills/{security-review,performance-review,production-rca}/SKILL.md` use only documented frontmatter keys and none sets `disable-model-invocation` (the security and sre agents preload them).",
  "Inside `AI-SDLC-frappe/`, `/security-review` runs the project skill, not the bundled command.",
  "`render-report.mjs` exits 1 on the answer key with `--fail-on high` and 2 on an invalid, inconsistent, MRN-, token- or Form-Dict-bearing report.",
  "The review of the unmodified app reports the `frappe.get_all` bypass in `lastn` (fhir.py:177-182), the Error Log path in `create_observation` and the GET search terms as high, and has no injection finding.",
  "The seven probes pass on the unmodified app (`Ran 7 tests ... OK`), and probes 1 and 2 fail once the lastn patch is applied.",
  "`test_lastn_query_count.py` shows 2/40/200 statements for 1/20/100 subjects on the shipped app and 3/3/3 with `lastn-set-based.patch`, with 49 tests passing, on Postgres and MariaDB.",
  "The query-count proof does not depend on `FrappeTestCase.assertQueryCount` on Postgres (KNOWN_DEFECTS.md D-10).",
  "`sample-app/` is unchanged (`git status --short sample-app` is empty) and still contains `TEACHING-DEFECT(perf-n+1)`.",
  "`build-timeline.mjs` merges the nine evidence files (125 events collapsed) and exits 3 on the PHI fixture without printing it.",
  "The RCA rejects the telephony deploy, database degradation, OOM and Redis hypotheses with evidence and cites file:line for every causal link.",
  "Each skill has README, CHANGELOG (1.0.0) and golden cases; all seven deterministic cases pass.",
  "Answer keys live under `AI-SDLC-frappe/skills/<name>/tests/expected/`, not under `.claude/skills/`."
 ]
}
for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
out = ROOT / "content-frappe/modules/04-skills-security-performance-rca.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
