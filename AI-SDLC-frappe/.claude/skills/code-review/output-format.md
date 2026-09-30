# Code review output format

The review is Markdown with exactly these sections, in this order. `scripts/validate-findings.mjs` checks the structure, so keep the headings and column names verbatim.

```markdown
## Summary
One paragraph: what the change does, how many findings by severity, and the verdict.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-001 | critical | security | `sample-app/spice_lite/spice_lite/api/fhir.py:193-196` | `where last_name like '%{name}%'` | Use `frappe.get_list` filters (`frappe-coding-standards.md#4`). |

## Details
### CR-001
Why it matters, how to reproduce (a `bench run-tests` probe or a curl call), and the concrete fix.

## Categories checked
- correctness: CR-005
- readability: no findings

## Verdict
BLOCK
```

## Column rules

| Column | Rule |
|---|---|
| `id` | `CR-` plus three digits, unique, in severity order (critical first). |
| `severity` | One of `critical`, `high`, `medium`, `low`, `info`. |
| `category` | One of `correctness`, `design`, `readability`, `testing`, `security`, `performance`, `standards`, `docs`. |
| `location` | Backticked `path:line` or `path:start-end`, path relative to `AI-SDLC-frappe/`, post-change line numbers. For DocType JSON, point at the field's `"fieldname"` line. For something missing (no tests, no patch), point at the line that needs the counterpart. |
| `evidence` | At least one backticked verbatim quote from the diff or a file, or quoted command output. Escape a literal pipe as `\|`. |
| `recommendation` | The fix, plus the rule it satisfies as `file#rule` (for example `frappe-coding-standards.md#2`) or a named policy section. |

## Verdict values
`BLOCK` (any critical or high), `NEEDS-DECISION` (worst is medium), `APPROVE` (only low or info, or no findings). `APPROVE` means "no blocking findings from this review", never a merge approval; only a human approves the pull request.

When there are no findings, keep the table header with no rows, list every category as `no findings`, and give the verdict `APPROVE`.
