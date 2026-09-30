# Generator for content-frappe/modules/05-agent-roster.json (Frappe edition).
# Run: python3 build/sources-frappe/05-agent-roster.py
# Implementation contents are read from disk (byte-identical). agentContracts are produced from the
# CONTRACT.md files by `node agents/check-agents.mjs --contracts-json` (and cross-checked against
# docs/foundations/validate-contract.mjs --json when that validator exists), so module and repo
# cannot drift. Checker, guard and hook outputs are captured live from the real scripts; the
# fixture verification output is the real bench run saved in agents/reviewer/fixtures/.
import json, pathlib, shutil, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT / "AI-SDLC-frappe"
R = "AI-SDLC-frappe/"
def f(p): return (ROOT / p).read_text()
def run(cmd, cwd=REPO):
    r = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True,
                       env={"PATH": "/opt/node22/bin:/usr/local/bin:/usr/bin:/bin", "HOME": "/root"})
    return r.stdout + r.stderr, r.returncode

ROSTER = ["architect", "developer", "reviewer", "tester", "security", "sre"]

out, code = run("node agents/check-agents.mjs --contracts-json")
assert code == 0, out
contracts = json.loads(out)
if (REPO / "docs/foundations/validate-contract.mjs").exists():
    for c in contracts:
        v, vc = run(f"node docs/foundations/validate-contract.mjs --json agents/{c['agent']}/CONTRACT.md")
        assert vc == 0, v
        assert json.loads(v) == c, f"contract JSON differs between validators for {c['agent']}"

check_out, check_code = run("node agents/check-agents.mjs")
assert check_code == 0, check_out
def test_summary(file):
    o, c = run(f"node --test {file}")
    assert c == 0, o
    return "\n".join(l for l in o.splitlines() if l.startswith(("ok ", "not ok", "# tests", "# pass", "# fail")))
tg_summary = test_summary("agents/tool-guard.test.mjs")
ca_summary = test_summary("agents/check-agents.test.mjs")

def hook(agent_args, payload):
    cmd = ("printf '%s' '" + json.dumps(payload) + "' | CLAUDE_PROJECT_DIR=\"$PWD\" node agents/tool-guard.mjs "
           + agent_args + " 2>&1; echo \"exit=$?\"")
    o, _ = run(cmd)
    return cmd, o.strip()
DEV_ALLOW = ("bash-allow 'cd {bench}' 'bench --site test.localhost run-tests' '?bench --site test.localhost migrate' "
             "'git diff'")
demo_console_cmd, demo_console_out = hook(DEV_ALLOW, {"tool_name": "Bash", "tool_input": {"command": "cd /home/user/frappe-bench && bench --site test.localhost console"}, "agent_type": "developer"})
demo_migrate_cmd, demo_migrate_out = hook(DEV_ALLOW, {"tool_name": "Bash", "tool_input": {"command": "cd /home/user/frappe-bench && bench --site test.localhost migrate"}, "agent_type": "developer"})
demo_write_cmd, demo_write_out = hook("write-scope docs/adr/ .ai-sdlc/runs/", {"tool_name": "Write", "tool_input": {"file_path": "sample-app/spice_lite/spice_lite/api/fhir.py"}, "agent_type": "architect"})
demo_log_cmd, demo_log_out = hook("bash-allow 'tail {bench}/logs/**'", {"tool_name": "Bash", "tool_input": {"command": "tail -n 5 /home/user/frappe-bench/logs/../sites/test.localhost/site_config.json"}, "agent_type": "sre"})
for o in (demo_console_out, demo_write_out, demo_log_out):
    assert o.endswith("exit=2"), o
assert '"permissionDecision":"ask"' in demo_migrate_out and demo_migrate_out.endswith("exit=0"), demo_migrate_out

# The classic mistake, reproduced on a temp copy of the roster (the repo files are not touched).
tmp = pathlib.Path(tempfile.mkdtemp(prefix="check-agents-demo-"))
for n in ROSTER:
    (tmp / ".claude/agents").mkdir(parents=True, exist_ok=True)
    (tmp / "agents" / n).mkdir(parents=True, exist_ok=True)
    shutil.copy(REPO / ".claude/agents" / f"{n}.md", tmp / ".claude/agents" / f"{n}.md")
    shutil.copy(REPO / "agents" / n / "CONTRACT.md", tmp / "agents" / n / "CONTRACT.md")
shutil.copy(REPO / "agents/tool-guard.mjs", tmp / "agents/tool-guard.mjs")
dev = tmp / ".claude/agents/developer.md"
dev.write_text(dev.read_text().replace("disallowedTools: Agent, NotebookEdit, WebFetch, WebSearch",
                                       "disallowedTools: Agent, NotebookEdit, WebFetch, WebSearch, Bash(git push *)")
                              .replace("'?bench --site test.localhost migrate'", "'bench --site test.localhost migrate'"))
broken_out, broken_code = run(f"node agents/check-agents.mjs --root {tmp}")
assert broken_code == 1, broken_out
broken_lines = "\n".join(l for l in broken_out.splitlines()
                         if l.startswith("FAIL") or ("error:" in l) or l.startswith("Summary"))
shutil.rmtree(tmp)

VERIFY_OUT = f(R + "agents/reviewer/fixtures/verify-fixture.expected.txt").strip()

REQS = """---
run_id: 2026-09-30-feat-country-roster
step: 01
agent: orchestrator
status: complete
inputs: [ticket:SPICE-212]
next: architect
---
## Summary
SPICE-212: the country programme dashboard needs, for one country, the active patients and how many encounters each has had. Clinicians use it on desk; no external system calls it.

## Findings
No findings.

## Decisions
- AC1: a Clinician sees the active SL Patient records of one country with an encounter count per patient.
- AC2: a user without the Clinician role sees nothing (403 or an empty, permission-filtered result).
- AC3: one request costs a constant number of queries, whatever the number of patients.
- AC4: nothing identifying (MRN, names) reaches the audit log; document names and counts only.
- Out of scope: exporting the list, observation values.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-30-feat-country-roster/01-requirements.md
"""

ARCH_HANDOFF = """---
run_id: 2026-09-30-feat-country-roster
step: 02
agent: architect
status: needs-human
inputs: [01-requirements.md]
next: human
---
## Summary
SPICE-212 is a desk-only list of active patients per country with encounter counts. Recommended: a standard Script Report `SL Country Roster` in the `Clinical` module of `spice_lite`, reading through two permission-aware `frappe.get_list` calls (patients, then one grouped encounter count). No new whitelisted method, no schema change, no patch. ADR-0002 proposed because it adds the app's first Report.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| ARC-001 | high | performance | sample-app/spice_lite/spice_lite/api/fhir.py:156 | `# TEACHING-DEFECT(perf-n+1): one get_doc + one get_all PER SUBJECT -> 2N queries` | Do not count encounters per patient in a loop (frappe-coding-standards rule 5). Use one `frappe.get_list("SL Encounter", fields=["patient", "count(name) as encounters"], filters={"patient": ("in", names)}, group_by="patient")`. |
| ARC-002 | medium | security | sample-app/spice_lite/spice_lite/api/fhir.py:83 | `rows = frappe.get_list(` | Read patients the way `search_patients` does: `frappe.get_list` with explicit `fields`, never `frappe.db.sql` or `get_all`, so DocType permissions and user permissions apply (rule 2). |
| ARC-003 | medium | design | context/standards/api-standards.md | `Success returns a FHIR-lite resource (Patient, Observation) or a Bundle` | A roster with counts is not a FHIR-lite resource. Serve it as a desk Script Report, not a new `/api/method` endpoint, so the API contract stays FHIR-lite (ADR-0001). |
| ARC-004 | low | performance | sample-app/spice_lite/spice_lite/clinical/doctype/sl_encounter/sl_encounter.json:23 | `"search_index": 1` (on `patient`) | The grouped count can use the existing index; `country` on SL Patient is indexed too (`sl_patient.json:69`). No schema change, so no patch in `patches.txt`. |
| ARC-005 | low | security | sample-app/spice_lite/spice_lite/audit.py:31 | `def log_access(action: str, doctype: str, names=None, **counts) -> dict:` | Audit the report run with document names and `result_count` only; never MRNs or names (glossary PHI table, rule 10). |

## Decisions
- Option A (chosen): Script Report `SL Country Roster` (`clinical/report/sl_country_roster/` with `.json`, `.py` `execute(filters)`, `.js` filter on `country`), roles `Clinician` and `System Manager`. Two queries per run whatever the patient count (AC3); `get_list` applies permissions for the session user (AC2).
- Option B (rejected): whitelisted method `spice_lite.api.fhir.country_roster`. Adds a non-FHIR response shape to the FHIR-lite API (api-standards) and a new public endpoint to secure, for a desk-only need.
- Option C (rejected): build it in each country app. The list is the same in every deployment; frappe-coding-standards rule 12 keeps only country-specific behaviour in country apps.
- Where it lives: core `spice_lite` (`Clinical` module); no country app, no integration app, no `hooks.py` key.
- Implementation outline: (1) report files; (2) tests in `spice_lite/tests/test_country_roster_report.py`: Clinician sees only active patients of the country, `NO_ROLE_USER` gets `frappe.PermissionError`, `assertQueryCount` bound for 1 vs 5 patients, audit record holds names only; (3) `bench --site test.localhost run-tests --app spice_lite`.

## Open questions
- ADR-0002 needs human approval before the developer starts: is a standard Report in `spice_lite` acceptable, or should dashboards live in a separate reporting app?

## Artifacts
- docs/adr/0002-country-roster-as-script-report.md
- .ai-sdlc/runs/2026-09-30-feat-country-roster/02-architect.md"""

