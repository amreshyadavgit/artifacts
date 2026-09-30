# Applying the $lastn fix in a scratch copy

Never apply this to `AI-SDLC/sample-app/` itself: the course keeps the `TEACHING-DEFECT(perf-n+1)` in place (CLAUDE.md rule 6).

| File | Purpose |
|---|---|
| `lastn-set-based.patch` | Set-based `$lastn`: two native `ROW_NUMBER()` queries in `ObservationRepository`, a 100-subject cap and request-order results in `ObservationService.lastN` |
| `LastnQueryCountTest.java` | 4 MockMvc tests: statement count for 20 subjects (at most 2), code filter, unknown subjects skipped, 101 subjects rejected with 400 |
| `show-sql-before.log`, `show-sql-after.log` | Real `-Dspring.jpa.show-sql=true` excerpts (between the `LASTN_BEGIN` and `LASTN_QUERY_COUNT` markers) for the helper script |

```bash
# from AI-SDLC/
rm -rf /tmp/lastn-copy && cp -r sample-app /tmp/lastn-copy && rm -rf /tmp/lastn-copy/target
cp .claude/skills/performance-review/examples/lastn-fix/LastnQueryCountTest.java \
   /tmp/lastn-copy/src/test/java/org/example/fhir/

# 1. Prove the defect: 2 of 4 tests fail, 40 statements for 20 subjects
(cd /tmp/lastn-copy && mvn -q -B test -Dtest=LastnQueryCountTest) | grep -E "LASTN_QUERY_COUNT|Tests run"

# 2. Apply the fix and run the whole suite: exit 0 (29 tests), 1 statement for 20 subjects
(cd /tmp/lastn-copy && git apply "$OLDPWD/.claude/skills/performance-review/examples/lastn-fix/lastn-set-based.patch" \
  && mvn -q -B test | grep -E "LASTN_QUERY_COUNT|FAIL"; echo "mvn exit ${PIPESTATUS[0]}")

# 3. Optional: the same evidence from the SQL log
(cd /tmp/lastn-copy && mvn -q -B test -Dtest='LastnQueryCountTest#lastnIssuesAConstantNumberOfStatementsRegardlessOfSubjectCount' \
  -Dspring.jpa.show-sql=true) > /tmp/lastn-after.log
node .claude/skills/performance-review/scripts/count-queries.mjs /tmp/lastn-after.log --from LASTN_BEGIN --to LASTN_QUERY_COUNT

rm -rf /tmp/lastn-copy
```

The patch changes performance only. D-02 (null `effectiveDateTime` returned as latest) and D-03 (duplicate subject ids returned twice) from `sample-app/docs/KNOWN_DEFECTS.md` still reproduce in the patched copy (checked 2026-09-30); they are separate fixes with their own tests.

`git apply` works in a directory that is not a git repository; it applies the patch to the files in the current directory.
