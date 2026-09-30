# Captured bench output (test fixtures for parse_bench_tests.py)

Every `.txt` file is unedited `stdout+stderr` (`2>&1`) of a real run on the course bench:
Frappe 15.121.2, bench 5.31.0, PostgreSQL 16, site `test.localhost`, captured 2026-09-30 while
holding the shared bench lock. Patches were applied from `AI-SDLC-frappe/` with
`git apply --directory="$(git rev-parse --show-prefix)" <patch>` and reverted before the lock was released.

| File | Command (from the bench directory, as the bench user) | App state | bench exit code |
|---|---|---|---|
| `green-app.txt` | `bench --site test.localhost run-tests --app spice_lite` | unchanged | 0 |
| `review-patch-app.txt` | same | `docs/tutorials/level-2/patches/02-review-exercise.patch` | 0 (46 OK: the tests do not catch it) |
| `regression-app.txt` | same | `docs/tutorials/level-2/patches/02-final-without-value-regression.patch` | **0** (1 failure) |
| `fail-and-error-app.txt` | same | regression patch + `error-fixture.patch` | **0** (1 failure, 2 errors) |
| `green-verbose-module.txt` | `bench --verbose --site test.localhost run-tests --module spice_lite.clinical.doctype.sl_observation.test_sl_observation` | unchanged | 0 |
| `regression-verbose-module.txt` | same | regression patch | **0** (1 failure) |
| `one-test.txt` | `bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_get_patient_shape` | unchanged | 0 |
| `unknown-test.txt` | `bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_nope` | unchanged | **0** (Ran 0 tests, OK) |
| `unknown-module.txt` | `bench --site test.localhost run-tests --module spice_lite.tests.test_nope` | unchanged | 1 (ModuleNotFoundError) |

With `CI=1` in the environment the regression run exits 1 (`frappe/commands/utils.py` calls
`sys.exit(ret)` only when `CI` is set). That is why the run-tests skill takes its verdict from the
parser, never from bench's exit code.

`error-fixture.patch` exists only to produce ERROR (not FAIL) results for the parser tests: it makes
`get_patient` pass `doc.as_json()` (a string) to `patient_to_fhir`. It is not an exercise.
