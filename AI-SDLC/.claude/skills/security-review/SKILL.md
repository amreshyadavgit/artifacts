---
name: security-review
description: Security review of the FHIR-lite sample app or a pending diff covering authN, authZ, input validation, secrets, PHI, SQL injection, API security, dependencies, logging and audit. Produces a JSON report valid against report.schema.json and a Markdown rendering. Replaces the bundled /security-review inside this project.
when_to_use: Before merging any change under sample-app/ or sample-app/k8s/, when a workflow step needs a security gate, or when someone asks whether code can leak PHI or bypass authorization.
argument-hint: "[diff | path | git-range]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git log *) Bash(node */security-review/scripts/render-report.mjs *)
---

# Security review (healthcare, PHI-first)

You are reviewing a FHIR-lite clinical API. A defect that writes one patient's name to a log is a reportable privacy incident, so PHI handling is checked first and never downgraded to "style".

Scope requested: `$ARGUMENTS`

Pending changes in the working tree (injected before you start):
!`git diff --stat`

## 1. Decide the scope
- Empty or `diff`: review `git diff` (unstaged + staged) and the files it touches, plus anything those files call.
- A path (for example `sample-app/`): review everything under it.
- A git range (for example `main...HEAD`): run `git diff <range>` and review the touched files.
Read `context/security/threat-model.md` and `context/security/phi-and-secrets-policy.md` before the first finding. Read `context/domain/fhir-lite-glossary.md` for the PHI table.

## 2. Work through every category
Use [checklist.md](checklist.md). It lists, per category, what to open and which Grep patterns to run. Cover all ten categories, in this order:

1. `phi` (PHI and PII exposure: logs, errors, responses, fixtures)
2. `logging-audit` (AuditLogger coverage, what an auditor can reconstruct)
3. `authn`
4. `authz` (role checks and object-level access)
5. `input-validation`
6. `injection` (SQL/JPQL, native queries, header or log injection)
7. `api-security` (unbounded requests, enumeration, error shape, TLS)
8. `secrets`
9. `dependencies`
10. `infrastructure` (k8s manifests, Dockerfile, compose)

A category you checked and found clean goes into `checkedClean` with the evidence you looked at. Never leave a category silent.

## 3. Severity (use exactly this scale)
| Severity | Use when | Examples in this repo |
|---|---|---|
| `critical` | Exploitable now by the caller: auth bypass, PHI disclosed to an unauthorized party, injectable query | `permitAll()` on `/fhir/**`; JPQL built with `+ family +` |
| `high` | PHI written to an internal sink (logs, traces), missing authZ on a write path, secret committed | a log line with `getFamilyName()`; DELETE reachable by CLINICIAN |
| `medium` | Defence-in-depth gap or availability risk an attacker can drive | unbounded `subjects` list; searches not recorded per patient in the audit trail |
| `low` | Hardening | missing `seccompProfile`, mutable image tag |
| `info` | Observation, accepted risk, or something you could not verify | CVE status not checked offline |

Rate the realistic impact in this deployment, not the worst case in theory. If you are unsure between two levels, pick the higher one and say why in `evidence`.

## 4. Evidence rules
- `location` is `path:line` relative to `AI-SDLC/`, for example `sample-app/src/main/java/org/example/fhir/error/GlobalExceptionHandler.java:71`.
- `evidence` quotes the code or command output. Do not paraphrase.
- **Never copy PHI into the report.** If evidence would contain a patient value, replace it with `[REDACTED]` and describe the field (for example "given name"). Synthetic values such as `MRN-000123` are fine.
- If you reasoned about behaviour you did not observe (for example the exact PostgreSQL error text), set `confidence` to `medium` or `low` and say what would confirm it.
- Add a CWE id when one clearly applies (`CWE-532` for sensitive data in logs, `CWE-639` for object-level authorization, `CWE-89` for SQL injection, `CWE-770` for unbounded allocation).

## 5. Output
Produce exactly one JSON object that validates against [report.schema.json](report.schema.json). A one-finding example is in [examples/example-report.json](examples/example-report.json).

- `summary` counts must equal the counts in `findings`.
- `verdict`: `block` if any `critical` or `high`; `needs-decision` if any `medium`; otherwise `pass`.
- `limitations` lists what you could not check (no network for CVE lookups, no running cluster, and so on).

If you can write files, save the JSON to the run folder given in the task (for example `.ai-sdlc/runs/<run-id>/security-report.json`) and render it:

```bash
node .claude/skills/security-review/scripts/render-report.mjs .ai-sdlc/runs/<run-id>/security-report.json --out .ai-sdlc/runs/<run-id>/04-security.md
```

The renderer validates the schema, checks the summary counts, rejects evidence that looks like a real MRN, and exits `1` with `--fail-on high` when the report has a high or critical finding. If you cannot write files, return the JSON as your final answer inside a single fenced `json` block.

## 6. Do not
- Do not edit source files. You report; the developer agent fixes.
- Do not read `.env*`, `**/secrets/**`, `sample-app/data/real/**` or `**/*.phi.*` (denied in `.claude/settings.json`; do not try another route to them).
- Do not report the `TEACHING-DEFECT(perf-n+1)` as a performance bug here. Report its security angle only (unbounded input, `CWE-770`) and point to the performance-review skill.
- Do not mark a finding `critical` or `high` without quoted evidence.
