# Example run: INC-2026-0922-01 through the incident-response workflow

Committed copy of the handoffs a run of `/incident` writes to `.ai-sdlc/runs/2026-09-22-inc-lastn-ward-board/`. Walkthrough: [../../walkthrough-incident.md](../../walkthrough-incident.md). Spec: `workflows/incident-response.md`. Evidence pack: `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` (module 04, synthetic).

- **Replay framing**: the run starts at 08:14 UTC, after the on-call engineer's 08:12 web restart. The evidence pack stands in for the redacted exports a human pastes from the Kenya site (nginx, gunicorn, RQ, Redis, Error Log, Postgres, metrics). Each step cites only evidence timestamped before it ran: 02 (08:17) has no `pg_stat_statements` snapshot and no kernel log; 05 (after 09:00) has both.
- **Human steps**: the two mitigation rounds (G-M) are the humans' actions recorded in the pack: `spice_telephony` rolled back at 08:20 (no effect), the ward board's auto-refresh switched off at 08:31 (recovery). No agent executed them.
- **Numbering**: the spec's 04 verify step ran twice (G-M retry), so rework numbering applies (`workflows/README.md`): 04 and 05 are the two verifications, 06 the bug-fix handover, 07 the postmortem, 08 the run report.
- **Validation**: `node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-ward-board` (from `AI-SDLC-frappe/`) prints 8 PASS lines. `node scripts/capstone/verify-system.mjs` runs the same check.
- **No PHI**: document names (`SLP-03902`) and counts only. The patient named in the on-call report was removed in 01.
- **Agreement with the golden RCA**: `07-postmortem.md` matches `skills/production-rca/tests/expected/INC-2026-0922-01-rca.md` on trigger (CHG-5103 on CHG-5102), root cause (`api/fhir.py:155-184`), 118,400 per-subject calls, 423 rows per call, 24 minutes of full outage, and preventive actions PA-1..PA-8.
