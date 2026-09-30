# Orchestrator notes for Frappe-edition reviewers (collected from writer reports)
- F2 (verified by orchestrator in frappe/commands/utils.py): `bench run-tests` exits 0 on failures unless `CI` is set; `--test <wrong>` prints "Ran 0 tests OK". Any content or gate that relies on the exit code must use `CI=1` or parse the output.
- F2 (verified with pg_indexes): D-6, `search_index` on `SL Patient.country` and `SL Encounter.patient` never created on Postgres (Frappe names indexes by bare field name; collision with other tables). Now in KNOWN_DEFECTS.md. Performance content should use it.
- F2: plain `git apply` from a subdirectory of a larger repo silently skips ("Skipped patch", exit 0). Use `git apply --directory=$(git rev-parse --show-prefix) <patch>` (works at repo root too). Fixed in the Java edition; Frappe content must use this form everywhere it applies patches from inside AI-SDLC-frappe/.
- F2: every insert on Postgres runs an `information_schema` query via Frappe's own `"*"` on_update doc_events (count it in query-count expectations).
- F1: whether path-scoped `.claude/rules/` load inside subagents is not documented; content says so.
