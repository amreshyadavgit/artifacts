# Walkthrough: one incident through the whole system

Incident: **INC-2026-0922-01**. From 08:01 UTC on 2026-09-22 `GET /fhir/Observation/$lastn` took 36 to 60 s, every other endpoint slowed down, readiness and then liveness probes timed out after the default 1 s, and Kubernetes restarted both `fhir-lite-api` pods into the same load. Evidence pack (synthetic, no PHI): `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` (module 04). The committed handoffs of this run are in [example-runs/incident-lastn-latency/](example-runs/incident-lastn-latency/).

The rule of this workflow (`workflows/incident-response.md`): **no agent changes production**. Agents read, reason and recommend; a human executes every mitigation.

## 0. Before the run

```bash
cd AI-SDLC
node scripts/capstone/verify-system.mjs     # look at the sre rows: agent-skills and guard-reach
```

`guard-reach` checks that each script a preloaded skill tells an agent to run is inside that agent's Bash guard. `production-rca` step 1 runs `build-timeline.mjs` (the PHI guard over the evidence). If the `sre` guard in `.claude/agents/sre.md` does not list `node .claude/skills/production-rca/scripts/build-timeline.mjs`, the `PreToolUse` hook blocks the call with exit 2 and step 02 cannot start. Fix that before an incident, not during one.

## 1. Start and enter

```bash
claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default
```

```text
/incident INC-2026-0922-01 p95 latency on GET /fhir/Observation/$lastn above 30s since 08:01 UTC, 5xx above 5%, fhir-lite-api pods restarting
```

The `incident` skill registers the `SubagentStop` handoff hook, injects today's date, and routes the orchestrator to `workflows/incident-response.md`.

## 2. Step by step

| # | Who runs | What happens | Gate / control that fires | Handoff |
|---|---|---|---|---|
| 01 | orchestrator | brief: symptom, start 08:01, detection 08:09, all `/fhir/**` affected, CHG-4471 and CHG-4472 as reported; the one patient named in the report (URL, name, MRN) removed | PHI rule (CLAUDE.md rule 1); `block-secrets.mjs` on the Write | `01-incident-brief.md` |
| 02 + 03 | `sre` (opus, preloads `performance-review` and `production-rca`) and `security` (opus, preloads `security-review`) in the same turn | sre: `build-timeline.mjs` exit 0 (86 events, no PHI), H1 N+1 amplified by 512-subject dashboard requests, M1/M2/M3 options. security: logged exceptions are pool timeouts, no PHI; SEC-1 shared `clinician` account, SEC-2 audit lacks subject ids | security runs because the symptom includes `GlobalExceptionHandler` ERROR lines and D-04 says that handler can log submitted values; `flag-injection.mjs` scans every evidence Read; both return inline, the orchestrator saves verbatim; `SubagentStop` validates | `02-sre.md` (`needs-human`), `03-security.md` |
| G-M 1 | **you** (on-call) | you run M3 from **your own terminal**: `kubectl scale deployment/fhir-lite-api --replicas=4 -n clinical-api`, then tell the orchestrator "08:17 scaled to 4" | the orchestrator has no Bash; if you asked the sre to scale, `tool-guard.mjs` denies `kubectl scale` (exit 2) | none |
| 04 | `sre` | read-only check 08:17 to 08:26: new pods killed 08:21, p95 still 60 s, DB connections 40. Not resolved | retry policy: one more G-M round, then `needs-human` escalation | `04-sre.md` (`needs-human`) |
| G-M 2 | **you** | incident commander gets C-017 IT to disable the dashboard refresh (M1) at 08:31; you report it | same as G-M 1 | none |
| 05 | `sre` | 08:34 p95 0.21 s, error ratio 0.002; `pg_stat_statements` 431,616 calls = 843 requests x 512 subjects. H1 confirmed, H3 rejected | read-only `kubectl get`/`describe`/`logs` only (sre guard) | `05-sre.md` |
| 06 | orchestrator | exact `/bug-fix FHIR-311 ...` command for a new session; rule-6 exception stated; D-02/D-03 out of scope | code fixes leave the incident workflow | `06-bug-fix-handover.md` |
| 07 | `sre`, `production-rca` | postmortem draft: timeline, root cause, PM-1..PM-7 with owners, PA-1..PA-8 | always `needs-human`: a person signs off | `07-postmortem.md` |
| 08 | orchestrator | step table, both G-M rounds, open actions; `.active` set to `none` | `next: human` | `08-run-report.md` |

Validate the committed run exactly as the hook would:

```bash
node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-latency   # 8 x PASS, exit 0
```

## 3. The fix goes through a second workflow

In a new session, paste the command from `06-bug-fix-handover.md`. That run has its own gates: 02 architect (the 100-subject cap changes the public contract), G1 before every developer launch, a regression test that must fail first (`FHIR311_lastnStatementCountIndependentOfSubjects`), tester and reviewer, then G3 PR review. In this course repository the fix is applied in a scratch copy only (`.claude/skills/performance-review/examples/lastn-fix/APPLY.md`), because the `TEACHING-DEFECT(perf-n+1)` stays in `sample-app/` (CLAUDE.md rule 6).

## 4. Evals and governance after the incident

- **Skill evaluation (module 09 method)**: `production-rca` has golden cases in `skills/production-rca/tests/cases.json` and a golden RCA for this exact pack, `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md`. Compare `07-postmortem.md` against it: same trigger (CHG-4472 on CHG-4471), same root cause (`ObservationService.java:69-74` plus the unbounded `subjects` at `ObservationController.java:43`), same impact (9,847 of 29,412 failed). A prompt change to `sre` or `production-rca` that loses any of those is a regression. The harness has no `sre` suite yet; adding one is exercise `11-incident-run`'s first improvement.
- **Governance (module 10)**: the probe change (PA-3) edits `sample-app/k8s/deployment.yaml` and is applied by a human (`kubectl apply` is an `ask` rule); the per-client credential (PA-6) is a `SecurityConfig` change that security reviews; any change to `.claude/agents/sre.md` goes through the AI-config PR gate (G6, `scripts/governance/check-ai-change-approval.mjs`).
