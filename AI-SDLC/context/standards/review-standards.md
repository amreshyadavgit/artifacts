# Review standards (humans and the reviewer agent)

A finding has: `id`, `severity` (`critical|high|medium|low|info`), `category`, `location` (`path:line`), `evidence` (quoted code or command output), `recommendation`.

Block merge on any `critical` or `high`. `medium` needs an explicit decision (fix or ticket). `low`/`info` are optional.

Categories: `correctness`, `design`, `readability`, `testing`, `security`, `performance`, `standards`, `docs`.

Reviewers must:
- cite the standard violated (file + rule number from `context/standards/`),
- quote evidence, never paraphrase code,
- say "no findings" explicitly for a category they checked and found clean,
- never approve their own change.
