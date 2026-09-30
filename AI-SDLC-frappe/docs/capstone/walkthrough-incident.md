# Walkthrough: one incident through the whole system

Incident: **INC-2026-0922-01** on the Kenya country site `ke.spice.example`. From 08:00 UTC on 2026-09-22, 20 ward tablets at Clinic KE-C-017 each called `spice_lite.api.fhir.lastn` with 100 subjects every 30 s. `lastn` costs two queries per subject and reads every matching observation (`TEACHING-DEFECT(perf-n+1)`), and those patients had just been given about 423 heart-rate readings each. Every call held one of the site's 9 sync gunicorn workers for 14 s to over 120 s, so desk, login and every integration returned 504 or 502, and the telephony reminder job on the `default` RQ queue timed out every five minutes. Evidence pack (synthetic, no PHI): `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` (module 04). The committed handoffs of this run are in [example-runs/incident-lastn-ward-board/](example-runs/incident-lastn-ward-board/).

The rule of this workflow (`workflows/incident-response.md`): **no agent changes a production site**. Agents read, reason and recommend; a human executes every mitigation, and the sre cannot even reach the country site: its guard allows read-only diagnostics on `test.localhost` only, so production evidence arrives as redacted exports a human pastes.

## 0. Before the run

```bash
cd AI-SDLC-frappe
node scripts/capstone/verify-system.mjs | grep -E "sre|incident"
```

Look at the sre rows. `agent-skills` says the sre preloads `performance-review` and `production-rca`. `guard-reach` says that `production-rca`'s `build-timeline.mjs` (the PHI guard over the evidence, step 1 of the skill) and `performance-review`'s `count-queries.mjs` pass the sre's real `tool-guard.mjs` in the `${CLAUDE_SKILL_DIR}`-expanded form Claude Code runs them in. If they did not, the `PreToolUse` Claude Code hook would block the first command of the RCA with exit 2. Fix that before an incident, not during one.

The same check used to report one WARN on the sre: `performance-review` pre-approved `bench --site test.localhost run-tests *` for its query-count test, and the sre's guard blocks it. The skill no longer pre-approves `bench`; it puts a query-count test request in the handoff and the tester runs it. In an incident the sre counts statement shapes in the Postgres log with `count-queries.mjs` instead, so a measured query count always comes from the tester or from the bug-fix run, never from the sre. `verify-system` now reports 0 warnings.

## 1. Start and enter

```bash
claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default
```

```text
/incident INC-2026-0922-01 502/504 on every endpoint of ke.spice.example since about 08:04 UTC, desk and login time out, restart at 08:12 helped for three minutes
```

The `incident` skill (`disable-model-invocation: true`) registers the `SubagentStop` handoff Claude Code hook, injects today's date, and routes the orchestrator to `workflows/incident-response.md`.

## 2. Step by step

| # | Who runs | What happens | Gate or control that fires | Handoff |
|---|---|---|---|---|
| 01 | orchestrator | brief: symptom, start, detection 08:09, site and country, one gunicorn pool of 9, `default` backlog, the 08:12 restart, CHG-5102, CHG-5104, CHG-5103 as reported; the patient named in the on-call report (name and MRN) removed | PHI rule (CLAUDE.md rule 1); `block-secrets.mjs` on the Write | `01-incident-brief.md` |
| 02 + 03 | `sre` (opus, preloads `performance-review`, `production-rca`) and `security` (opus, `dontAsk`, preloads `security-review`) in the same turn | sre: `build-timeline.mjs` exit 0 (125 events, no PHI), `count-queries.mjs` marks the `lastn` per-subject shape `N+1 suspect`, H1 ranked first with SRE-001 at `api/fhir.py:155`, OOM and bad deploy weighed with evidence, M1/M2/M3 offered. security: no PHI in the pasted evidence, no 401/403; SEC-001 `frappe.get_all` in `lastn` ignores User Permissions; SEC-002 one token for 20 tablets | security runs because the spec's condition "unexpected access" holds (a new integration client reading a ward's heart rates every 30 s on one shared token); `flag-injection.mjs` scans every evidence Read; both return inline, the orchestrator saves them verbatim; `SubagentStop` validates | `02-sre.md` (`needs-human`), `03-security.md` |
| G-M 1 | **humans** | the telephony team rolls `spice_telephony` back to 1.7.3 at 08:20 (M3) because it was "the only deploy today"; on-call reports it | the orchestrator has no Bash; if you asked the sre to do it, `tool-guard.mjs` blocks `bench update`/`migrate`/`restart` for every roster agent, and nothing in its allowlist reaches `ke.spice.example` | none |
| 04 | `sre` | read-only check 08:20 to 08:27: `get_patient` still 504 at 08:21:10, 5xx 36.2%, 9 of 9 workers busy, backlog 51 to 68. Not resolved; H2 rejected | retry policy: one more G-M round, then `needs-human` escalation | `04-sre.md` (`needs-human`) |
| G-M 2 | **humans** | the incident commander gets KE-C-017 IT to switch the tablets' auto-refresh off at 08:31 (M1) | same as G-M 1 | none |
| 05 | `sre` | 08:31:40 last tablet call; no slow statement afterwards; 08:34 p95 0.10 s, 5xx 0.0%; queue empty at 08:48 without touching Redis; `pg_stat_statements` 118,400 per-subject calls in 31 minutes, 423 rows each. H1 confirmed; H3 (database) and H4 (OOM) rejected | read-only log and diagnostics only (sre guard) | `05-sre.md` |
| 06 | orchestrator | exact `/bug-fix BUG-71 ...` command for a new session; CLAUDE.md rule 8 exception stated; architect skipped, security mandatory (rule 2); D-7 and D-8 out of scope | code fixes leave the incident workflow | `06-bug-fix-handover.md` |
| 07 | `sre`, `production-rca` | postmortem draft: timeline, root cause, PM-1..PM-6 mapped to PA-1..PA-8 with owners | always `needs-human`: a person signs off | `07-postmortem.md` |
| 08 | orchestrator | step table, both G-M rounds, open actions; `.active` set to `none` | `next: human` | `08-run-report.md` |

