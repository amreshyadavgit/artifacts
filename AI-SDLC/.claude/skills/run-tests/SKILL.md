---
name: run-tests
description: Run the sample-app Maven test suite (or one test class or method) and report a compact pass/fail summary with each failing test, its assertion message and the failing line. Use after any change under sample-app/ and before reporting a task complete.
when_to_use: When asked to run tests, check whether the build is green, verify a fix, or investigate a failing JUnit test in sample-app.
argument-hint: "[TestClass | TestClass#method]"
allowed-tools:
  - Bash(mvn -q -B test)
  - Bash(mvn -q -B test *)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/summarize-surefire.mjs *)
  - Bash(date *)
  - Bash(git status *)
---

# Run the sample-app tests

Context captured when this skill was invoked:

- Invoked at (UTC): !`date -u +%Y-%m-%dT%H:%M:%SZ`
- Uncommitted changes under `sample-app/` (empty means none):

!`git status --short -- sample-app`

Requested selection: "$ARGUMENTS" (empty means the whole suite).

## Procedure

1. **Validate the selection.** It must be empty or match `^[A-Za-z0-9_#*,]+$` (for example `SecurityTest` or `PatientApiTest#duplicateMrnIs409`). If it contains anything else (spaces, quotes, `;`, `$`, `|`, `&`, `/`), stop and reply that the argument was rejected. Never pass it to the shell.
2. **Run Maven exactly once**, from the project root, with one of:
   - whole suite: `mvn -q -B test -f sample-app/pom.xml`
   - selection: `mvn -q -B test -f sample-app/pom.xml -Dtest=<selection>`

   Maven exits non-zero when a test fails. That is expected; continue to step 3. Do not paste Maven's console output into your answer: it is hundreds of lines of Spring and `AUDIT` log lines.
3. **Summarize the reports** with the bundled script, passing the invocation time above so reports left over from an earlier run are ignored:

   `node ${CLAUDE_SKILL_DIR}/scripts/summarize-surefire.mjs sample-app/target/surefire-reports --since <Invoked at value>`

4. **If the summary says `NO REPORTS`**, the build failed before tests ran. Quote the first `[ERROR]` lines from the Maven output of step 2 (compilation error, unknown test pattern, dependency problem) and stop. Do not guess at test results.
5. **For each failing test**, read the test method at the `at:` line and the production code it exercises (controller, service, `SecurityConfig`, `GlobalExceptionHandler`). Write one sentence on the likely cause and label it a hypothesis. Cite `path:line`.
6. **Do not edit any file.** This skill reports; fixing is a separate, explicit request.

## Output format

Reply with exactly these sections:

```markdown
<the script's summary block, unchanged>

### Failure analysis
| Test | Assertion | Likely cause (hypothesis) | Code to look at |
|---|---|---|---|

### Verdict
READY (all tests pass) | NOT READY (<n> failing, <n> errors)
```

Omit the Failure analysis table when everything passes. Never include patient names, MRNs, birth dates or observation values in the reply, even if a test fixture contains synthetic ones: refer to tests by class and method name.
