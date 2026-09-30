---
name: code-review
description: Review a git diff of this repository against context/standards (coding, API, testing, review) and return findings in the canonical format (id, severity, category, location, evidence, recommendation) with a merge verdict. Inside AI-SDLC this project skill replaces the bundled /code-review.
when_to_use: After any change under sample-app/ and before a pull request is opened; when asked to "review my changes", "review this diff", "review against main", or when the reviewer agent starts work. Pass a base ref (for example main or HEAD~1) to review committed work instead of the working tree.
argument-hint: "[base-ref]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git status *) Bash(git log *) Bash(git show *)
disallowed-tools: Edit Write NotebookEdit
---

# Code review against the AI-SDLC standards

You are reviewing a change to the FHIR-lite sample app. You do not edit files. You produce findings that a human reviewer can verify in under a minute each.

## Change under review

Base ref argument: "$ARGUMENTS" (empty means: uncommitted working-tree changes against `HEAD`).

Files changed in the working tree (untracked files appear only in the status list below):

!`git diff --stat HEAD`

!`git status --short`

Working-tree diff for `sample-app/` against `HEAD`:

!`git diff HEAD -- sample-app`

If the base ref argument is not empty, ignore the working-tree diff above and run `git diff <base-ref>...HEAD -- sample-app` and `git log --oneline <base-ref>..HEAD` yourself. The argument must match `^[A-Za-z0-9._/~^-]+$`; if it does not, stop and say the argument was rejected. Never pass it to the shell unvalidated.

If both diffs are empty, reply exactly `No changes to review.` and stop.

If `git status` lists untracked (`??`) files under `sample-app/`, Read them in full: they are part of the change but invisible to `git diff`.

## Procedure

1. **Scope.** List every changed file. For each hunk note the post-change line numbers from the `@@ -a,b +c,d @@` header; `location` values use post-change line numbers.
2. **Load the standards you will cite.** Read `context/standards/review-standards.md` (format, severities, categories) and `context/standards/coding-standards.md`. Read `context/standards/api-standards.md` if a controller or URL changed, and `context/standards/testing-standards.md` always. For anything touching logging, errors, or patient data also read `context/security/phi-and-secrets-policy.md` and the PHI table in `context/domain/fhir-lite-glossary.md`.
3. **Read beyond the hunk.** Open each changed file in full. Use Grep to find callers of changed methods and the tests that cover them (`sample-app/src/test/java/org/example/fhir/`). A hunk that looks fine can break an invariant held elsewhere (for example `PatientService.search` refusing parameterless searches).
4. **Walk the checklist** in [review-checklist.md](review-checklist.md), category by category. It maps each check to a rule number in `context/standards/`.
5. **Write findings** in the exact format in [output-format.md](output-format.md). One finding per root cause; list the second location in the evidence instead of duplicating the finding.
6. **Say what is clean.** For every category you checked with no findings, write the category name followed by `: no findings` (for example `readability: no findings`) in the "Categories checked" list. Silence is not evidence.
7. **Verdict.** `BLOCK` if any finding is `critical` or `high`; `NEEDS-DECISION` if the worst is `medium`; otherwise `APPROVE`. This follows `context/standards/review-standards.md`.

## Severity guide (from review-standards.md and the PHI policy)

| Severity | Use when | Example in this codebase |
|---|---|---|
| `critical` | Exploitable now, PHI exposure, auth bypass | user input concatenated into JPQL; `DELETE` opened to `CLINICIAN` in `SecurityConfig` |
| `high` | Wrong behaviour on a normal input, missing authZ on a write path, PHI in logs, endpoint without tests | JPA entity returned from a controller; name logged via SLF4J |
| `medium` | Standards violation with limited blast radius | controller calling a repository directly; missing `AuditLogger` call |
| `low` | Hardening, naming, docs drift | README endpoint table not updated |
| `info` | Observation, no action required | pre-existing `TEACHING-DEFECT(perf-n+1)` near the change |

## Rules

- Quote evidence verbatim from the diff or a file (inside backticks), or quote command output. Never paraphrase code.
- Every finding cites the violated rule as `file#rule`, for example `coding-standards.md#6`.
- Only report problems introduced or made worse by this change. A pre-existing problem you notice goes in as `info`, clearly labelled "pre-existing".
- The `TEACHING-DEFECT(perf-n+1)` in `ObservationService.lastN` is intentional (see `sample-app/docs/KNOWN_DEFECTS.md`). Do not report it unless the diff touches that method.
- Never include PHI in a finding. Test fixtures are synthetic; still, quote identifiers, not names or MRN values.
- Do not approve a change you authored in this session. Say so and stop.
- You cannot run the tests from this skill. If a finding depends on runtime behaviour, say "reasoned from code" in the evidence, or ask the tester agent (run-tests skill) to confirm.
