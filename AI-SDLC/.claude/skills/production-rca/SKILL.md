---
name: production-rca
description: Blameless root-cause analysis of a production incident for the FHIR-lite API from an evidence pack (logs, metrics, Kubernetes events, change calendar). Builds a UTC timeline, lists symptoms and evidence, weighs root-cause candidates, states the root cause, impact including clinical safety and PHI exposure, the fix and preventive actions, using rca-template.md.
when_to_use: After an incident is mitigated and evidence has been collected, or when asked why the service degraded, why pods restarted, or what caused a latency spike.
argument-hint: "[evidence-dir] [incident-id]"
allowed-tools: Read Grep Glob Bash(node */production-rca/scripts/build-timeline.mjs *) Bash(git log *) Bash(kubectl get events *) Bash(kubectl get pods *) Bash(kubectl describe pod *) Bash(kubectl rollout history *) Bash(kubectl logs *)
---

# Production RCA

Evidence directory: `$0`. Incident id: `$1`.

You analyse; you do not change production. Mitigation is already done or is a human decision. Your output is a reviewed-quality RCA draft that a human signs off.

## 1. Guard the evidence first
Run the timeline builder over every log and event file in the evidence directory:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/build-timeline.mjs $0/*.log $0/*.txt $0/*.md --collapse
```

- Exit `3` means PHI-like content (MRN, birth date, names, SSN-like numbers, database errors that echo submitted values). **Stop.** Report the `file:line` list it printed, recommend a privacy-incident review, and do not quote those lines. Do not try to bypass the guard with Grep or Read.
- Exit `0` gives a Markdown timeline with a `ref` column (`file:line`). Use those refs as evidence ids.

If you have live cluster access, read-only commands only: `kubectl get events`, `kubectl get pods`, `kubectl describe pod`, `kubectl rollout history`, `kubectl logs`. Never `kubectl get secret`, never `exec`, `apply`, `scale`, `delete` or `rollout restart`.

## 2. Read everything before concluding
Read the incident brief, the change calendar, every evidence file, and the code the evidence points at. For this service the usual suspects live in:
- `sample-app/src/main/java/org/example/fhir/service/ObservationService.java` (`lastN`, marked `TEACHING-DEFECT(perf-n+1)`)
- `sample-app/src/main/java/org/example/fhir/error/GlobalExceptionHandler.java` (what gets logged on a 500)
- `sample-app/k8s/deployment.yaml` (probes, limits), `sample-app/src/main/resources/application.yml` (pool, actuator exposure), `sample-app/Dockerfile` (heap sizing)

## 3. Build the analysis in this order
Fill [rca-template.md](rca-template.md). Sections 1 to 11, none deleted.

1. **Timeline**: from the builder output, keep the rows that matter and label each `trigger`, `symptom`, `detection`, `action` or `recovery`.
2. **Symptoms**: observations only, each with an evidence id.
3. **Candidates**: at least four hypotheses, always including *bad deploy*, *database degradation*, *resource exhaustion (memory/CPU)* and *traffic or data change*. For each: evidence for, evidence against, verdict.
4. **Root cause**: a causal chain from trigger to user impact, one link per line, every link cited. Keep trigger, root cause and contributing factors separate.
5. **Impact**: include clinical safety (stale or missing data at the point of care), data integrity, and PHI exposure, each with how you checked it.
6. **Fix and preventive actions**: link code fixes to the performance-review or security-review skill output and to a patch or test when one exists. Every preventive action says whether it prevents, detects or mitigates, and names an owner role.

## 4. Reasoning rules
- Correlation in time is not causation. A change that lines up with the start needs a mechanism.
- Read container exit codes precisely: `Reason: OOMKilled` is a memory kill; `Reason: Error` with exit code `137` is a SIGKILL (for example after a liveness failure and the termination grace period), not an OOM.
- A probe timeout says the probe did not get an answer within `timeoutSeconds`; find out why (CPU throttling, GC pauses, thread or connection starvation) before blaming the probe.
- Quantify: rows per request, statements per request, requests per second, and check that the numbers are consistent across sources.
- If the evidence cannot decide between candidates, say "not determined", give your confidence, and list the evidence that would decide it.

## 5. Output
Write the RCA to the run folder given in the task (for example `.ai-sdlc/runs/<run-id>/NN-sre-rca.md`) with the handoff front matter from `workflows/README.md`, `agent: sre`, `status: needs-human` (an RCA always needs human review), and `inputs` holding only earlier run files or external references such as `incident:INC-2026-0922-01` (the evidence pack path goes in the "Evidence pack" row, not in `inputs`). If you cannot write files, return the full RCA as your answer.

## 6. Do not
- Do not include PHI, credentials, tokens or full patient-id lists in the RCA.
- Do not name individuals as causes. Name the change, the missing control, the unsafe default.
- Do not recommend "be more careful". Every preventive action is a mechanism: a test, a limit, an alert, a gate, a runbook step.