REVIEW_V2 = """---
run_id: 2026-09-30-feat-country-roster-review
step: 03
agent: reviewer
status: complete
inputs: []
next: security
---
## Summary
Verdict: BLOCK. The change adds a whitelisted method `country_roster` to `spice_lite/api/fhir.py` (raw SQL over `tabSL Patient` plus an encounter count per row) and gives `Clinician` delete permission on `SL Patient`. 8 findings: 2 critical, 3 high, 3 medium. Routed to security: a DocType `permissions` array, a `@frappe.whitelist` decorator, raw SQL and the audit call changed.
Frappe surfaces: DocType JSON (`sl_patient.json` permissions array), whitelisted method (`api/fhir.py`); no `patches.txt`, `hooks.py` or fixture change.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| REV-001 | critical | security | sample-app/spice_lite/spice_lite/api/fhir.py:195-197 | `f\"\"\"select name, mrn, first_name, last_name` ... `where country = '{country}' and active = {int(active)}` | SQL injection: `country="KE' or '1'='1"` widens the WHERE clause to every active patient (reasoned from code; proven by the fixture check). Use `frappe.get_list` with `filters={"country": country, "active": 1}` (frappe-coding-standards rule 4). |
| REV-002 | critical | security | sample-app/spice_lite/spice_lite/api/fhir.py:194 | `rows = frappe.db.sql(` with no `frappe.has_permission` before it | `frappe.db.sql` skips DocType permissions, so any logged-in user, including one with no role, receives MRNs and names. Check `frappe.has_permission("SL Patient", "read")` and read with `frappe.get_list` (rule 2, threat-model row "Permission bypass"). |
| REV-003 | high | security | sample-app/spice_lite/spice_lite/api/fhir.py:203 | `log_access("roster", "SL Patient", [row.mrn for row in rows], result_count=len(rows))` | The audit log receives MRNs (PHI in the glossary table). Pass document names: `[row.name for row in rows]` (rule 10). |
| REV-004 | high | correctness | sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json:95 | `"delete": 1,` in the `"role": "Clinician"` permission row | Breaks glossary business rule 5 (Clinician cannot delete clinical documents); after `bench migrate` `test_clinician_can_create_but_not_delete` (`test_sl_patient.py:40`) fails. Revert; a `permissions` array change needs a security review (review-standards). |
| REV-005 | high | testing | sample-app/spice_lite/spice_lite/api/fhir.py:191 | `def country_roster(country: str, active: int = 1):`; `git diff --stat` shows no file under `tests/` | Add FrappeTestCase tests: Clinician happy path, `NO_ROLE_USER` gets 403, injection string returns 400 or nothing, `assertQueryCount` bound, audit names only (testing-standards: every whitelisted method). |
| REV-006 | medium | performance | sample-app/spice_lite/spice_lite/api/fhir.py:201-202 | `for row in rows:` / `row["encounters"] = frappe.db.count("SL Encounter", {"patient": row.name})` | One query per patient and no row limit. Replace with one grouped `frappe.get_list("SL Encounter", fields=["patient", "count(name) as encounters"], group_by="patient", ...)` (rule 5). |
| REV-007 | medium | standards | sample-app/spice_lite/spice_lite/api/fhir.py:190 | `@frappe.whitelist()` | Without `methods` the endpoint accepts GET, POST, PUT and DELETE; every other method in this file restricts it. Use `@frappe.whitelist(methods=["GET"])` (rule 3). |
| REV-008 | medium | design | sample-app/spice_lite/spice_lite/api/fhir.py:204 | `return {"country": country, "total": len(rows), "patients": rows}` | Raw DB rows, not a FHIR-lite `Bundle`; api-standards requires a resource or `Bundle` from `spice_lite.api.fhir.*`. A desk roster fits a Script Report better (see architect option A in 2026-09-30-feat-country-roster). |

## Decisions
- correctness: REV-004
- security: REV-001, REV-002, REV-003
- design: REV-008
- testing: REV-005
- performance: REV-006
- standards: REV-007
- readability: no findings
- docs: no findings
- The diff does not touch `lastn()`; TEACHING-DEFECT(perf-n+1) was not reviewed. No `patches.txt` line is needed: the JSON change is a permissions change, not a schema or data change.

## Open questions
- Should `country_roster` exist at all as an API method, or be replaced by the Script Report proposed in ADR-0002?

## Artifacts
- none written; returned to main session"""

REVIEW_V1_TYPICAL = """Here is my review of the change, most important first.

1. **SQL injection** - `country_roster` builds the query with an f-string. Use parameters.
2. **Permissions** - Clinicians can now delete patients; that looks unintended.
3. **Logging** - the audit call logs MRNs; consider logging names instead.
4. **Performance** - `frappe.db.count` runs once per patient.

I tried to run the test suite and `bench --site test.localhost migrate` to confirm the permission change, but neither command was permitted, so I could not verify it. Overall the change is close; fix the items above and it should be fine to merge."""

