# Eval run: architecture v2, reviewer v2

> **Synthetic recordings.** Replay mode scored hand-authored recordings from `evaluations/recordings/`. They exercise the harness offline; they are not measurements of a real model run.

## architecture (architect-v2)

Mode: replay. Agent file: `.claude/agents/architect.md`. Dataset 1.0.0, context fingerprint `79a4f7696fdb`.

| Metric | Value |
|---|---|
| Cases passed | 18/20 (90.0%) |
| Recall (expected findings mentioned) | 98.7% |
| Precision (table rows matching an expected finding) | 94.2% |
| Hallucination rate (cases with a forbidden claim) | 0.0% (0 claims) |
| Severity mismatches | 2 |
| Tool-call violations (permission_denials) | 0 |
| Format failures | 0 |
| Critical cases failing | none |
| Cost total / mean per case | $5.870 / $0.293 |
| Mean turns | 8.3 |
| Latency p50 / p95 | 62.5 s / 88.4 s |

### Gates

| Gate | Actual | Result |
|---|---|---|
| pass rate >= 0.8 | 0.9 | pass |
| recall >= 0.8 | 0.987 | pass |
| precision >= 0.7 | 0.942 | pass |
| hallucination rate <= 0.05 | 0 | pass |
| tool violations <= 0 | 0 | pass |
| critical cases pass | none failed | pass |

Overall: **PASS**

### Cases

| Case | Result | Recall | Halluc. | Turns | Cost | Failing assertions |
|---|---|---|---|---|---|---|
| ARCH-01 | pass | 100.0% | 0 | 8 | $0.270 |  |
| ARCH-02 | pass | 100.0% | 0 | 9 | $0.310 |  |
| ARCH-03 | pass | 100.0% | 0 | 10 | $0.360 |  |
| ARCH-04 (critical) | pass | 100.0% | 0 | 9 | $0.340 |  |
| ARCH-05 | pass | 100.0% | 0 | 7 | $0.250 |  |
| ARCH-06 | pass | 100.0% | 0 | 6 | $0.190 |  |
| ARCH-07 | pass | 100.0% | 0 | 9 | $0.330 |  |
| ARCH-08 | pass | 100.0% | 0 | 8 | $0.280 |  |
| ARCH-09 (critical) | pass | 75.0% | 0 | 10 | $0.380 |  |
| ARCH-10 | pass | 100.0% | 0 | 10 | $0.370 |  |
| ARCH-11 | pass | 100.0% | 0 | 8 | $0.290 |  |
| ARCH-12 | pass | 100.0% | 0 | 8 | $0.270 |  |
| ARCH-13 | FAIL | 100.0% | 0 | 9 | $0.320 | severity expectations: F2: ARC-002 is critical, expected medium; ARC-002 is critical, case max is high |
| ARCH-14 | pass | 100.0% | 0 | 8 | $0.280 |  |
| ARCH-15 | pass | 100.0% | 0 | 8 | $0.270 |  |
| ARCH-16 | FAIL | 100.0% | 0 | 15 | $0.520 | budget: turns <= 12: num_turns=15 |
| ARCH-17 (critical) | pass | 100.0% | 0 | 7 | $0.260 |  |
| ARCH-18 | pass | 100.0% | 0 | 5 | $0.170 |  |
| ARCH-19 (critical) | pass | 100.0% | 0 | 4 | $0.130 |  |
| ARCH-20 | pass | 100.0% | 0 | 8 | $0.280 |  |

## reviewer (reviewer-v2)

Mode: replay. Agent file: `.claude/agents/reviewer.md`. Dataset 1.0.0, context fingerprint `8da01c7674ab`.

| Metric | Value |
|---|---|
| Cases passed | 7/8 (87.5%) |
| Recall (expected findings mentioned) | 95.2% |
| Precision (table rows matching an expected finding) | 100.0% |
| Hallucination rate (cases with a forbidden claim) | 0.0% (0 claims) |
| Severity mismatches | 0 |
| Tool-call violations (permission_denials) | 0 |
| Format failures | 0 |
| Critical cases failing | none |
| Cost total / mean per case | $1.100 / $0.138 |
| Mean turns | 4.63 |
| Latency p50 / p95 | 33.4 s / 41.9 s |

### Gates

| Gate | Actual | Result |
|---|---|---|
| pass rate >= 0.75 | 0.875 | pass |
| recall >= 0.8 | 0.952 | pass |
| precision >= 0.7 | 1 | pass |
| hallucination rate <= 0.05 | 0 | pass |
| tool violations <= 0 | 0 | pass |
| critical cases pass | none failed | pass |

Overall: **PASS**

### Cases

| Case | Result | Recall | Halluc. | Turns | Cost | Failing assertions |
|---|---|---|---|---|---|---|
| REV-01 (critical) | pass | 100.0% | 0 | 5 | $0.170 |  |
| REV-02 (critical) | pass | 100.0% | 0 | 4 | $0.110 |  |
| REV-03 | pass | 100.0% | 0 | 6 | $0.190 |  |
| REV-04 | pass | 100.0% | 0 | 5 | $0.150 |  |
| REV-05 (critical) | pass | 100.0% | 0 | 4 | $0.120 |  |
| REV-06 | pass | 100.0% | 0 | 3 | $0.070 |  |
| REV-07 | FAIL | 66.7% | 0 | 5 | $0.140 | must-mention: recall >= 0.75: missed F3 (Names raw2 and p2 do not say what they are (readability)) |
| REV-08 (critical) | pass | 100.0% | 0 | 5 | $0.150 |  |
