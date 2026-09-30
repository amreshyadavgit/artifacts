"""Tests for parse_bench_tests.py. No bench or site needed. Run from AI-SDLC-frappe/:

	python3 -m unittest discover -s .claude/skills/run-tests/scripts -p 'test_*.py' -v

Every file in fixtures/ is real output captured from `bench --site test.localhost run-tests`
(Frappe 15.121.2, PostgreSQL 16); fixtures/README.md says which command and patch produced it.
"""

import io
import pathlib
import subprocess
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import parse_bench_tests as pbt  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
FIX = HERE / "fixtures"
SCRIPT = HERE / "parse_bench_tests.py"


def fixture(name: str) -> str:
	return (FIX / name).read_text()


def run_cli(*args: str, stdin: str = "") -> subprocess.CompletedProcess:
	return subprocess.run([sys.executable, str(SCRIPT), *args], input=stdin, capture_output=True, text=True)


class TestRealBenchOutput(unittest.TestCase):
	def test_green_suite_is_pass_despite_postgres_stack_dump(self):
		r = pbt.parse(fixture("green-app.txt"))
		self.assertEqual((r["verdict"], r["ran"], r["failures"], r["errors"]), ("PASS", 46, 0, 0))
		self.assertEqual(r["noise"]["error_in_query"], 1)
		self.assertEqual(r["problems"], [])

	def test_regression_is_one_fail_with_test_line(self):
		r = pbt.parse(fixture("regression-app.txt"))
		self.assertEqual((r["verdict"], r["ran"], r["failures"], r["errors"]), ("FAIL", 46, 1, 0))
		(p,) = r["problems"]
		self.assertEqual(p["kind"], "FAIL")
		self.assertEqual(p["test"], "test_final_requires_value_and_unit")
		self.assertEqual(p["case"], "TestSLObservation")
		self.assertEqual(p["message"], "AssertionError: ValidationError not raised by make_observation")
		self.assertEqual(
			p["test_at"], "sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/test_sl_observation.py:25"
		)

	def test_fail_and_errors_keep_app_frames_only(self):
		r = pbt.parse(fixture("fail-and-error-app.txt"))
		self.assertEqual((r["verdict"], r["failures"], r["errors"]), ("FAIL", 1, 2))
		errors = [p for p in r["problems"] if p["kind"] == "ERROR"]
		self.assertEqual(sorted(p["test"] for p in errors), ["test_clinician_can_search_and_read", "test_get_patient_shape"])
		for p in errors:
			self.assertEqual(p["raised_at"], "sample-app/spice_lite/spice_lite/api/mappers.py:46")
			self.assertIn("sample-app/spice_lite/spice_lite/api/fhir.py:60", p["app_frames"])
			self.assertFalse(any("apps/frappe" in f or "/usr/" in f for f in p["app_frames"]))

	def test_verbose_output_parses_the_same(self):
		r = pbt.parse(fixture("regression-verbose-module.txt"))
		self.assertEqual((r["verdict"], r["ran"], r["failures"]), ("FAIL", 7, 1))
		self.assertEqual(r["noise"]["messages"], 13)

	def test_zero_tests_is_not_a_pass(self):
		# bench printed "Ran 0 tests ... OK" and exited 0 for `--test test_nope`
		r = pbt.parse(fixture("unknown-test.txt"))
		self.assertEqual((r["verdict"], r["ran"]), ("NO TESTS", 0))

	def test_bad_module_is_crashed(self):
		r = pbt.parse(fixture("unknown-module.txt"))
		self.assertEqual(r["verdict"], "CRASHED")
		self.assertEqual(r["crash"], "ModuleNotFoundError: No module named 'spice_lite.tests.test_nope'")

	def test_summary_never_leaks_messages_locals_or_source(self):
		for name in ("regression-verbose-module.txt", "green-verbose-module.txt", "fail-and-error-app.txt"):
			out = pbt.render(pbt.parse(fixture(name)))
			self.assertNotIn("Message: ", out, name)  # frappe.msgprint text (document data)
			self.assertNotIn("self = <", out, name)  # tb_locals dump from bench --verbose
			self.assertNotIn('row["first_name"]', out, name)  # traceback source lines
			self.assertNotIn("invalid input syntax", out, name)  # the Postgres error text


class TestCli(unittest.TestCase):
	def test_exit_codes_follow_the_verdict(self):
		expected = {
			"green-app.txt": 0,
			"review-patch-app.txt": 0,
			"one-test.txt": 0,
			"regression-app.txt": 1,
			"fail-and-error-app.txt": 1,
			"unknown-test.txt": 2,
			"unknown-module.txt": 2,
		}
		for name, code in expected.items():
			self.assertEqual(run_cli(str(FIX / name)).returncode, code, name)

	def test_stdin_and_empty_input(self):
		ok = run_cli(stdin=fixture("regression-app.txt"))
		self.assertEqual(ok.returncode, 1)
		self.assertTrue(ok.stdout.startswith("## Test summary: FAIL\n"))
		self.assertEqual(run_cli(stdin="").returncode, 2)
		self.assertEqual(run_cli("/nonexistent/output.txt").returncode, 2)

	def test_testing_disabled_message(self):
		# the exact text bench prints when allow_tests is not set (frappe/commands/utils.py)
		text = "Testing is disabled for the site!\nYou can enable tests by entering following command:\nbench --site x.localhost set-config allow_tests true\n"
		r = pbt.parse(text)
		self.assertEqual(r["verdict"], "CRASHED")
		self.assertIn("allow_tests", r["crash"])


class TestPlainUnittestOutput(unittest.TestCase):
	"""Output produced by the standard library runner that bench wraps (TextTestRunner)."""

	def test_multiline_assertion_and_skip(self):
		class Sample(unittest.TestCase):
			def test_ok(self):
				pass

			def test_diff(self):
				self.assertEqual("MRN-000123", "MRN-000124")

			@unittest.skip("needs a site")
			def test_skipped(self):
				pass

		stream = io.StringIO()
		suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
		unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
		r = pbt.parse(stream.getvalue(), app="test_parse_bench_tests")
		self.assertEqual((r["verdict"], r["ran"], r["failures"], r["skipped"]), ("FAIL", 3, 1, 1))
		self.assertTrue(r["problems"][0]["message"].startswith("AssertionError: 'MRN-000123' != 'MRN-000124'"))
		self.assertIn("1 passed, 1 failed, 0 errors, 1 skipped", pbt.render(r))

	def test_long_messages_are_truncated(self):
		self.assertEqual(len(pbt.one_line("x" * 1000)), pbt.MAX_MESSAGE)


if __name__ == "__main__":
	unittest.main()