mod = {
 "id": "05-agent-roster",
 "level": 3,
 "title": "The Agent Roster: Six Subagents with Frappe Tool Scopes and Contracts",
 "summary": "Build the six roster agents (architect, developer, reviewer, tester, security, sre) for the spice_lite Frappe app as real `.claude/agents/*.md` files with deliberate model, tool, permission-mode and skill choices; scope their Bash to what each role may do on a bench (run-tests for developer and tester, migrate only through a human `ask`, console and execute never, bench logs read-only for sre) with an agent-scoped Claude Code hook; write an Agent Contract for each; and prove runtime and contract agree with a zero-dependency conformance checker. The reviewer ships as v2 and is tested on a seeded spice_lite diff whose defects were verified on a real bench.",
 "prerequisites": [
  "01-foundations",
  "02-first-agent-skill-tools",
  "03-skills-architecture-code-test",
  "04-skills-security-performance-rca",
  "A working bench with `test.localhost` (`AI-SDLC-frappe/sample-app/scripts/setup-bench.sh`; `bench --site test.localhost run-tests --app spice_lite` passes)",
  "Node 22 (guard and checker scripts) and GNU `patch`",
  "Claude Code CLI installed and authenticated (`claude --version`)"
 ],
 "concepts": [
  {"heading": "From one agent to a roster on a bench",
   "body_md": "Module 02 built one reviewer that could do anything the main session could. A roster splits the SDLC into six narrow jobs, because narrow agents are easier to **permission**, **evaluate** and **trust**. On a Frappe app each job also touches different surfaces:\n\n| Agent | Job | Frappe surfaces | Runs bench? |\n|---|---|---|---|\n| `architect` | options, where the change lives, ADR | reads DocType JSON, `hooks.py`, `patches.txt` | no |\n| `developer` | implement an approved plan with tests | writes controllers, `api/`, DocType JSON, new patches | `run-tests`; `migrate` only via a human prompt |\n| `reviewer` | findings on a diff | reads Python and JSON together | no |\n| `tester` | test strategy, missing tests, run suite | writes `tests/` and `test_*.py` only | `run-tests` |\n| `security` | whitelisting, permissions, injection, PHI, secrets | reads `permissions` arrays, `audit.py` | no |\n| `sre` | RCA, performance, queues, release readiness | reads `scheduler_events`, logs | read-only diagnostics |\n\nEach agent is three artifacts that must agree:\n\n- `AI-SDLC-frappe/.claude/agents/<name>.md`: the runtime definition Claude Code loads (verified format).\n- `AI-SDLC-frappe/agents/<name>/CONTRACT.md`: the Agent Contract (course convention, template from module 01-foundations), including a `Frappe surfaces:` line.\n- A **handoff** under `.ai-sdlc/runs/<run-id>/NN-<name>.md` in the format of `workflows/README.md`.\n\n**Topology is flat on purpose.** Current Claude Code lets a subagent spawn subagents (up to three layers by default; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes it). None of the six lists `Agent` in `tools`, and all six put `Agent` in `disallowedTools`, so every roster agent runs at depth 1 and the orchestrator in the main thread makes every delegation decision (modules 07 and 08). One transcript and one handoff per step keeps a run auditable.\n\nSo in practice: when the reviewer sees a `permissions` array change, it does not call the security agent. It writes `next: security` in its handoff and the orchestrator decides."},
  {"heading": "Anatomy of a roster agent file",
   "body_md": "Only `name` and `description` are required, and unknown keys are **silently ignored**: a typo such as `allowed-tools` (skill syntax) or `permission-mode` fails without an error. The roster uses only documented camelCase subagent fields:\n\n- `description`: when to delegate, with the trigger (\"after the developer agent finishes\") and the hard limit (\"never runs bench\"). Claude matches tasks against this text.\n- `tools`: an **allowlist**. Omitting it inherits every tool, MCP tools and `Agent` included.\n- `disallowedTools`: a second guard that survives someone deleting `tools` later.\n- `model`, `effort`, `maxTurns`: cost and depth per role.\n- `permissionMode`: `acceptEdits` for writers, `dontAsk` for reviewer and security, inherited for `sre`.\n- `skills`: preloads the full skill content at start-up. architect: `architecture-review`; reviewer: `code-review`; tester: `test-strategy`, `run-tests`; security: `security-review`; sre: `performance-review`, `production-rca`; developer: `run-tests`. A skill with `disable-model-invocation: true` cannot be preloaded.\n- `hooks`: Claude Code hooks (`PreToolUse`) that run only inside this agent.\n- `color`: to tell agents apart in the UI.\n\nThe **body** is the whole system prompt: subagents do not get the Claude Code system prompt or your conversation. They do get the CLAUDE.md hierarchy, and `.claude/rules/doctype-json.md` loads by itself when the agent reads a DocType JSON file. Every roster body has the same parts: inputs, context files by path, where the bench is (`/home/user/frappe-bench`, or `SPICE_BENCH_DIR` from `CLAUDE.local.md`), a numbered procedure, the exact handoff template, stop conditions, what to do when blocked, and a short \"Never\" list. The body names its CONTRACT.md and says the contract wins on conflict."},
  {"heading": "Scoping Bash on a bench: why a Claude Code hook, not disallowedTools",
   "body_md": "Four controls exist (module 02 compares them): `tools`/`disallowedTools`, agent frontmatter `hooks`, `permissions` rules, and `permissionMode`. On a bench three facts decide the design:\n\n- **A specifier in `disallowedTools` removes the whole tool.** `disallowedTools: Bash(bench --site * console)` does not block console; it removes Bash, and the developer can no longer run tests.\n- **`permissionMode` is ignored** when the parent session runs in `bypassPermissions`, `acceptEdits` or `auto`, and project `allow` rules still apply under `dontAsk`: `Bash(bench --site test.localhost run-tests *)` is allowed in `.claude/settings.json`, so a `dontAsk` reviewer could still run the suite.\n- **`Write(...)` path rules are never consulted**, so write scope cannot come from permission rules either.\n\nSo each agent's `hooks:` frontmatter runs `AI-SDLC-frappe/agents/tool-guard.mjs` (a course pattern, not a built-in feature) on `PreToolUse`, in one of two modes:\n\n- `write-scope <prefix|glob>... [!protected]`: the tester gets `sample-app/spice_lite/spice_lite/tests/` and `**/doctype/*/test_*.py`, nothing else.\n- `bash-allow <entry>...`: plain prefixes (`bench --site test.localhost run-tests`), **ask entries** (`?bench --site test.localhost migrate` returns `permissionDecision: \"ask\"`, so migrate is never auto-allowed and a human decides), and **patterned entries** (`tail {bench}/logs/**`, `grep ARG {bench}/logs/**`) whose path arguments must stay inside the bench `logs/` folder.\n\nWhatever an allowlist says, the guard exits 2 for `bench console`, `execute`, `jupyter`, DB shells, `show-config`, `drop-site`, `reinstall`, `set-config`, `purge-jobs`, anything naming `site_config.json`, `git push|commit`, `curl`, `redis-cli` and `--junit-xml-output`. `{bench}` expands to `SPICE_BENCH_DIR`, so your own bench path needs no agent edits, and an absolute in-project path such as a `${CLAUDE_SKILL_DIR}` expansion is normalised before matching. Module 10's settings-level `guard-bench.mjs` complements this for every session; the agent guard is the per-role allowlist.\n\nOne precondition: a **project** agent's frontmatter hooks run only after the workspace trust dialog for `AI-SDLC-frappe/` was accepted interactively. Start `claude` there once before the headless exercises."},
  {"heading": "run-tests is code execution, migrate is a schema change",
   "body_md": "Allowing `bench --site test.localhost run-tests` sounds harmless. It is not read-only: `run-tests --app spice_lite` imports **every** `test_*.py` in the app and runs it inside the site, with Administrator rights and a live database connection. An agent that can write a test file and run the suite can execute arbitrary Python against that site, including reading `frappe.conf`.\n\nThat is why the roster is shaped the way it is:\n\n- `test.localhost` holds **synthetic data only** (`seed_demo`, `tests/utils.py`). Never point an agent's allowlist at a site with real patients; the guard rejects any `bench` entry that does not target `--site test.localhost`, and `check-agents.mjs` fails such an entry.\n- The **tester's** write scope is tests only, and it has no migrate entry at all: it cannot change schema even with a human's help.\n- The **developer** may change DocType JSON. Frappe re-imports a DocType on `bench migrate` when its content hash changes, so new schema reaches `test.localhost` only through migrate, and the developer's migrate is an `ask`: a person sees exactly which site is migrated. Under `dontAsk` or headless the request is denied and the developer stops with `needs-human`. That is gate G1b in `workflows/README.md`.\n- The **reviewer**, **security** and **architect** agents never run `bench`; a reviewer that \"checks the change by running it\" is exercising exactly the power it should be judging.\n- `console` and `execute` are never reachable: both run arbitrary code as Administrator and commit (FRAPPE_FACTS section 10). Data changes ship as patches in `patches.txt`, reviewed like code.\n\nOne practical detail: Claude Code checks each subcommand of `cd /home/user/frappe-bench && bench ...` separately, and `.claude/settings.json` (module 10) pre-approves the `bench` part only, so the `cd` prompts unless you add an allow rule for your bench path. Under `dontAsk` that prompt is a denial.\n\nSo in practice the question for each agent is not \"may it use bench\" but \"which site, which subcommand, and who approves the ones that change state\"."},
  {"heading": "Model, effort and turn budget per role",
   "body_md": "Model choice is a cost-of-error decision.\n\n| Agent | `model` | `effort` | `maxTurns` | Why |\n|---|---|---|---|---|\n| architect | `opus` | high | 30 | a wrong \"where does it live\" decision costs every country deployment a migration |\n| security | `opus` | high | 30 | a missed permission bypass exposes PHI |\n| sre | `opus` | high | 30 | RCA juggles code, queues, logs and Postgres behaviour |\n| developer | `sonnet` | medium | 60 | many edit and `run-tests` cycles, guided by an approved plan |\n| reviewer | `sonnet` | high | 25 | frequent; the preloaded `code-review` checklist carries the rigour |\n| tester | `sonnet` | medium | 40 | pattern-following FrappeTestCase code, several suite runs |\n\n`haiku` is not used: every job needs reading across Python, DocType JSON and `hooks.py`. Aliases track the current model; pin a full id such as `claude-opus-5-5` only for reproducible evals.\n\nResolution order matters for evaluation: the per-invocation `model` on the Agent call wins, then the frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model (`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces the env model onto all subagents). Reviewer v1 has `model: inherit`; when module 09 compares it with v2, pin both to the same model (this module's exercise passes `model: \"sonnet\"` for v1), so the difference comes from prompt, tools and skills.\n\n`maxTurns` is a stop condition, not a target. A run that hits it is marked partial, and every roster body says to return `status: blocked` rather than present partial work as complete. The developer has the largest budget because a full `bench run-tests --app spice_lite` round trip, a failure, a fix and a re-run is four or five turns on its own."},
  {"heading": "Reviewer v2 and read-only handoffs",
   "body_md": "`AI-SDLC-frappe/evaluations/agent-versions/reviewer-v1.md` (module 02) has a good role sentence and three steps. Its frontmatter is `name`, `description`, `model: inherit`; everything else is inherited, and on a bench that is the problem.\n\n| Aspect | v1 | v2 (`.claude/agents/reviewer.md`) |\n|---|---|---|\n| Tools | inherits all: Edit, Write, Agent, MCP, Bash | `Read, Grep, Glob, Bash` + `disallowedTools` |\n| Bash | anything the session allows, so `bench run-tests` (project allow rule) and an attempted `migrate` | Claude Code hook: `git diff/log/show/status` only; `dontAsk` |\n| Frappe surfaces | \"including DocType JSON if changed\" | Python, DocType JSON, `patches.txt`, `hooks.py`, fixtures together; a surfaces line |\n| Standards | \"project rules in CLAUDE.md\" | cites `frappe-coding-standards.md` rule numbers |\n| Output | free text | canonical handoff, six-column findings, verdict |\n| Evidence | optional | quoted `path:line` seen in a Read; unquotable findings dropped |\n| Routing | none | `next: security` for permissions, whitelist, raw SQL, audit changes |\n| Stop / blocked | none | empty diff, >40 files, edited `patches.txt` line, `maxTurns` |\n\nThe v1 failure you will reproduce in exercise 05-reviewer-v2 is Frappe-specific: v1 **tries to run the suite and to `migrate`** to \"verify\" the change. Where the session allows it, the suite passes (the seeded defects are invisible to all 46 tests) and the green run reads as evidence. v2 cannot run either, must quote, and must say what it checked.\n\n**Who writes the handoff** follows from tools: architect, developer and tester have Write scoped to `.ai-sdlc/runs/`; reviewer, security and sre have none, so their **final message is the handoff** and the orchestrator saves it verbatim. Giving a reviewer Write \"for its report\" re-opens the door to editing the code it reviews, and `memory` would auto-enable Write and Edit, so no read-only agent sets it. `.claude/hooks/check-handoff.mjs` (module 08) validates the format; for developer and tester it also requires the quoted `Ran N tests` / `OK` lines, because `bench run-tests` exits 0 on failures unless `CI` is set."}
 ],
 "diagrams": [
  {"title": "Roster in the feature workflow: who writes which handoff, where a human decides",
   "mermaid": "sequenceDiagram\n  participant H as Human\n  participant O as Orchestrator (main thread)\n  participant A as architect\n  participant D as developer\n  participant G as tool-guard (Claude Code hook)\n  participant R as reviewer\n  participant T as tester\n  participant S as security\n  O->>A: run_id, step 02, requirement\n  A-->>O: writes 02-architect.md (needs-human: ADR)\n  O->>H: approve design? (ask rule on Agent(developer))\n  H-->>O: approved\n  O->>D: plan, run_id, step 04\n  D->>G: bench --site test.localhost migrate\n  G-->>H: permissionDecision ask\n  H-->>D: approve for test.localhost\n  D-->>O: writes 04-developer.md with Ran N tests OK\n  O->>R: review main...HEAD\n  R-->>O: final message is the handoff (no Write)\n  O->>T: criteria and diff\n  T-->>O: writes 06-tester.md\n  O->>S: changed files\n  S-->>O: final message is the handoff, next human\n  O->>H: run report and PR for approval"},
  {"title": "Layers a developer Bash call passes through",
   "mermaid": "flowchart TD\n  C[\"developer Bash call\"] --> T{\"Bash in tools?\"}\n  T -->|\"no\"| X1[\"tool not available\"]\n  T -->|\"yes\"| AD{\"tool-guard always-deny?<br/>console, execute, show-config, site_config.json, push\"}\n  AD -->|\"match\"| X2[\"exit 2, reason shown to agent\"]\n  AD -->|\"no\"| AL{\"agent allowlist entry?\"}\n  AL -->|\"none\"| X2\n  AL -->|\"ask entry: migrate\"| ASK[\"permissionDecision ask\"]\n  AL -->|\"plain or patterned\"| P{\"settings permissions<br/>deny, ask, allow\"}\n  ASK --> M\n  P -->|\"deny\"| X3[\"denied\"]\n  P -->|\"allow: run-tests on test.localhost\"| RUN[\"command runs\"]\n  P -->|\"ask or no match\"| M{\"permissionMode\"}\n  M -->|\"dontAsk\"| X4[\"auto-denied, listed in permission_denials\"]\n  M -->|\"default or acceptEdits\"| HU[\"human prompt\"]\n  HU -->|\"approve\"| RUN\n  HU -->|\"reject\"| X3"}
 ],
 "comparisonTables": [
  {"title": "Roster frontmatter at a glance",
   "columns": ["Agent", "tools", "disallowedTools", "permissionMode", "Claude Code hook scope", "skills", "Writes handoff itself?"],
   "rows": [
    ["architect", "Read, Grep, Glob, Write", "Agent, Bash, Edit, NotebookEdit, WebFetch, WebSearch", "acceptEdits", "write: `docs/adr/`, `.ai-sdlc/runs/`; ADR template and ADR-0001 protected", "architecture-review", "yes"],
    ["developer", "Read, Grep, Glob, Edit, Write, Bash", "Agent, NotebookEdit, WebFetch, WebSearch", "acceptEdits", "write: `sample-app/spice_lite/spice_lite/`, run folder, not `patches/v0_1/`; bash: `cd {bench}`, `run-tests` on test.localhost, `?migrate`, unit tests, run-tests scripts, read-only git", "run-tests", "yes"],
    ["reviewer", "Read, Grep, Glob, Bash", "Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch", "dontAsk", "bash: `git diff|log|show|status` (no bench at all)", "code-review", "no, final message"],
    ["tester", "Read, Grep, Glob, Edit, Write, Bash", "Agent, NotebookEdit, WebFetch, WebSearch", "acceptEdits", "write: `tests/`, `**/doctype/*/test_*.py`, run folder; bash: as developer without migrate", "test-strategy, run-tests", "yes"],
    ["security", "Read, Grep, Glob", "Agent, Bash, Edit, Write, NotebookEdit, WebFetch, WebSearch", "dontAsk", "none needed (no Bash, no Write)", "security-review", "no, final message"],
    ["sre", "Read, Grep, Glob, Bash", "Agent, Edit, Write, NotebookEdit, WebFetch, WebSearch", "inherit (prompts in default)", "bash: `bench doctor`, `show-pending-jobs`, `ls|tail|grep` inside bench `logs/`, skill scripts, read-only git", "performance-review, production-rca", "no, final message"]
   ]},
  {"title": "Which bench commands each agent can reach",
   "columns": ["Command", "architect", "developer", "reviewer", "tester", "security", "sre", "Enforced by"],
   "rows": [
    ["`bench --site test.localhost run-tests ...`", "no", "yes", "no", "yes", "no", "no", "tool-guard allowlist + settings allow rule"],
    ["`python -m unittest discover -s spice_lite/tests/unit -t .`", "no", "yes", "no", "yes", "no", "no", "tool-guard allowlist + settings allow rule"],
    ["`bench --site test.localhost migrate`", "no", "ask (human)", "no", "no", "no", "no", "tool-guard `?` entry returns ask; settings `ask` rule"],
    ["`bench --site test.localhost doctor`, `show-pending-jobs`", "no", "no", "no", "no", "no", "yes (prompts in default)", "tool-guard allowlist"],
    ["`tail`/`grep` on `<bench>/logs/*.log`", "no", "no", "no", "no", "no", "yes, paths inside `logs/` only", "tool-guard patterned entries"],
    ["`console`, `execute`, `mariadb`/`postgres`, `show-config`", "no", "no", "no", "no", "no", "no", "tool-guard always-deny (exit 2); settings `ask` for console/execute"],
    ["`drop-site`, `reinstall`, `set-admin-password`", "no", "no", "no", "no", "no", "no", "tool-guard always-deny; settings `deny`"],
    ["anything on another site (`--site mariadb.localhost`)", "no", "no", "no", "no", "no", "no", "allowlist targets test.localhost only; check-agents fails other sites"]
   ]},
  {"title": "Reviewer v1 vs v2 on the seeded country-roster diff (what to look for)",
   "columns": ["Check", "v1 typical", "v2 expected"],
   "rows": [
    ["Runs bench during review", "attempts `run-tests` (a green suite proves nothing here) and `migrate`", "cannot: its Claude Code hook allows git only"],
    ["Tries to migrate", "often, denied under dontAsk", "cannot"],
    ["SQL injection in f-string", "usually found, no location", "REV-001 critical, `fhir.py:195-197`, quoted"],
    ["Raw SQL skips permissions", "often missed", "REV-002 critical, cites rule 2"],
    ["MRNs passed to `log_access`", "sometimes", "REV-003 high"],
    ["Clinician `delete: 1` in DocType JSON", "\"looks unintended\"", "REV-004 high, business rule 5, `next: security`"],
    ["Missing tests", "rarely", "REV-005 high"],
    ["Verdict", "\"fine to merge\" after fixes", "`Verdict: BLOCK.`, never a merge approval"]
   ]}
 ],
 "exercises": [
  {"id": "05-roster-smoke-test",
   "title": "Create the roster files and smoke-test each agent",
   "objective": "Create five of the six roster agents (architect, developer, tester, security, sre; the reviewer is exercise 05-reviewer-v2) with their Agent Contracts, prove each loads with its own system prompt using `claude -p --agent <name>`, and run the architect on a real spice_lite requirement: SPICE-212, a country roster of active patients with encounter counts, where the naive implementation would repeat the `lastn()` N+1.",
   "startingFiles": [
    {"path": R + ".ai-sdlc/runs/2026-09-30-feat-country-roster/01-requirements.md", "content": REQS}
   ],
   "requiredStructure": "AI-SDLC-frappe/\n├── .claude/agents/\n│   ├── architect.md      # opus, Read/Grep/Glob/Write, write-scope Claude Code hook, skills: architecture-review\n│   ├── developer.md      # sonnet, + Edit/Bash, write-scope + bash-allow (run-tests, ?migrate), skills: run-tests\n│   ├── tester.md         # sonnet, tests-only write scope, run-tests, skills: test-strategy, run-tests\n│   ├── security.md       # opus, Read/Grep/Glob only, dontAsk, skills: security-review\n│   └── sre.md            # opus, bench doctor + log reads, skills: performance-review, production-rca\n├── agents/\n│   ├── tool-guard.mjs    # from exercise 05-tool-guards-and-denials (the Claude Code hooks call it)\n│   └── <agent>/CONTRACT.md   # eleven sections + \"Frappe surfaces:\" line, from agents/CONTRACT_TEMPLATE.md\n└── .ai-sdlc/runs/2026-09-30-feat-country-roster/\n    ├── 01-requirements.md   # starting file\n    └── 02-architect.md      # written by the architect",
   "implementation": [
    {"path": R + ".claude/agents/architect.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + ".claude/agents/developer.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + ".claude/agents/tester.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + ".claude/agents/security.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + ".claude/agents/sre.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + "agents/architect/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "agents/developer/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "agents/tester/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "agents/security/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "agents/sre/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\n# 0. Once, interactively: start `claude` here and accept the workspace trust dialog (frontmatter Claude Code hooks need it).\n# 1. Smoke test: each agent answers from its own system prompt, no tools.\nfor a in architect developer tester security sre; do\n  claude -p --agent \"$a\" --max-turns 2 --output-format json \\\n    \"Smoke test. Without using any tool: in one sentence state your job and which bench commands you may run, then give the exact path pattern of your handoff.\" \\\n  | jq -r --arg a \"$a\" '\"\\($a): \\(.subtype) turns=\\(.num_turns) | \\(.result | gsub(\"\\n\"; \" \"))\"'\ndone\n\n# 2. Real task for the architect (interactive alternative: type @agent-architect in a session).\nclaude -p --agent architect --output-format json \\\n  \"Run id 2026-09-30-feat-country-roster, step 02. Requirement: .ai-sdlc/runs/2026-09-30-feat-country-roster/01-requirements.md\" \\\n  | jq '{subtype, num_turns, total_cost_usd}'\nnode .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-country-roster",
   "expectedOutput": "architect: success turns=1 | I turn a requirement into options, a where-it-lives decision (core, country app or integration app) and a proposed ADR for spice_lite; I run no bench commands. Handoff: .ai-sdlc/runs/<run-id>/<step>-architect.md\ndeveloper: success turns=1 | I implement an approved plan in spice_lite with tests; I may run bench --site test.localhost run-tests and the unit tests, and migrate only after a human approves the prompt; never console or execute. Handoff: .ai-sdlc/runs/<run-id>/<step>-developer.md\ntester: success turns=1 | I derive and write the missing FrappeTestCase and unit tests and run bench --site test.localhost run-tests; I cannot migrate or edit production code. Handoff: .ai-sdlc/runs/<run-id>/<step>-tester.md\nsecurity: success turns=1 | I review whitelisted methods, permissions, SQL, PHI and secrets and return findings; I run no commands at all. My final message is the handoff, saved to .ai-sdlc/runs/<run-id>/<step>-security.md\nsre: success turns=1 | I find the root cause of latency, errors or queue backlogs from code, bench logs and read-only bench doctor / show-pending-jobs, and propose fixes. My final message is the handoff, saved to .ai-sdlc/runs/<run-id>/<step>-sre.md\n\n{ \"subtype\": \"success\", \"num_turns\": 11, \"total_cost_usd\": 0.52 }\nPASS  .ai-sdlc/runs/2026-09-30-feat-country-roster/01-requirements.md\nPASS  .ai-sdlc/runs/2026-09-30-feat-country-roster/02-architect.md\n\n$ cat .ai-sdlc/runs/2026-09-30-feat-country-roster/02-architect.md\n" + ARCH_HANDOFF,
   "testCases": [
    {"name": "All five agents load with their own prompt", "input": "The smoke-test loop in exampleInput", "expected": "Five lines with `success`; each names its own handoff path and its own bench limits. A generic answer (\"I am Claude Code\") means the file did not load: check the `name` field and restart the session if `.claude/agents/` was just created."},
    {"name": "Architect wrote only an ADR and its handoff", "input": "git status --short sample-app docs/adr; ls .ai-sdlc/runs/2026-09-30-feat-country-roster", "expected": "No change under `sample-app`; one new `docs/adr/0002-*.md`; the run folder lists `01-requirements.md` and `02-architect.md`."},
    {"name": "Handoff passes the workflow validator", "input": "node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-country-roster", "expected": "Two PASS lines, exit 0."},
    {"name": "Architect saw the N+1 trap and the real index", "input": "grep -cE 'fhir.py:15[5-6]|sl_encounter.json:23' .ai-sdlc/runs/2026-09-30-feat-country-roster/02-architect.md", "expected": "1 or more: a finding cites the `TEACHING-DEFECT(perf-n+1)` loop in `lastn()` or the `search_index` on `SL Encounter.patient`."},
    {"name": "The proposed grouped count is real Frappe v15", "input": "In a scratch test on test.localhost (as the course build did): frappe.set_user(CLINICIAN); frappe.get_list(\"SL Encounter\", fields=[\"patient\", \"count(name) as encounters\"], filters={\"patient\": (\"in\", [p, q])}, group_by=\"patient\"), then the same call as NO_ROLE_USER", "expected": "Clinician: `[(p, 3), (q, 1)]` for 3 and 1 encounters. No-role user: `frappe.PermissionError`. So the recommendation is both one query and permission-aware."},
    {"name": "Contracts are valid", "input": "node docs/foundations/validate-contract.mjs agents/{architect,developer,tester,security,sre}/CONTRACT.md", "expected": "Five `OK ... 11/11 contract sections` lines, no warnings, exit 0."},
    {"name": "Security agent cannot run bench", "input": "claude -p --agent security --output-format json \"Run bench --site test.localhost list-apps and paste the output.\" | jq -r .result", "expected": "The agent states it has no shell tool; no command output appears."}
   ],
   "evaluationCriteria": [
    "Every frontmatter key is in the documented subagent field list; no skill-style hyphenated keys.",
    "Each `description` names when to delegate and the agent's hard bench limit (never runs bench, migrate only with a human, read-only diagnostics).",
    "Model and effort choices are justified by cost of error in the contract or the module text.",
    "Every body names the bench location, context files by path, a numbered procedure, the exact handoff template, stop conditions and blocked behaviour.",
    "No roster agent lists `Agent` in `tools`; all six list it in `disallowedTools`.",
    "The architect handoff answers where the change lives (core, country app, integration app), cites `path:line`, and rejects at least one option with a concrete reason."
   ],
   "improvements": [
    "Add `isolation: worktree` to the developer so each implementation runs in a temporary git worktree; the bench still points at the main checkout, so document which tree `run-tests` exercises.",
    "Give the sre agent `mcpServers` for the read-only spice_lite MCP server of module 06 instead of raw log reads.",
    "Pin `model: claude-opus-5-5` on security for reproducible evals and keep the `opus` alias on the architect.",
    "Add `initialPrompt` to the architect so `claude --agent architect` starts by listing open runs in `.ai-sdlc/runs/`."
   ]},
  {"id": "05-reviewer-v2",
   "title": "Reviewer v2: tighten, structure and compare against v1 on a verified Frappe diff",
   "objective": "Turn the module 02 reviewer (`evaluations/agent-versions/reviewer-v1.md`) into `.claude/agents/reviewer.md` v2 with an explicit tool allowlist, a git-only Bash Claude Code hook, `dontAsk`, the preloaded `code-review` skill, the canonical handoff and Frappe routing rules. Prove the seeded diff `agents/reviewer/fixtures/country-roster.patch` really contains its defects on the bench, then run both reviewer versions on it and record the differences module 09 will measure.",
   "startingFiles": [
    {"path": R + "agents/reviewer/fixtures/country-roster.patch", "content": ""},
    {"path": R + "agents/reviewer/fixtures/test_country_roster_defects.py", "content": ""},
    {"path": R + "agents/reviewer/fixtures/verify-fixture.sh", "content": ""}
   ],
   "requiredStructure": "AI-SDLC-frappe/\n├── .claude/agents/reviewer.md                     # v2: tools, disallowedTools, dontAsk, git-only bash-allow, skills: code-review\n├── agents/reviewer/\n│   ├── CONTRACT.md                                # final contract (draft: docs/foundations/reviewer-contract-draft.md)\n│   └── fixtures/\n│       ├── country-roster.patch                   # EXERCISE-DEFECT(module 05), patch -p1 from AI-SDLC-frappe/\n│       ├── test_country_roster_defects.py         # one proof per seeded defect (copied in only while patched)\n│       ├── verify-fixture.sh                      # apply, prove, revert; --scratch-site for the DocType JSON change\n│       └── verify-fixture.expected.txt            # real output from the course build\n└── evaluations/agent-versions/reviewer-v1.md      # unchanged v1 snapshot from module 02",
   "implementation": [
    {"path": R + ".claude/agents/reviewer.md", "language": "markdown", "content": "", "tag": "verified-format"},
    {"path": R + "agents/reviewer/CONTRACT.md", "language": "markdown", "content": "", "tag": "illustrative"},
    {"path": R + "agents/reviewer/fixtures/verify-fixture.expected.txt", "language": "plaintext", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\n# 1. Prove the seeded defects are real (as the bench user; applies the patch, tests, reverts).\n#    --scratch-site also migrates the DocType JSON change on a throw-away site and drops it again.\nagents/reviewer/fixtures/verify-fixture.sh --scratch-site\n\n# 2. Apply the diff for review (the verify script reverted it).\ngit switch -c exercise/country-roster\npatch -p1 < agents/reviewer/fixtures/country-roster.patch\n\n# 3. v2 (the project agent) headless; save the handoff it returns.\n#    Interactive alternative that runs it as a real subagent: @agent-reviewer review the working tree against HEAD\nmkdir -p .ai-sdlc/runs/2026-09-30-feat-country-roster-review\nclaude -p --agent reviewer --permission-mode dontAsk --output-format json \\\n  \"Run id 2026-09-30-feat-country-roster-review, step 03. Review the working tree against HEAD.\" > /tmp/rev-v2.json\njq -r .result /tmp/rev-v2.json > .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md\nnode .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md\n\n# 4. v1 from its snapshot via --agents JSON, same model and mode as v2\nclaude -p --permission-mode dontAsk --output-format json --agents \"$(node -e '\n  const t=require(\"fs\").readFileSync(\"evaluations/agent-versions/reviewer-v1.md\",\"utf8\");\n  const [,fm,body]=t.split(/^---$/m);\n  const d=/description: (.*)/.exec(fm)[1];\n  console.log(JSON.stringify({\"reviewer-v1\":{description:d,prompt:body.trim(),model:\"sonnet\"}}))')\" \\\n  \"Use the reviewer-v1 agent to review the working tree against HEAD.\" > /tmp/rev-v1.json\njq -r .result /tmp/rev-v1.json\njq -c '.permission_denials | map({tool_name, cmd: .tool_input.command, file: .tool_input.file_path})' /tmp/rev-v1.json\n\n# 5. Clean up\npatch -p1 -R < agents/reviewer/fixtures/country-roster.patch && git switch -",
   "expectedOutput": "$ agents/reviewer/fixtures/verify-fixture.sh --scratch-site   (real output, course build)\n" + VERIFY_OUT + "\n\n$ node .claude/hooks/check-handoff.mjs .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md\nPASS  .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md\n\n$ cat .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md\n" + REVIEW_V2 + "\n\n--- v1 (typical result on the same diff) ---\n" + REVIEW_V1_TYPICAL + "\n\n$ jq -c '.permission_denials | map({tool_name, cmd: .tool_input.command, file: .tool_input.file_path})' /tmp/rev-v1.json\n[{\"tool_name\":\"Bash\",\"cmd\":\"cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite\",\"file\":null},{\"tool_name\":\"Bash\",\"cmd\":\"cd /home/user/frappe-bench && bench --site test.localhost migrate\",\"file\":null}]\n(v1 inherits Bash, so during a review it tried to execute code on the bench and to migrate the site; only dontAsk and the settings rules stopped it. In a default or acceptEdits session the run-tests would have run, 46 tests would have passed, and the green suite would have read as evidence although the seeded defects are invisible to it. v2 cannot attempt either: its Claude Code hook allows git only.)",
   "testCases": [
    {"name": "The defects are real, not asserted", "input": "agents/reviewer/fixtures/verify-fixture.sh --scratch-site", "expected": "The existing suite still says `Ran 46 tests` / `OK` with the patch applied; six `test_rev_*` proofs `ok` (the seventh skips on test.localhost); on the scratch site `test_clinician_can_create_but_not_delete ... FAIL` and the delete-permission proof `ok`; last lines `dropped scratch-reviewer.localhost` and `reverted country-roster.patch`."},
    {"name": "The app is left clean", "input": "git status --short sample-app; ls <bench>/sites", "expected": "No output from git status; no `scratch-reviewer.localhost` folder under `sites/`."},
    {"name": "v2 reports the seeded defects", "input": "grep -E '^\\| REV-' .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md | awk -F'|' '{print $3,$4}'", "expected": "At least: `critical security` (f-string SQL), `critical security` or `high security` (raw SQL without has_permission), `high security` (MRNs to log_access), `high correctness` or `high security` (Clinician delete), `high testing`, `medium performance` (count per row)."},
    {"name": "v2 routed to security", "input": "grep -m1 '^next:' .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md; grep -m1 '^Verdict:' .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md", "expected": "`next: security` and `Verdict: BLOCK.`"},
    {"name": "v2 ran no bench and edited nothing", "input": "jq '.permission_denials | length' /tmp/rev-v2.json; git diff --stat -- sample-app | tail -1", "expected": "`0`, and `2 files changed, 18 insertions(+)`: exactly the patch."},
    {"name": "Every category is accounted for", "input": "sed -n '/^## Decisions/,/^## Open/p' .ai-sdlc/runs/2026-09-30-feat-country-roster-review/03-reviewer.md | grep -cE '^- (correctness|security|design|testing|performance|standards|readability|docs):'", "expected": "8"},
    {"name": "Contract and runtime agree", "input": "node agents/check-agents.mjs | grep reviewer", "expected": "`PASS  reviewer     model=sonnet mode=dontAsk tools=Read,Grep,Glob,Bash skills=code-review`"}
   ],
   "evaluationCriteria": [
    "v2 lists `tools` and `disallowedTools`; v1's inherited Edit, Write, Agent and unrestricted Bash are gone.",
    "The Bash Claude Code hook allows git only, so the project allow rule for `run-tests` does not reach the reviewer.",
    "Every v2 finding has a `path:line` that exists after the patch and a verbatim quote; the DocType JSON finding cites `sl_patient.json:95`.",
    "Severities match `context/security/phi-and-secrets-policy.md` (PHI to a user with no role is critical) and the `code-review` skill.",
    "The handoff validates with `.claude/hooks/check-handoff.mjs`, routes `next: security`, and is returned as the final message.",
    "The write-up names at least three v1-to-v2 differences and the module 09 metric each one moves (recall, precision, tool violations)."
   ],
   "improvements": [
    "Add the country-roster patch as a golden task in `evaluations/` (module 09 owns the dataset) with its eight expected findings and `next: security`.",
    "Emit `--json-schema` structured output in headless runs so the eval harness does not parse Markdown tables.",
    "Extend the fixture with an edited existing `patches.txt` line and check that v2 returns `status: needs-human`."
   ]},
  {"id": "05-tool-guards-and-denials",
   "title": "Scope bench commands per agent, and prove a denial",
   "objective": "Write the agent-scoped PreToolUse Claude Code hook `agents/tool-guard.mjs` with write scopes, bench allowlists, an `ask` decision for migrate, path-scoped log reads and an always-deny list; test it offline with real hook input JSON; then prove headless that the developer's migrate request never runs unattended (it is denied under `dontAsk` and listed in `permission_denials`) and that `bench console` is blocked outright.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC-frappe/agents/\n├── tool-guard.mjs        # write-scope <prefix|glob>... [!protected]; bash-allow <plain|?ask|patterned>...\n└── tool-guard.test.mjs   # node --test; in-process checks + the hook spawned with JSON on stdin\n\nReferenced from frontmatter, e.g. .claude/agents/developer.md:\nhooks:\n  PreToolUse:\n    - matcher: \"Bash\"\n      hooks:\n        - type: command\n          command: \"node \\\"${CLAUDE_PROJECT_DIR}/agents/tool-guard.mjs\\\" bash-allow 'cd {bench}' 'bench --site test.localhost run-tests' '?bench --site test.localhost migrate' ...\"",
   "implementation": [
    {"path": R + "agents/tool-guard.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": R + "agents/tool-guard.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\n# 1. Offline: the Claude Code hook itself (no model needed)\nnode --test agents/tool-guard.test.mjs\n" + demo_console_cmd + "\n" + demo_migrate_cmd + "\n" + demo_write_cmd + "\n" + demo_log_cmd + "\n\n# 2. Live: the developer is asked to migrate; the guard answers ask, dontAsk turns that into a denial\nclaude -p --agent developer --permission-mode dontAsk --max-turns 4 --output-format json \\\n  \"Run exactly: cd /home/user/frappe-bench && bench --site test.localhost migrate . Report whether it ran. Do not run anything else.\" \\\n  | jq '{subtype, is_error, num_turns, permission_denials}'\n\n# 3. Live: console is blocked by the Claude Code hook itself (exit 2), whatever the mode\nclaude -p --agent developer --permission-mode acceptEdits --max-turns 3 --output-format json \\\n  \"Open bench --site test.localhost console and count SL Patient rows.\" | jq -r .result",
   "expectedOutput": "# 1. offline (real output)\n" + tg_summary + "\n" + demo_console_out + "\n" + demo_migrate_out + "\n" + demo_write_out + "\n" + demo_log_out + "\n\n# 2. headless run (shape per the Agent SDK result message; ids differ per run)\n{\n  \"subtype\": \"success\",\n  \"is_error\": false,\n  \"num_turns\": 3,\n  \"permission_denials\": [\n    {\n      \"tool_name\": \"Bash\",\n      \"tool_use_id\": \"toolu_01Hc7Wq2Lm9Xr4\",\n      \"tool_input\": {\n        \"command\": \"cd /home/user/frappe-bench && bench --site test.localhost migrate\",\n        \"description\": \"Migrate the test site\"\n      }\n    }\n  ]\n}\n\n# 3. console request\nI could not open the console: the tool-guard Claude Code hook blocked `bench --site test.localhost console` (bench console/execute are never allowed for any roster agent). Counting SL Patient rows needs a test or a report, not a console session; stopping here with status: blocked.",
   "testCases": [
    {"name": "Guard unit tests pass", "input": "node --test agents/tool-guard.test.mjs", "expected": "`# pass 10`, `# fail 0`, exit 0."},
    {"name": "Console is blocked with exit 2 and a reason", "input": "The first printf pipeline in exampleInput", "expected": "stderr `tool-guard [developer] blocked Bash: \"bench console/execute/db shells, ...\" is never allowed for any roster agent ...` and `exit=2`."},
    {"name": "Migrate becomes an ask, never an allow", "input": "The second printf pipeline in exampleInput", "expected": "One JSON line with `\"permissionDecision\":\"ask\"` and `exit=0`: the call is neither blocked nor auto-allowed; the permission layer asks a human."},
    {"name": "Architect cannot write application code", "input": "The third printf pipeline in exampleInput", "expected": "`... is outside this agent's write scope: docs/adr/, .ai-sdlc/runs/` and `exit=2`."},
    {"name": "Log reads cannot escape to site_config.json", "input": "The fourth printf pipeline in exampleInput", "expected": "A message naming `reading site_config.json or common_site_config.json` and `exit=2`, although the path starts inside `logs/`."},
    {"name": "Your own bench path works without editing agents", "input": "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"tail -n 20 /opt/bench/spice/logs/worker.log\"}}' | SPICE_BENCH_DIR=/opt/bench/spice node agents/tool-guard.mjs bash-allow 'tail {bench}/logs/**'; echo $?", "expected": "`0`"},
    {"name": "Denial is visible headless", "input": "Step 2 of exampleInput", "expected": "`permission_denials` has one `Bash` entry whose command contains `bench --site test.localhost migrate`; `result` says it was not permitted and the developer stops with `needs-human`."}
   ],
   "evaluationCriteria": [
    "The guard blocks with exit code 2 (exit 1 would not block) and writes an actionable reason to stderr; ask entries return the documented `permissionDecision: \"ask\"` JSON with exit 0.",
    "It fails closed on malformed JSON, unknown modes and unbalanced quotes.",
    "Path checks resolve `..` and absolute paths against `CLAUDE_PROJECT_DIR` (write scope) or the entry directory (log reads) before matching.",
    "Chaining (`;`, `||`, backticks, `$(`, `${`, redirects, `&`) is rejected; only `&&`, `|` between allowed commands and `2>&1` pass.",
    "The learner can explain why `disallowedTools: Bash(bench --site * console)` was not used, and why run-tests is still code execution on the test site."
   ],
   "improvements": [
    "Log every block and ask to `.ai-sdlc/guard.log` (command names and agent only) and add a `PermissionDenied` Claude Code hook in settings to collect permission-layer denials in the same file.",
    "Verify, on your Claude Code version, what a hook `ask` does when the parent session runs in `bypassPermissions`; the always-deny list is the part that holds in every mode.",
    "Replace prefix matching with bench-aware parsing shared with module 10's `guard-bench.mjs`, so `bench --verbose --site=test.localhost run-tests` matches the same entry."
   ]},
  {"id": "05-contract-conformance",
   "title": "Write and run a contract-conformance check for the roster",
   "objective": "Write `agents/check-agents.mjs`, a zero-dependency Node script that parses every `.claude/agents/*.md` and fails when a key is undocumented, a roster agent can delegate, a `disallowedTools` specifier would remove a whole tool, `memory` would give a read-only agent Write, a preloaded skill is missing or not preloadable, a Claude Code hook event does not exist, an agent has Bash or Write without its guard, a bench allowlist entry grants console or execute, auto-allows migrate or targets another site, or the tools, permissionMode or guard modes differ from the agent's CONTRACT.md. It also emits the module's agentContracts JSON. Run it on the real roster and on deliberately broken copies.",
   "startingFiles": [],
   "requiredStructure": "AI-SDLC-frappe/agents/\n├── check-agents.mjs        # node agents/check-agents.mjs [--root DIR] [--json | --contracts-json]; exit 0/1/2\n└── check-agents.test.mjs   # node --test; copies the roster to a temp dir and breaks one thing per test",
   "implementation": [
    {"path": R + "agents/check-agents.mjs", "language": "javascript", "content": "", "tag": "illustrative"},
    {"path": R + "agents/check-agents.test.mjs", "language": "javascript", "content": "", "tag": "illustrative"}
   ],
   "exampleInput": "cd AI-SDLC-frappe\nnode agents/check-agents.mjs; echo \"exit=$?\"\nnode --test agents/check-agents.test.mjs\n\n# Break a copy on purpose: the classic disallowedTools mistake, and a migrate that no longer asks\nrm -rf /tmp/roster && mkdir -p /tmp/roster && cp -r .claude agents /tmp/roster/\nsed -i -e 's/^disallowedTools: Agent, NotebookEdit, WebFetch, WebSearch$/&, Bash(git push *)/' \\\n       -e \"s/'?bench --site test.localhost migrate'/'bench --site test.localhost migrate'/\" /tmp/roster/.claude/agents/developer.md\nnode agents/check-agents.mjs --root /tmp/roster; echo \"exit=$?\"\n\n# The agentContracts array this module embeds\nnode agents/check-agents.mjs --contracts-json | jq '.[].agent'",
   "expectedOutput": "# real output at build time\n" + check_out.strip() + "\nexit=0\n\n" + ca_summary + "\n\n# the broken copy (real output)\n" + broken_lines + "\nexit=1\n\n\"architect\"\n\"developer\"\n\"reviewer\"\n\"tester\"\n\"security\"\n\"sre\"",
   "testCases": [
    {"name": "Shipped roster conforms", "input": "node agents/check-agents.mjs; echo $?", "expected": "Six `PASS` roster lines (plus the orchestrator once module 08 adds it) and `0`. Warnings about canonical skills not yet on disk are allowed; errors are not."},
    {"name": "Checker tests pass", "input": "node --test agents/check-agents.test.mjs", "expected": "`# pass 14`, `# fail 0`."},
    {"name": "Skill-style key is caught", "input": "Add `allowed-tools: Read` under `tools:` in a copy of `.claude/agents/reviewer.md` and run the checker with `--root`", "expected": "`error: frontmatter key \"allowed-tools\" is not a documented subagent field (subagents use `tools` (allowed-tools is SKILL.md syntax)); unknown keys are silently ignored` and exit 1."},
    {"name": "A console grant is caught", "input": "Add `'bench --site test.localhost console'` to the developer's bash-allow entries in a copy and run the checker with `--root`", "expected": "`error: bash-allow entry \"bench --site test.localhost console\" grants \"bench console/execute/db shells, ...\"` and exit 1."},
    {"name": "Contracts JSON equals the validator's", "input": "for a in architect developer reviewer tester security sre; do diff <(node agents/check-agents.mjs --contracts-json | jq \".[] | select(.agent==\\\"$a\\\")\") <(node docs/foundations/validate-contract.mjs --json agents/$a/CONTRACT.md | jq .) && echo same $a; done", "expected": "Six `same <agent>` lines: the module's agentContracts come from the same parse as module 01's validator."},
    {"name": "Machine-readable mode", "input": "node agents/check-agents.mjs --json | jq '.ok, (.results | length)'", "expected": "`true` and `7` (the six roster agents plus the orchestrator from module 08)."}
   ],
   "evaluationCriteria": [
    "Zero dependencies; runs on Node 22 with `node agents/check-agents.mjs` from `AI-SDLC-frappe/`.",
    "The documented-key list matches `build/CLAUDE_CODE_FACTS.md` section 1 exactly.",
    "Bench rules reuse the guard's own always-deny list and entry parser, so checker and guard cannot disagree.",
    "Every rule has a failing test built from a real agent file, not a synthetic string.",
    "Exit codes distinguish failures (1) from usage errors (2), so CI can gate on it."
   ],
   "improvements": [
    "Run the checker in CI and as a `ConfigChange` Claude Code hook with matcher `project_settings` so edits to agent files are checked on save (module 10-governance).",
    "Also compare `model`, `effort` and `maxTurns` with the values stated in each CONTRACT.md permissions paragraph.",
    "Spawn each Claude Code hook command with a sample input instead of only parsing it, so a broken quote in frontmatter fails the check."
   ]}
 ],
 "agentContracts": contracts,
 "checklist": [
  "`.claude/agents/` contains architect, developer, reviewer, tester, security and sre, each with `name` equal to the file name.",
  "`node agents/check-agents.mjs` prints six roster `PASS` lines and exits 0.",
  "`node --test agents/tool-guard.test.mjs agents/check-agents.test.mjs` passes (24 tests).",
  "`node docs/foundations/validate-contract.mjs agents/*/CONTRACT.md` prints `OK` for all six roster contracts without warnings.",
  "No roster agent lists `Agent` in `tools`; every one lists it in `disallowedTools`; no `disallowedTools` entry has a `Bash(...)` specifier.",
  "Only developer and tester can reach `bench --site test.localhost run-tests`; only the developer can request migrate, and only through an `ask`.",
  "No agent can reach `bench console`, `execute`, a DB shell, `show-config` or `site_config.json`: piping such a command into any agent's guard exits 2.",
  "reviewer and security have no Write, Edit or `memory`; their handoff is their final message.",
  "`agents/reviewer/fixtures/verify-fixture.sh` proves the seeded defects, then leaves `git status --short sample-app` empty and no scratch site behind.",
  "Reviewer v2 on the country-roster diff returns a handoff that passes `.claude/hooks/check-handoff.mjs` with `Verdict: BLOCK.` and `next: security`.",
  "`bench --site test.localhost run-tests --app spice_lite` still passes after the exercise patch is reverted (Ran 46 tests, OK)."
 ]
}

for x in mod["exercises"]:
    for i in x["implementation"]:
        i["content"] = f(i["path"])
    for s in x["startingFiles"]:
        if s["content"] == "":
            s["content"] = f(s["path"])
out = ROOT / "content-frappe/modules/05-agent-roster.json"
out.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + "\n")
print("wrote", out)
