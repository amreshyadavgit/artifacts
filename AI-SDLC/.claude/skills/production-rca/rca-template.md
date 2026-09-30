# RCA: {{incident-id}} {{one-line title}}

<!-- Fill every section. Write "none" or "not determined" rather than deleting a section. Blameless: name systems, changes and missing controls, not people. No PHI anywhere in this document. -->

| | |
|---|---|
| Incident | {{incident-id}} |
| Severity | {{SEV1-SEV4}} |
| Status | draft / reviewed / closed |
| Window (UTC) | {{first impact}} to {{full recovery}} |
| Author | sre agent run {{run-id}}; reviewed by {{human}} |
| Evidence pack | {{path}} |

## 1. Summary
Three to five sentences: what users saw, what caused it, how it was mitigated, what will stop it recurring.

## 2. Impact
| Dimension | Value | Evidence |
|---|---|---|
| Duration of degradation | | |
| Duration of full outage (no ready endpoints) | | |
| Requests failed (5xx, 504) | count and ratio | |
| Who was affected | clinics, clients, endpoints | |
| Clinical safety | Could a clinician have acted on missing or stale data? Were workarounds used? | |
| Data integrity | Lost, duplicated or partial writes? | |
| PHI exposure | Did any PHI reach logs, responses to the wrong party, or third parties? State how this was checked. | |
| SLO / error budget | | |

## 3. Timeline (UTC)
Built with `scripts/build-timeline.mjs`, then edited. Mark each row: `trigger`, `symptom`, `detection`, `action`, `recovery`.

| time | kind | event | evidence |
|---|---|---|---|

## 4. Symptoms
What was observed, without interpretation (latency, errors, restarts, resource saturation), each with its evidence id.

## 5. Evidence index
| id | file:line or query | what it shows |
|---|---|---|
| E1 | | |

## 6. Root-cause candidates
Every plausible hypothesis, including the ones you reject. A candidate is rejected only with evidence against it.

| # | hypothesis | evidence for | evidence against | verdict |
|---|---|---|---|---|
| H1 | | | | confirmed / contributing / rejected / not determined |

## 7. Root cause
State the causal chain from trigger to impact, one link per line, each link backed by an evidence id. Separate:
- **Trigger**: the event that started it (often a change).
- **Root cause**: the defect or missing control without which the trigger would have been harmless.
- **Contributing factors**: conditions that made it worse or slower to detect.

Include the code location (`path:line`) when the root cause is in code.

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
How we will know the fix and the preventive actions hold (tests, load test, alert, dashboard, game day).

## 11. Open questions
What the evidence could not answer, and which evidence would.