Validate the committed run exactly as the hook would:

```bash
node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-ward-board   # 8 x PASS, exit 0
```

And the Claude Code hook path: an sre that finishes during an active run with its handoff inline passes; the same handoff with `status: done` is blocked with exit 2:

```bash
T=$(mktemp -d); R=$T/.ai-sdlc/runs/2026-09-22-inc-lastn-ward-board; mkdir -p $R
cp docs/capstone/example-runs/incident-lastn-ward-board/01-incident-brief.md $R/
echo 2026-09-22-inc-lastn-ward-board > $T/.ai-sdlc/runs/.active
node -e 'const m=require("fs").readFileSync("docs/capstone/example-runs/incident-lastn-ward-board/02-sre.md","utf8");process.stdout.write(JSON.stringify({hook_event_name:"SubagentStop",agent_type:"sre",cwd:process.argv[1],last_assistant_message:m}))' $T \
  | CLAUDE_PROJECT_DIR=$T node .claude/hooks/check-handoff.mjs; echo "exit $?"      # exit 0
```

## 3. Frappe details the run gets right

- **Time zones.** Error Log `creation` is naive site-local time (Africa/Nairobi, +03:00); gunicorn, nginx, Redis samples and Postgres are UTC; RQ lines have no date. The RCA passes `--offset error-log.txt=+03:00 --offset worker.log=+00:00 --date 2026-09-22`, so the 11:10 Error Log row lands on the 08:10 `JobTimeoutException` in `worker.log`, not three hours later.
- **"Perhaps out of memory?" is not an OOM.** gunicorn prints it for every SIGKILL; here each SIGKILL follows `WORKER TIMEOUT` for the same pid about 1 s earlier, memory peaked at 58% and the kernel log has no OOM kill.
- **An empty Error Log proves nothing.** Requests killed by `WORKER TIMEOUT` never reach `frappe.app.handle_exception`, so they leave no Error Log row; that also means the D-11 path (request values in the Error Log) was not triggered.
- **The queue backlog is a symptom.** `send_visit_reminders` started on time and ran out of its 300 s `default` timeout on a saturated database; the queue drained by itself once the tablets stopped. Purging it would have lost reminders for nothing.

## 4. The fix goes through a second workflow

In a new session, paste the command from `06-bug-fix-handover.md`. That run has its own gates: G1 before every developer launch, a regression test `test_bug71_lastn_query_count_constant` that must fail first (200 statements for 100 subjects) and pass after (3), a mandatory security step (the diff changes `spice_lite/api/`), tester and reviewer, then G3 with CODEOWNERS (the diff touches no DocType JSON, so G1b and the schema gate do not fire). In this course repository the fix is applied, tested and reverted in one go (`.claude/skills/performance-review/examples/lastn-fix/APPLY.md`), because `TEACHING-DEFECT(perf-n+1)` stays in `sample-app/` (CLAUDE.md rule 8).

## 5. Evals and governance after the incident

- **Skill evaluation (module 09 method).** `production-rca` has golden cases in `skills/production-rca/tests/cases.json` and a golden RCA for this exact pack, `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`. Compare `07-postmortem.md` against it: same trigger (CHG-5103 on CHG-5102), same root cause (`api/fhir.py:155-184`), same numbers (118,400 calls, 423 rows per call, 24 minutes of full outage), same preventive actions PA-1..PA-8, and the same rejected red herrings (the telephony deploy, OOM, Redis). A prompt change to `sre` or `production-rca` that loses any of those is a regression. The harness has no `sre` suite yet; adding one is the first improvement of exercise `11-incident-run`.
- **Governance (module 10).** Nothing in this run needed a governance exception: the sre could not reach the country site, `supervisorctl`, `redis-cli` and `purge-jobs` are blocked for every roster agent, and `site_config.json` stayed unreadable. The follow-ups are human changes with their own gates: per-client API users (PA-4) go through the integration-user register in `docs/governance/integration-users.json` and `scripts/governance/audit_api_users.py`; the nginx rate limit (PA-2) is an infrastructure change a human applies; the `bench --site ke.spice.example migrate` after the BUG-71 merge is governance G9, run by the release manager in the Kenya release window. Any change to `.claude/agents/sre.md` that the retro asks for is an AI-config change (G7).
