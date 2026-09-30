# Example run: INC-2026-0922-01 through the incident-response workflow

Committed copy of the handoffs a run of `/incident` writes to `.ai-sdlc/runs/2026-09-22-inc-lastn-latency/`. Walkthrough: [../../walkthrough-incident.md](../../walkthrough-incident.md). Spec: `workflows/incident-response.md`.

- **Evidence**: the synthetic pack `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` stands in for the read-only `kubectl`, log and metrics commands a live run would use. Each step cites only evidence timestamped before it ran (run started 08:12 UTC).
- **Human steps**: the two mitigation rounds (G-M) are the on-call engineer's actions from the evidence pack (scale to 4 at 08:17, dashboard refresh disabled at 08:31). No agent executed them.
- **Numbering**: the spec's 04 verify step ran twice (G-M retry), so rework numbering applies (`workflows/README.md`): 04 and 05 are the two verifications, 06 the bug-fix handover, 07 the postmortem, 08 the run report.
- **Validation**: `node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-latency` (from `AI-SDLC/`) prints 8 x PASS. `node scripts/capstone/verify-system.mjs` runs the same check.
- No PHI: counts and opaque ids only.
