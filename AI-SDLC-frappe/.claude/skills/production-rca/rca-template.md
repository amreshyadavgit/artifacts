# RCA: {{incident-id}} {{one-line title}}

<!-- Fill every section. Write "none" or "not determined" rather than deleting a section. Blameless: name systems, changes and missing controls, not people. No PHI, API tokens or site_config values anywhere in this document. -->

| | |
|---|---|
| Incident | {{incident-id}} |
| Severity | {{SEV1-SEV4}} |
| Status | draft / reviewed / closed |
| Site and deployment | {{site}} ({{country deployment}}), apps and versions |
| Window (UTC) | {{first impact}} to {{full recovery}} |
| Author | sre agent run {{run-id}}; reviewed by {{human}} |
| Evidence pack | {{path}} |

## 1. Summary
Three to five sentences: what users saw, what caused it, how it was mitigated, what will stop it recurring.

## 2. Impact
| Dimension | Value | Evidence |
|---|---|---|
| Duration of degradation | | |
| Duration of full outage (every endpoint failing, desk and login included) | | |
| Requests failed (502, 504, 5xx) | count and ratio | |
| Who was affected | clinics, integration users, desk users, endpoints | |
| Background jobs | queues backed up, jobs failed with `JobTimeoutException`, jobs that must be re-run | |
| Clinical safety | Could a clinician have acted on missing or stale data? Were reminders or results delayed? Workarounds used? | |
| Data integrity | Writes that timed out (did they commit?), duplicated or partial writes, failed jobs with side effects | |
| PHI exposure | Did PHI reach logs, Error Log, access logs, responses to the wrong user, or third parties? State how this was checked. | |
| SLO / error budget | | |

## 3. Timeline (UTC)
Built with `scripts/build-timeline.mjs` (with `--date` and `--offset` for zone-less files), then edited. Mark each row: `trigger`, `symptom`, `detection`, `action`, `recovery`.

| time | kind | event | evidence |
|---|---|---|---|

## 4. Symptoms
What was observed, without interpretation (latency, 502/504, worker timeouts, queue backlog, CPU, slow statements), each with its evidence id.

## 5. Evidence index
| id | file:line or query | what it shows |
|---|---|---|
| E1 | | |

## 6. Root-cause candidates
Every plausible hypothesis, including the ones you reject. A candidate is rejected only with evidence against it. Always include: bad deploy or migrate, database degradation, resource exhaustion (memory, CPU), queue or Redis failure, traffic or data change.

| # | hypothesis | evidence for | evidence against | verdict |
|---|---|---|---|---|
| H1 | | | | confirmed / contributing / rejected / not determined |

## 7. Root cause
State the causal chain from trigger to impact, one link per line, each link backed by an evidence id. Separate:
- **Trigger**: the event that started it (often a change).
- **Root cause**: the defect or missing control without which the trigger would have been harmless.
- **Contributing factors**: conditions that made it worse or slower to detect.

Include the code location (`path:line`) when the root cause is in code, and the measurement that proves it (statements per request, rows per statement).

## 8. Fix
| Type | Action | Status | Evidence it works |
|---|---|---|---|
| Mitigation (done during the incident) | | done | |
| Permanent fix | patch path, test that proves it | proposed / merged | |

## 9. Preventive actions
| id | action | prevents / detects / mitigates | owner (role) | due | ticket |
|---|---|---|---|---|---|
| PA-1 | | | | | |

## 10. Verification
How we will know the fix and the preventive actions hold (query-count test, load test on a synthetic site, alert, dashboard, game day).

## 11. Open questions
What the evidence could not answer, and which evidence would.
