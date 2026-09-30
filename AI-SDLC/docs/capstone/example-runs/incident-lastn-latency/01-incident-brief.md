---
run_id: 2026-09-22-inc-lastn-latency
step: 01
agent: orchestrator
status: complete
inputs: [incident:INC-2026-0922-01]
next: sre
---
## Summary
Started 08:12 UTC by the on-call engineer with `/incident INC-2026-0922-01 p95 latency on GET /fhir/Observation/$lastn above 30s since 08:01 UTC, 5xx above 5%, fhir-lite-api pods restarting` in a session launched as `claude --agent orchestrator --settings workflows/gates.settings.json`. Evidence pack: `.claude/skills/production-rca/examples/INC-2026-0922-lastn/` (synthetic; stands in for the read-only `kubectl` and log commands a live run would use). Each later step cites only evidence timestamped before that step ran.

| field | value |
|---|---|
| Symptom | `$lastn` p95 36.9 s at 08:01, capped at the 60 s ingress timeout from 08:03; every other endpoint slow or failing from 08:02; 503s with no upstream at 08:05 and 08:10 |
| Start | 2026-09-22 08:01 UTC (first slow `$lastn` completed 08:00:42) |
| Detection | alert `FhirLiteApi5xxRatioHigh` at 08:09 UTC; clinician reports of "patient chart spinner" and 503 |
| Affected endpoints | all of `/fhir/**` on `fhir-lite-api` (namespace `clinical-api`): Patient read and search, Observation search, create and `$lastn` |
| Blast radius | every clinic using `ehr-portal/5.1.3`; both pods of Deployment `fhir-lite-api` restarted at least twice (liveness kills 08:05:48, 08:06:21, 08:10:47, 08:11:09) |
| Recent changes (as reported, sre verifies) | no `fhir-lite-api` deploy today; change calendar lists CHG-4471 (history import for Clinic C-017, 06:30 to 07:41) and CHG-4472 (C-017 ward dashboard go-live, 08:00) |
| PHI handling | the on-call report named one patient (a Patient URL, a name and an MRN, synthetic in this replay); all three removed before writing this file. No names, MRNs, birth dates or values below. |

## Findings
No findings.

## Decisions
- Workflow `incident-response` (`workflows/incident-response.md`), run id `2026-09-22-inc-lastn-latency`, `.ai-sdlc/runs/.active` set to this id.
- Step 03 security **runs** in parallel with 02: the symptom includes `ERROR ... GlobalExceptionHandler : Unhandled exception` lines, and `sample-app/docs/KNOWN_DEFECTS.md` D-04 records that this handler can write submitted values (PHI) to the log. That is a possible data exposure, which is the spec's condition for step 03.
- No agent runs a mutating command in this workflow. The orchestrator has no Bash; the sre's `PreToolUse` guard (`agents/tool-guard.mjs`) always denies `kubectl apply|scale|delete|rollout restart`.

## Open questions
None.

## Artifacts
- .ai-sdlc/runs/2026-09-22-inc-lastn-latency/01-incident-brief.md
