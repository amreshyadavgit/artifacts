# Skill asset: incident (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/incident/SKILL.md` (spec: `workflows/incident-response.md`, worked run: `docs/capstone/example-runs/incident-lastn-ward-board/`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | Humans via `/incident`; the `sre` agent (with `performance-review` and `production-rca` preloaded) does the analysis |
| Invocation | `/incident INC-2026-0922-01 ward board slow on ke.spice.example since 09:40` |
| Writes files | Only inside `.ai-sdlc/runs/<run-id>/`. Nobody in this workflow changes a site: a human runs the mitigation |
| Taught in | module `08-workflow-orchestration` |
| Golden cases | [tests/cases.json](tests/cases.json): 3 deterministic, 1 live |

## Purpose
Runs the incident-response workflow for a `spice_lite` deployment: a PHI-free incident brief, sre root-cause analysis (slow whitelisted methods such as `lastn`, RQ queue backlog, worker and scheduler health) with security triage in parallel only for 401/403 anomalies, data exposure or unexpected access, a human mitigation decision (gate G-M), sre verification with read-only evidence, an optional handover to `/bug-fix`, and a postmortem draft.

## Inputs and arguments
`$0` incident id, the rest the symptom, site and time window. Injection: `date +%F`.

## Output contract
A run folder `.ai-sdlc/runs/<date>-inc-<slug>/` with `01-incident-brief.md`, `02-sre.md`, optional `03-security.md`, `04-sre.md`, optional `05-bug-fix-handover.md`, `06-postmortem.md` and the run report.

## Bench assumptions
Read-only diagnostics only (`doctor`, `show-pending-jobs`, bench log tails). `migrate`, `execute`, `console`, `set-config` and `run-patch` are `ask` rules; `drop-site`, `reinstall` and `restore` are denied.

## Cost notes
3 to 5 subagent launches; the sre steps read large logs, so give the evidence as a directory, not pasted text.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# in-01-worked-run-valid: Every handoff of the worked incident run passes the handoff validator
node .claude/hooks/check-handoff.mjs docs/capstone/example-runs/incident-lastn-ward-board
# in-02-worked-run-phi-free: The worked incident run contains no PHI-shaped values
node scripts/automation/scan-phi.mjs docs/capstone/example-runs/incident-lastn-ward-board/*.md; echo "exit=$?"
# in-03-no-site-changes: The skill pre-approves no bench command and cannot start itself
sed -n '1,20p' .claude/skills/incident/SKILL.md | grep -E '^(allowed-tools|disable-model-invocation):'
```

## Known limitations
- `show-pending-jobs` prints job kwargs, which can hold document names; a human redacts them before they are pasted.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
