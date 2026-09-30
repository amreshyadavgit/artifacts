# Eval run: architecture v2, reviewer v2

> **Synthetic recordings.** Replay mode scored hand-authored recordings from `evaluations/recordings/`. They exercise the harness offline; they are not measurements of a real model run.

## architecture (architect-v2)

Mode: replay. Agent file: `.claude/agents/architect.md`. Dataset 1.0.0, context fingerprint `27984898ba7f`.

| Metric | Value |
|---|---|
| Cases passed | 17/20 (85.0%) |
| Recall (expected findings mentioned) | 98.8% |
| Precision (table rows matching an expected finding) | 98.7% |
| Hallucination rate (cases with a forbidden claim) | 5.0% (1 claims) |
| Severity mismatches | 2 |
| Grounding errors (cited path:line missing) | 0 |
| Tool-call violations (permission_denials) | 0 |
| Format failures | 0 |
| Critical cases failing | none |
| Cost total / mean per case | $5.320 / $0.266 |
| Mean turns | 8.9 |
| Latency p50 / p95 | 60.1 s / 74.1 s |
| Judge mean scores | grounding 4.85, coverage 4.95, severity_calibration 4.8, actionability 4.8, safety 5 |
| Judge pass rate / agreement with scripted | 90.0% / 95.0% |

### Gates

| Gate | Actual | Result |
|---|---|---|
| pass rate >= 0.8 | 0.85 | pass |
| recall >= 0.8 | 0.988 | pass |
| precision >= 0.7 | 0.987 | pass |
| hallucination rate <= 0.05 | 0.05 | pass |
| tool violations <= 0 | 0 | pass |
| critical cases pass | none failed | pass |

Overall: **PASS**

### Cases

| Case | Result | Recall | Halluc. | Turns | Cost | Failing assertions |
|---|---|---|---|---|---|---|
| ARCH-01 | pass | 100.0% | 0 | 9 | $0.284 |  |
| ARCH-02 | pass | 100.0% | 0 | 10 | $0.301 |  |
| ARCH-03 | pass | 100.0% | 0 | 10 | $0.312 |  |
| ARCH-04 | pass | 100.0% | 0 | 9 | $0.276 |  |
| ARCH-05 | pass | 100.0% | 0 | 10 | $0.298 |  |
| ARCH-06 (critical) | pass | 100.0% | 0 | 11 | $0.334 |  |
| ARCH-07 | pass | 100.0% | 0 | 9 | $0.269 |  |
| ARCH-08 | FAIL | 100.0% | 1 | 10 | $0.293 | must-not-mention: no forbidden claims: G-DRYRUN: "Rehearsal: run `bench --site ke.localhost migrate --dry-run` on a restored copy of each site, then the real migrate." |
| ARCH-09 | pass | 100.0% | 0 | 9 | $0.271 |  |
| ARCH-10 | pass | 100.0% | 0 | 9 | $0.262 |  |
| ARCH-11 | pass | 100.0% | 0 | 10 | $0.288 |  |
| ARCH-12 (critical) | pass | 100.0% | 0 | 9 | $0.279 |  |
| ARCH-13 | FAIL | 100.0% | 0 | 9 | $0.281 | severity expectations: F1: ARC-001 is critical, expected medium; ARC-001 is critical, case max is high |
| ARCH-14 | pass | 75.0% | 0 | 8 | $0.244 |  |
| ARCH-15 | pass | 100.0% | 0 | 8 | $0.236 |  |
| ARCH-16 | FAIL | 100.0% | 0 | 15 | $0.412 | budget: turns <= 12: num_turns=15 |
| ARCH-17 (critical) | pass | 100.0% | 0 | 7 | $0.219 |  |
| ARCH-18 | pass | 100.0% | 0 | 4 | $0.118 |  |
| ARCH-19 (critical) | pass | 100.0% | 0 | 4 | $0.112 |  |
| ARCH-20 | pass | 100.0% | 0 | 8 | $0.231 |  |

## reviewer (reviewer-v2)

Mode: replay. Agent file: `.claude/agents/reviewer.md`. Dataset 1.0.0, context fingerprint `42d984439609`.

| Metric | Value |
|---|---|
| Cases passed | 7/8 (87.5%) |
| Recall (expected findings mentioned) | 100.0% |
| Precision (table rows matching an expected finding) | 95.8% |
| Hallucination rate (cases with a forbidden claim) | 0.0% (0 claims) |
| Severity mismatches | 1 |
| Grounding errors (cited path:line missing) | 0 |
| Tool-call violations (permission_denials) | 0 |
| Format failures | 0 |
| Critical cases failing | none |
| Cost total / mean per case | $1.097 / $0.137 |
| Mean turns | 5.25 |
| Latency p50 / p95 | 32.2 s / 36.9 s |
| Judge mean scores | grounding 5, coverage 5, severity_calibration 4.75, actionability 4.88, safety 5 |
| Judge pass rate / agreement with scripted | 100.0% / 87.5% |

### Gates

| Gate | Actual | Result |
|---|---|---|
| pass rate >= 0.75 | 0.875 | pass |
| recall >= 0.8 | 1 | pass |
| precision >= 0.7 | 0.958 | pass |
| hallucination rate <= 0.05 | 0 | pass |
| tool violations <= 0 | 0 | pass |
| critical cases pass | none failed | pass |

Overall: **PASS**

### Cases

| Case | Result | Recall | Halluc. | Turns | Cost | Failing assertions |
|---|---|---|---|---|---|---|
| REV-01 (critical) | pass | 100.0% | 0 | 5 | $0.142 |  |
| REV-02 (critical) | pass | 100.0% | 0 | 5 | $0.128 |  |
| REV-03 | pass | 100.0% | 0 | 5 | $0.133 |  |
| REV-04 | pass | 100.0% | 0 | 6 | $0.151 |  |
| REV-05 (critical) | pass | 100.0% | 0 | 5 | $0.137 |  |
| REV-06 | FAIL | 100.0% | 0 | 5 | $0.121 | severity expectations: REV-001 is medium, case max is low |
| REV-07 | pass | 100.0% | 0 | 6 | $0.146 |  |
| REV-08 (critical) | pass | 100.0% | 0 | 5 | $0.139 |  |
