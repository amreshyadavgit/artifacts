---
name: code-review
description: Review a git diff of the spice_lite Frappe app (Python, DocType JSON, patches.txt, hooks.py, fixtures) against context/standards and return findings in the canonical format (id, severity, category, location, evidence, recommendation) with a verdict. Inside AI-SDLC-frappe this project skill replaces the bundled /code-review.
when_to_use: After any change under sample-app/ and before a pull request is opened; when asked to "review my changes", "review this diff", "review against main", or when the reviewer agent starts work. Pass a base ref (for example main or HEAD~1) to review committed work instead of the working tree.
argument-hint: "[base-ref]"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git status *) Bash(git log *) Bash(git show *)
disallowed-tools: Edit Write NotebookEdit
---

# Code review against the spice_lite Frappe standards

You are reviewing a change to the Frappe v15 app `spice_lite`. You do not edit files and you do not run bench. You produce findings that a human reviewer can verify in under a minute each.

## Change under review

Base ref argument: "$ARGUMENTS" (empty means: uncommitted working-tree changes against `HEAD`).

Files changed in the working tree (untracked files appear only in the status list below):

!`git diff --stat HEAD -- sample-app`

!`git status --short -- sample-app`

Working-tree diff for `sample-app/` against `HEAD`:

!`git diff HEAD -- sample-app`

If the base ref argument is not empty, ignore the working-tree diff above and run `git diff <base-ref>...HEAD -- sample-app` and `git log --oneline <base-ref>..HEAD` yourself. The argument must match `^[A-Za-z0-9._/~^-]+$`; if it does not, stop and say the argument was rejected. Never pass it to the shell unvalidated.

If both diffs are empty, reply exactly `No changes to review.` and stop.

If `git status` lists untracked (`??`) files under `sample-app/`, Read them in full: they are part of the change but invisible to `git diff`.

## Procedure

1. **Scope.** List every changed file and sort it into: Python (`api/`, controllers, `audit.py`, patches), DocType JSON (`**/doctype/*/*.json`), `patches.txt`, `hooks.py`, fixtures (`**/fixtures/*.json`), tests. For each hunk note the post-change line numbers from `@@ -a,b +c,d @@`; `location` values use post-change line numbers.
2. **Load the standards you will cite.** Read `context/standards/review-standards.md` (format, severities, categories, the rule that DocType JSON, `patches.txt`, `hooks.py` and fixtures are reviewed together with the Python) and `context/standards/frappe-coding-standards.md`. Read `context/standards/api-standards.md` if a whitelisted method changed, and `context/standards/testing-standards.md` always. For anything touching logging, errors, permissions or patient data, also read `context/security/phi-and-secrets-policy.md` and the PHI table in `context/domain/spice-lite-glossary.md`.
3. **Read beyond the hunk.** Open each changed file in full. Grep for callers of changed functions and for the tests that cover them (`sample-app/spice_lite/spice_lite/tests/`, `clinical/doctype/*/test_*.py`). A hunk that looks fine can break an invariant held elsewhere: `search_patients` rejecting `%`/`_` (D-5), `log_access` taking names only, `final` Observations being immutable.
4. **Pair schema with migration.** For every DocType JSON change, check `patches.txt` and `patches/` in the same diff. A field that is added as `reqd`, renamed, retyped, or whose data must change without a patch is a finding. Remember that `bench run-tests` does not migrate: a green suite says nothing about a DocType JSON change.
5. **Walk the checklist** in [review-checklist.md](review-checklist.md), category by category. It maps each check to a rule number in `context/standards/`.
6. **Write findings** in the exact format in [output-format.md](output-format.md). One finding per root cause; mention a second location in the evidence instead of duplicating the finding.
7. **Say what is clean.** For every category you checked with no findings, write the category name followed by `: no findings` in the "Categories checked" list. Silence is not evidence.
8. **Verdict.** `BLOCK` if any finding is `critical` or `high`; `NEEDS-DECISION` if the worst is `medium`; otherwise `APPROVE`. This follows `context/standards/review-standards.md`. `APPROVE` is never a merge approval.

## Severity guide (review-standards.md and the PHI policy)

| Severity | Use when | Example in this codebase |
|---|---|---|
| `critical` | Exploitable now, guest access to clinical data, PHI leaves the service | `@frappe.whitelist(allow_guest=True)` on a patient lookup; user input in an f-string passed to `frappe.db.sql` |
| `high` | Permission bypass on a read or write path, PHI in logs or Error Log, wrong behaviour on a normal input, schema change without a patch, new method without tests | `frappe.get_all` in a whitelisted method with no `frappe.has_permission`; `frappe.log_error(message=f"...{value}...")`; `reqd` field added with no backfill patch |
| `medium` | Standards violation with limited blast radius | missing `log_access`; unbounded result set; `frappe.enqueue` without `queue`/`timeout` |
| `low` | Hardening, naming, docs drift | module docstring endpoint list not updated |
| `info` | Observation, no action required | pre-existing `TEACHING-DEFECT(perf-n+1)` next to the change |

## Rules

- Quote evidence verbatim from the diff or a file (inside backticks), or quote command output. Never paraphrase code.
- Every finding cites the violated rule as `file#rule`, for example `frappe-coding-standards.md#4`, or a named section of the PHI policy or threat model.
- Only report problems introduced or made worse by this change. A pre-existing problem you notice goes in as `info`, labelled "pre-existing".
- `TEACHING-DEFECT(perf-n+1)` in `api/fhir.py` `lastn()` is intentional (see `sample-app/docs/KNOWN_DEFECTS.md`). Do not report it unless the diff touches that loop. The same holds for the open defects D-1 and D-3.
- Frappe facts that reviewers get wrong: `frappe.get_all` does not check permissions; `permission_query_conditions` affects `get_list` only; `has_permission` Frappe hooks can only deny; a DocType JSON change is re-imported on migrate when its content hash changes, so a missing `modified` bump is not a finding for DocTypes.
- Never include PHI in a finding. Quote identifiers and code, not names, MRNs or values.
- Do not approve a change you authored in this session. Say so and stop.
- You cannot run tests from this skill. If a finding depends on runtime behaviour, write "reasoned from code" in the evidence, or ask the tester agent (run-tests skill) to confirm.
