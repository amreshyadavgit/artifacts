# Review standards (humans and the reviewer agent)

A finding has: `id`, `severity` (`critical|high|medium|low|info`), `category`, `location` (`path:line`), `evidence` (quoted code or command output), `recommendation`.

Block merge on any `critical` or `high`. `medium` needs an explicit decision (fix or ticket). `low`/`info` are optional.

Categories: `correctness`, `design`, `readability`, `testing`, `security`, `performance`, `standards`, `docs`.

Reviewers must:
- cite the standard violated (file + rule number from `context/standards/`),
- quote evidence, never paraphrase code,
- say "no findings" explicitly for a category they checked and found clean,
- end with a verdict: `BLOCK` (any critical/high), `NEEDS-DECISION` (worst is medium) or `APPROVE` (only low/info or nothing). `APPROVE` means "no blocking findings from this review"; it is never a merge approval, which only a human gives on the PR,
- never review or approve their own change.
- for Frappe changes, review the DocType JSON diff, `patches.txt`, `hooks.py`, and fixtures together with the Python diff; a schema change without a patch or a permissions-array change without security review is at least `high`.
