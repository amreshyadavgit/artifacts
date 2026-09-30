# Skill asset: requirements (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/requirements/SKILL.md` (worked example: `workflows/examples/feature-observation-code-vocabulary/01-requirements.md`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/ai-governance |
| Consumers | The orchestrator as step 01 of `/feature` and `/bug-fix`; humans via `/requirements` |
| Invocation | `/requirements OBS-51 controlled vocabulary for observation codes` |
| Writes files | `.ai-sdlc/runs/<run-id>/01-requirements.md` inside a run; outside a run it prints the document. `disallowed-tools: Edit Bash` |
| Taught in | module `08-workflow-orchestration` |
| Golden cases | [tests/cases.json](tests/cases.json): 4 deterministic, 1 live |

## Purpose
Turns a ticket, bug report or incident note into a PHI-free requirements handoff: a user story (or Observed / Expected / Reproduction in bug mode), Given/When/Then acceptance criteria that each name an exact whitelisted-method call or DocType operation and an observable result, non-functional requirements (PHI, queries per request, patch and migrate behaviour, country apps) and explicit scope. It reads `00-ticket-intake.md` when `/ticket-intake` ran first.

## Inputs and arguments
`$ARGUMENTS`: ticket id or request text. Reads `context/`, the DocType JSON of every DocType named, and `api/fhir.py`.

## Output contract
`01-requirements.md` with front matter `agent: orchestrator`, `step: 01`, `next: architect` (feature) or `next: orchestrator` (bug fix), and the five handoff sections of `workflows/README.md`.

## Bench assumptions
None.

## Cost notes
Default model; about 10 Read/Grep calls.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# rq-01-worked-example-valid: The worked requirements handoff passes the handoff validator
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary/01-requirements.md
# rq-02-worked-example-phi-free: The worked requirements handoff has no PHI-shaped values
node scripts/automation/scan-phi.mjs workflows/examples/feature-observation-code-vocabulary/01-requirements.md
# rq-03-read-only: The skill cannot edit files or run commands
grep -E '^(allowed-tools|disallowed-tools):' .claude/skills/requirements/SKILL.md
# rq-04-acceptance-criteria-ids: The worked example numbers its acceptance criteria AC-1 upwards
grep -cE '^\| AC-[0-9]+ ' workflows/examples/feature-observation-code-vocabulary/01-requirements.md
```

## Known limitations
- It does not design: new DocType, field or method names appear only when the ticket names them.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
