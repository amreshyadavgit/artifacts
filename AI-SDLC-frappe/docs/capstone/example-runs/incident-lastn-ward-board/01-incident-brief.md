---
run_id: 2026-09-22-inc-lastn-ward-board
step: 01
agent: orchestrator
status: complete
inputs: [incident:INC-2026-0922-01]
next: sre
---
## Summary
Started 08:14 UTC by the on-call engineer with `/incident INC-2026-0922-01 502/504 on every endpoint of ke.spice.example since about 08:04 UTC, desk and login time out, restart at 08:12 helped for three minutes` in a session launched as `claude --agent orchestrator --settings workflows/gates.settings.json --permission-mode default`. Evidence: the redacted exports the on-call engineer pasted, which in this replay are the files of `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` (synthetic). Each later step cites only evidence timestamped before that step ran.

| field | value |
|---|---|
| Symptom | desk "spinning" from about 08:01; 504 at nginx's 120 s `proxy_read_timeout` and 502 from 08:04 on every endpoint (desk, `/api/method/login`, `spice_lite.api.fhir.*`); alert `SpiceKe5xxRatioHigh` (5xx above 5% for 5 min) |
| Start | 2026-09-22 about 08:01 UTC (first slow desk request as reported) |
| Detection | 08:09 UTC, alert |
| Site and country | `ke.spice.example`, country deployment `spice-ke` (Kenya); apps `frappe` 15.121.2, `spice_lite` 0.4.1, `spice_ke` (country app), `spice_telephony` (integration app, `required_apps = ["spice_lite"]`) |
| Affected endpoints and queues | all web traffic (one gunicorn pool, `-w 9` sync workers, `-t 120`); on-call also sees `default` RQ queue growing (about 33 jobs at 08:14) |
| Blast radius | every clinic on the Kenya site, the `ehr-bridge` integration, Clinic KE-C-017's new ward tablets |
| Actions before this run | 08:12 on-call restarted the web process (`supervisorctl restart spice-ke-web:`); relief for about three minutes |
| Recent changes (as reported; sre verifies) | CHG-5102 historical import for KE-C-017 (05:10 to 06:41, `long` queue); CHG-5104 `spice_telephony` 1.7.3 to 1.8.0 with `bench --site ke.spice.example migrate` at 07:40, web restart 07:41; CHG-5103 KE-C-017 ward board go-live on 20 tablets at 08:00 |
| PHI handling | the on-call report named the patient whose chart a clinician could not open (a name and an MRN); both removed before writing this file. Document names such as `SLP-03902` are opaque series values and are kept. |

## Findings
No findings.

## Decisions
- Workflow `incident-response` (`workflows/incident-response.md`), run id `2026-09-22-inc-lastn-ward-board`, `.ai-sdlc/runs/.active` set to this id.
- Step 03 security **runs** in parallel with 02. The spec's condition is "401/403 anomalies, data exposure, or unexpected access"; CHG-5103 is a new integration client whose 20 tablets share one integration user's API token and each read the latest heart rate of a whole ward (up to 100 patients) every 30 s. That is an unexpected access pattern on PHI, whatever the latency cause turns out to be.
- No agent runs a command that changes the site. The orchestrator has no Bash; the sre's `PreToolUse` guard (`agents/tool-guard.mjs`) allows only read-only diagnostics on `test.localhost`, bench log reads and the skills' scripts; `supervisorctl`, `bench ... migrate`, `redis-cli` and `purge-jobs` are blocked for every roster agent.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-22-inc-lastn-ward-board/01-incident-brief.md
