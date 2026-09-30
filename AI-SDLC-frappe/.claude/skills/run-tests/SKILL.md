---
name: run-tests
description: Run the spice_lite Frappe tests on the test site with bench (whole app, one module, or one test method) and report a compact verdict with each failing or erroring test, its assertion message and the app lines involved. Use after any change under sample-app/ and before reporting a task complete.
when_to_use: When asked to run the tests, check whether the suite is green, verify a fix, or investigate a failing FrappeTestCase in spice_lite.
argument-hint: "[dotted.test.module [test_method]], e.g. spice_lite.tests.test_fhir_api test_lastn_returns_latest_per_patient"
arguments: [module, test]
allowed-tools:
  - Bash(cd /home/user/frappe-bench)
  - Bash(bench --site test.localhost run-tests *)
  - Bash(bench --site test.localhost list-apps)
  - Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py)
  - Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py *)
  - Bash(git status *)
---

# Run the spice_lite tests

Context captured when this skill was invoked:

- Apps installed on the test site (if this failed, the skill did not start: the site or its database is down):

!`cd /home/user/frappe-bench && bench --site test.localhost list-apps`

- Uncommitted changes under `sample-app/` (empty means none):

!`git status --short -- sample-app`

Requested module: "$module" · requested test: "$test" (both empty means the whole app).

## Procedure

1. **Validate the arguments.** `$module` must be empty or match `^spice_lite(\.[a-z0-9_]+)+$`.
   `$test` must be empty or match `^test_[a-z0-9_]+$`, and needs a module. Anything else (spaces
   inside a value, quotes, `;`, `$`, `|`, `&`, `/`, `--`): stop and reply that the argument was
   rejected. Never pass it to the shell.
2. **Run bench once**, from the bench directory, piping all output (stdout and stderr) into the parser:

   - whole app: `cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite 2>&1 | python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py`
   - module: `cd /home/user/frappe-bench && bench --site test.localhost run-tests --module $module 2>&1 | python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py`
   - one test: `cd /home/user/frappe-bench && bench --site test.localhost run-tests --module $module --test $test 2>&1 | python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py`

   Do not add `bench --verbose`: it prints `Message:` lines and local variables inside tracebacks,
   and it is not pre-approved. Do not run `bench` in any other form (no `console`, `execute`,
   `migrate`, `set-config`). Do not paste bench's raw output into your answer.
3. **Trust the parser's verdict, not an exit code.** `bench run-tests` exits 0 when tests fail
   unless `CI` is set; the parser exits 0 PASS, 1 FAIL, 2 NO TESTS or CRASHED. A non-zero exit here
   is expected when tests fail; continue to step 4.
4. **CRASHED or NO TESTS**: report the parser's line (for example a `ModuleNotFoundError`, or "Ran 0
   tests" for a test name that matches nothing) and stop. Do not guess at results.
5. **For each FAIL or ERROR**, read the test method at `test at:` and the app code at `raised at:`
   or in `app frames:` (controller, `api/fhir.py`, `api/mappers.py`). Write one sentence on the likely
   cause, labelled as a hypothesis, citing `path:line`. `git status` above tells you which changed files to read first.
6. **Do not edit any file.** This skill reports; fixing is a separate, explicit request.

## Output format

Reply with exactly these sections:

```markdown
<the parser's summary block, unchanged>

### Failure analysis
| Test | Assertion | Likely cause (hypothesis) | Code to look at |
|---|---|---|---|

### Verdict
READY (all tests pass) | NOT READY (<n> failing, <n> errors) | NOT RUN (<reason>)
```

Omit the Failure analysis table when everything passes. Never include patient names, MRNs, birth
dates or observation values in the reply, even synthetic ones from fixtures: refer to tests by
class and method name.
