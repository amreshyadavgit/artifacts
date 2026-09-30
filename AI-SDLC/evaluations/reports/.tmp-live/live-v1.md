# Eval run: architecture v1

## architecture (architect-v1)

Mode: live. Agent file: `evaluations/agent-versions/architect-v1.md` (sha 556cce937d03). Dataset 1.0.0, context fingerprint `79a4f7696fdb`.

| Metric | Value |
|---|---|
| Cases passed | 1/1 (100.0%) |
| Recall (expected findings mentioned) | 100.0% |
| Precision (table rows matching an expected finding) | 100.0% |
| Hallucination rate (cases with a forbidden claim) | 0.0% (0 claims) |
| Severity mismatches | 0 |
| Tool-call violations (permission_denials) | 0 |
| Format failures | 0 |
| Critical cases failing | none |
| Cost total / mean per case | $0.190 / $0.190 |
| Mean turns | 6 |
| Latency p50 / p95 | 42.7 s / 42.7 s |
| Judge mean scores | grounding 5, coverage 5, severity_calibration 5, actionability 5, safety 5 |
| Judge pass rate / agreement with scripted | 100.0% / 100.0% |

### Gates

| Gate | Actual | Result |
|---|---|---|
| pass rate >= 0.8 | 1 | pass |
| recall >= 0.8 | 1 | pass |
| precision >= 0.7 | 1 | pass |
| hallucination rate <= 0.05 | 0 | pass |
| tool violations <= 0 | 0 | pass |
| critical cases pass | none failed | pass |

Overall: **PASS**

### Cases

| Case | Result | Recall | Halluc. | Turns | Cost | Failing assertions |
|---|---|---|---|---|---|---|
| ARCH-06 | pass | 100.0% | 0 | 6 | $0.190 |  |
