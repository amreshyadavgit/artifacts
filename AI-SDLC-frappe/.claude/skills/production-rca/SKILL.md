---
name: production-rca
description: Blameless root-cause analysis of a production incident on a Frappe deployment (spice_lite country site) from an evidence pack - nginx access log, gunicorn web.error.log, RQ worker.log, redis queue lengths, Error Log export, PostgreSQL slow-query log, metrics and the change calendar. Builds a UTC timeline, lists symptoms and evidence, weighs root-cause candidates, states the root cause, impact including clinical safety and PHI exposure, the fix and preventive actions, using rca-template.md.
when_to_use: After an incident on a bench or country site is mitigated and evidence has been collected, or when asked why the site returned 502/504, why gunicorn workers timed out, why an RQ queue backed up, or what caused a latency spike.
argument-hint: "[evidence-dir] [incident-id]"
allowed-tools: Read Grep Glob Bash(node ${CLAUDE_SKILL_DIR}/scripts/build-timeline.mjs *) Bash(node ${CLAUDE_SKILL_DIR}/../performance-review/scripts/count-queries.mjs *) Bash(git log *)
---

# Production RCA (Frappe deployment)

Evidence directory: `$0`. Incident id: `$1`.

You analyse; you do not change production. Mitigation is already done or is a human decision. Your output is an RCA draft that a human reviews and signs off.

## 1. Guard the evidence first
Run the timeline builder over every evidence file. Give it the date for time-only RQ lines and the offset of every file whose timestamps carry no zone (read the brief: Frappe stores Error Log `creation` in the **site time zone**, not UTC):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/build-timeline.mjs $0/*.log $0/*.txt $0/*.md --date 2026-09-22 --offset error-log.txt=+03:00 --offset worker.log=+00:00 --collapse
```

The date and offsets above are the ones `examples/INC-2026-0922-lastn/incident-brief.md` states; take them from the brief of the incident you are analysing.

- Exit `3` means PHI-like or secret-like content: MRNs, `Form Dict:` dumps with patient fields, PHI query parameters (`family=`, `identifier=`), traceback locals holding patient fields, `INSERT INTO "tabSL Patient"` with values, Frappe API tokens, `site_config.json` secrets. **Stop.** Report the `file:line` list it printed, recommend a privacy-incident review, and do not quote those lines. Do not work around the guard with Grep or Read.
- Exit `0` gives a Markdown timeline with a `ref` column (`file:line`). Use those refs as evidence ids.
- Read the warnings on stderr. "taken as UTC" on a file whose clock is site-local shifts that file by hours and invents a false sequence.

For Postgres logs, also count statement shapes; a shape repeated with one literal changing is an N+1 in the application, not a slow database:

```bash
node ${CLAUDE_SKILL_DIR}/../performance-review/scripts/count-queries.mjs $0/postgres-slow.log
```

Never run `bench --site * console`, `bench --site * execute`, `bench --site * migrate`, `supervisorctl`, `redis-cli FLUSH*` or anything that writes. If a human gives you live read access, read-only commands only.

## 2. Read everything before concluding
Read the incident brief, the change calendar, every evidence file, and the code the evidence points at. For spice_lite the usual suspects are:
- `sample-app/spice_lite/spice_lite/api/fhir.py`: `lastn` (`TEACHING-DEFECT(perf-n+1)`, `MAX_LASTN_SUBJECTS`), `search_patients`, `create_observation`
- `sample-app/spice_lite/spice_lite/clinical/doctype/*/*.json`: `search_index` fields (and whether Postgres really has those indexes, see the performance-review checklist)
- the process model in the brief: gunicorn sync workers and `-t`, nginx `proxy_read_timeout`, RQ queues and their timeouts (`short` 300 s, `default` 300 s, `long` 1500 s)
- performance-review and security-review outputs for the same code, if they exist

## 3. Build the analysis in this order
Fill [rca-template.md](rca-template.md). Sections 1 to 11, none deleted.

1. **Timeline**: from the builder output, keep the rows that matter and label each `trigger`, `symptom`, `detection`, `action` or `recovery`.
2. **Symptoms**: observations only, each with an evidence id.
3. **Candidates**: at least five hypotheses, always including *bad deploy* (an app update, `bench migrate`), *database degradation*, *resource exhaustion (memory, CPU)*, *queue or Redis failure* and *traffic or data change*. For each: evidence for, evidence against, verdict.
4. **Root cause**: a causal chain from trigger to user impact, one link per line, every link cited. Keep trigger, root cause and contributing factors separate.
5. **Impact**: include clinical safety (stale or missing data at the point of care, delayed reminders), data integrity (writes that timed out: did they commit?), and PHI exposure, each with how you checked it.
6. **Fix and preventive actions**: link code fixes to the performance-review or security-review output and to a patch or test when one exists. Every preventive action says whether it prevents, detects or mitigates, and names an owner role.

## 4. Reasoning rules (Frappe specifics)
- Correlation in time is not causation. A change that lines up with the start needs a mechanism; a rollback that changes nothing is evidence against it.
- gunicorn's `Worker (pid:N) was sent SIGKILL! Perhaps out of memory?` is printed for **every** SIGKILL. After `WORKER TIMEOUT (pid:N)` the arbiter sends SIGABRT and then SIGKILL to a worker that is stuck (for example waiting on Postgres). Check host memory and the kernel log before calling it an OOM.
- A gunicorn sync worker serves one request at a time. `-w 9` means the 10th slow request waits. 504 at exactly `proxy_read_timeout` (120 s) is nginx giving up; 502 is the worker dying mid-request.
- An RQ backlog (`LLEN rq:queue:<bench_id>:default`) is usually a symptom: jobs share the database with the web tier. `JobTimeoutException` means the job ran longer than its queue timeout; find out what it was waiting on.
- Requests killed by `WORKER TIMEOUT` never reach `frappe.app.handle_exception`, so they leave **no Error Log row**. An empty Error Log for the endpoint is not evidence that the endpoint was fine.
- Quantify: statements per request, rows per statement, requests per minute, busy workers, and check that the numbers agree across nginx, Postgres and metrics.
- If the evidence cannot decide between candidates, say "not determined", give your confidence, and list the evidence that would decide it.

## 5. Output
Write the RCA to the run folder given in the task (for example `.ai-sdlc/runs/<run-id>/NN-sre-rca.md`) with the handoff front matter from `workflows/README.md`, `agent: sre`, `status: needs-human` (an RCA always needs human review), and `inputs` holding only earlier run files or external references such as `incident:INC-2026-0922-01` (the evidence pack path goes in the "Evidence pack" row, not in `inputs`). If you cannot write files, return the full RCA as your answer.

## 6. Do not
- Do not include PHI, credentials, API tokens, `site_config.json` values or full lists of patient document names in the RCA.
- Do not name individuals as causes. Name the change, the missing control, the unsafe default.
- Do not recommend "be more careful" or "add more workers" as the fix. Every preventive action is a mechanism: a test, a limit, an alert, a gate, a runbook step.
