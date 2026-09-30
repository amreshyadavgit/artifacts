# Skill asset: production-rca

| | |
|---|---|
| Runtime location | `.claude/skills/production-rca/` (`SKILL.md`, `rca-template.md`, `scripts/build-timeline.mjs`, `examples/INC-2026-0922-lastn/`) |
| Version | 1.0.0 (see `CHANGELOG.md`) |
| Owner | SRE guild (course role: `sre` agent maintainer) |
| Preloaded by | `sre` subagent (`skills: [performance-review, production-rca]`, see module 05-agent-roster); used by the incident workflow (module 08-workflow-orchestration) |
| Invoked as | `/production-rca [evidence-dir] [incident-id]` (`$0`, `$1`) |
| Output | An RCA following `rca-template.md` (11 sections), as a handoff with `status: needs-human` |
| Golden cases | `tests/cases.json` (5 live, 3 deterministic); answer key `tests/expected/INC-2026-0922-01-rca.md` |

## What it does
Turns an evidence pack into a blameless RCA: timeline, symptoms, evidence index, root-cause candidates (with evidence for and against), root cause as a cited causal chain, impact (including clinical safety, data integrity and PHI exposure), fix, preventive actions and verification.

`scripts/build-timeline.mjs` (zero dependencies, Node 22) merges ISO 8601, nginx and RFC 1123 timestamps from any number of files into one UTC table with `file:line` refs, collapses repeats, and refuses to print anything when the evidence contains PHI-like content (exit 3).

## The synthetic incident
`examples/INC-2026-0922-lastn/` is a complete, internally consistent pack: a clinic onboarding imports deep observation histories, then a ward dashboard polls `$lastn` for 512 patients every 30 s. The N+1 in `ObservationService.lastN` turns that into CPU throttling, GC stalls, pool exhaustion, probe timeouts and liveness restarts. Numbers agree across sources (pg_stat_statements calls = requests x 512; rows per call = import average 408). It contains no PHI.

## Read-only by construction
`allowed-tools` pre-approves only read-only `kubectl` subcommands (`get events`, `get pods`, `describe pod`, `rollout history`, `logs`). It deliberately does not pre-approve `kubectl get *`, which would also cover `kubectl get secret -o yaml`. Project settings already ask before `kubectl apply` and deny `kubectl delete`.

## Testing the skill
- Deterministic: `rca-06` to `rca-08` exercise the timeline builder and its PHI guard.
- Live: `rca-01` uses the full pack and the answer key; `rca-02` (OOMKilled), `rca-03` (bad deploy) and `rca-05` (thin evidence) check that the skill does not pattern-match every incident to the N+1; `rca-04` checks that it stops on PHI.
- The answer key is stored here, outside `.claude/skills/`, so the skill cannot read it during a run.

## Change policy
- Template section changes are a minor version; update `rca-01`'s `sections` list in the same change.
- Changing PHI guard rules needs a new deterministic case for each added or removed rule.
