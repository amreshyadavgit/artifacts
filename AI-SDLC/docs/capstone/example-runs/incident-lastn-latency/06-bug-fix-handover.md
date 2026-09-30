---
run_id: 2026-09-22-inc-lastn-latency
step: 06
agent: orchestrator
status: complete
inputs: [02-sre.md, 05-sre.md]
next: human
---
## Summary
A code change is needed, so the fix leaves this workflow and goes through `workflows/bug-fix.md` with its own gates (G1 on every developer launch, G2 findings, G3 PR review). Run it in a new session so the run folders stay separate:

```bash
cd AI-SDLC
claude --agent orchestrator --settings workflows/gates.settings.json
```

then type exactly:

```text
/bug-fix FHIR-311 $lastn issues 2 SQL statements per subject and loads each full history (1,024 statements for 512 subjects); cap subjects at 100. Evidence: INC-2026-0922-01 run 2026-09-22-inc-lastn-latency, 02-sre.md SRE-1 SRE-2, 05-sre.md
```

## Findings
No findings.

## Decisions
- CLAUDE.md rule 6 and the bug-fix spec allow touching `TEACHING-DEFECT(perf-n+1)` only when the report is explicitly about `$lastn` performance. This one is. In the course repository, apply the fix in a scratch copy as `.claude/skills/performance-review/examples/lastn-fix/APPLY.md` describes, never in `sample-app/` itself.
- Prior art for the planner: `.claude/skills/performance-review/examples/lastn-fix/lastn-set-based.patch` (two `ROW_NUMBER()` queries, 100-subject cap) and `LastnQueryCountTest.java` (40 statements for 20 subjects before, at most 2 after).
- Expected regression test name: `FHIR311_lastnStatementCountIndependentOfSubjects`. It must fail before the fix and pass after it (`context/standards/testing-standards.md`).
- Out of scope for FHIR-311: D-02 (null `effectiveDateTime` as latest) and D-03 (duplicate subject ids) in the same method; the patch keeps them reproducible.
- Step 02 architect runs in the bug-fix workflow: rejecting more than 100 subjects with 400 changes the public contract of `GET /fhir/Observation/$lastn`.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-22-inc-lastn-latency/06-bug-fix-handover.md
