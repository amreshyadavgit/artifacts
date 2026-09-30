# Skill asset: run-tests (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/run-tests/` (`SKILL.md`, `scripts/parse_bench_tests.py`, `scripts/test_parse_bench_tests.py`, `scripts/fixtures/` with 9 captured bench outputs) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/spice-core |
| Consumers | `developer` and `tester` subagents (preloaded via `skills: [run-tests, ...]`), humans via `/run-tests` |
| Invocation | `/run-tests` (whole app), `/run-tests spice_lite.tests.test_fhir_api`, `/run-tests spice_lite.tests.test_fhir_api test_get_patient_shape` |
| Writes files | No. It runs `bench --site test.localhost run-tests` and the parser; it never edits files |
| Taught in | module `02-first-agent-skill-tools` |
| Golden cases | [tests/cases.json](tests/cases.json): 6 deterministic, 2 live |

## Purpose
Runs the `spice_lite` tests on `test.localhost` with `bench --site test.localhost run-tests` (whole app, one module, or one test method), pipes the output through `parse_bench_tests.py`, and reports a compact verdict (PASS, FAIL, NO TESTS, CRASHED) with each failing test, its assertion message and the app lines involved. The parser exists because `bench run-tests` exits 0 on failures unless `CI` is set, prints `Ran 0 tests ... OK` for a selection that matches nothing, and floods the output with Postgres stack dumps that are not failures.

## Inputs and arguments
Two positional arguments (`arguments: [module, test]`): `$module` must match `^spice_lite(\.[a-z0-9_]+)+$`, `$test` must match `^test_[a-z0-9_]+$`. Anything else is rejected before any shell command. Two injections at load time: `bench --site test.localhost list-apps` and `git status --short -- sample-app`.

## Output contract
The parser's summary block unchanged, a Failure analysis table (test, assertion, likely cause labelled as a hypothesis, `path:line`), and one verdict line: `READY`, `NOT READY (<n> failing, <n> errors)` or `NOT RUN (<reason>)`. No patient data, even synthetic.

## Bench assumptions
Bench at `/home/user/frappe-bench`, site `test.localhost` with `allow_tests`; runs as the bench user. Only `run-tests` and `list-apps` are pre-approved; `--verbose`, `console`, `execute` and `migrate` are not.

## Cost notes
Default model; the whole-app run takes about 3 s on the course bench, and the parser keeps the tool result under 2 KB.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# rt-01-parser-unit-tests: The parser's 12 unit tests pass without a bench
python3 -m unittest discover -s .claude/skills/run-tests/scripts -p 'test_*.py' 2>&1 | tail -3
# rt-02-green-run: A green whole-app capture is PASS with 46 tests and the D-2 query error counted, not shown
python3 .claude/skills/run-tests/scripts/parse_bench_tests.py .claude/skills/run-tests/scripts/fixtures/green-app.txt; echo "exit=$?"
# rt-03-regression-is-fail: The regression capture (bench exited 0) is FAIL and names the failing test and its line
python3 .claude/skills/run-tests/scripts/parse_bench_tests.py .claude/skills/run-tests/scripts/fixtures/regression-app.txt; echo "exit=$?"
# rt-04-zero-tests-is-not-pass: A --test that matches nothing is NO TESTS with exit 2, although bench printed OK
python3 .claude/skills/run-tests/scripts/parse_bench_tests.py .claude/skills/run-tests/scripts/fixtures/unknown-test.txt; echo "exit=$?"
# rt-05-crash: An unknown --module is CRASHED with the ModuleNotFoundError
python3 .claude/skills/run-tests/scripts/parse_bench_tests.py .claude/skills/run-tests/scripts/fixtures/unknown-module.txt; echo "exit=$?"
# rt-06-no-msgprint-text: The verbose capture's Message: lines and tb_locals never reach the summary
grep -cE '^\s*Message:|self = <' .claude/skills/run-tests/scripts/fixtures/regression-verbose-module.txt; python3 .claude/skills/run-tests/scripts/parse_bench_tests.py .claude/skills/run-tests/scripts/fixtures/regression-verbose-module.txt | grep -cE '^\s*Message:|self = <'
```

## Known limitations
- Shares one site with other users: hold `/tmp/spice-bench.lock` when several people run it on the course container.
- The parser recognises the unittest output of Frappe 15 (`bench 5.x`); a new runner format needs a new fixture.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
