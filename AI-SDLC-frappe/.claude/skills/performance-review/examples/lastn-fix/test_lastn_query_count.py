# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Query-count test for lastn() (performance-review skill, TEACHING-DEFECT(perf-n+1)).

Copy into spice_lite/tests/ for a run (see APPLY.md). On the shipped app the constant-count test
FAILS and prints the measured counts; with lastn-set-based.patch applied it passes.
All data is synthetic and rolled back at class end (FrappeTestCase).
"""

import inspect
from contextlib import contextmanager

import frappe
from frappe.tests.utils import FrappeTestCase

from spice_lite.api import fhir
from spice_lite.tests.utils import CLINICIAN, call, ensure_test_users, make_observation, make_patient

MAX_QUERIES = 6  # constant: does not depend on the number of subjects
OBS_PER_PATIENT = 4
SUBJECTS = 100  # MAX_LASTN_SUBJECTS


def measure(fn, **kwargs):
	"""Run fn(**kwargs) through call(); return (status, body, statements, rows_returned_by_sql)."""
	executed, rows = [], [0]
	orig_sql = frappe.db.__class__.sql

	def _sql(db, *args, **kw):
		result = orig_sql(db, *args, **kw)
		executed.append(" ".join(str(db.last_query).split()))  # the statement as sent, on one line
		if isinstance(result, list | tuple):
			rows[0] += len(result)
		return result

	frappe.db.__class__.sql = _sql
	try:
		status, body = call(fn, **kwargs)
	finally:
		frappe.db.__class__.sql = orig_sql
	return status, body, executed, rows[0]


class PostgresQueryCountMixin:
	"""FrappeTestCase.assertQueryCount crashes on Postgres in frappe v15 (TypeError: LazyDecode in
	the eagerly built failure message). Same fix as the one lastn-set-based.patch adds to
	spice_lite/tests/utils.py; defined here too so this file also runs on the unpatched app."""

	@contextmanager
	def assertQueryCount(self, count):
		db_class = frappe.db.__class__  # frappe.db is a LocalProxy; type() would return the proxy class
		lazy = inspect.getattr_static(db_class, "last_query", None)
		own = "last_query" in vars(db_class)
		if isinstance(lazy, property):
			db_class.last_query = property(lambda db: str(lazy.fget(db)))
		try:
			with super().assertQueryCount(count):
				yield
		finally:
			if isinstance(lazy, property):
				if own:
					db_class.last_query = lazy
				else:
					del db_class.last_query


class TestLastnQueryCount(PostgresQueryCountMixin, FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()
		cls.subjects = []
		for _ in range(SUBJECTS):
			p = make_patient()
			for minutes in range(OBS_PER_PATIENT):
				make_observation(p.name, minutes_ago=10 + minutes, value=120.0 + minutes)
			make_observation(p.name, minutes_ago=1, code="8867-4", unit="/min", value=70.0)
			cls.subjects.append(p.name)

	def tearDown(self):
		frappe.set_user("Administrator")

	def _warm(self):
		call(fhir.lastn, subjects=self.subjects, code="8480-6")  # meta, roles and permission caches

	def test_lastn_query_count_is_constant(self):
		frappe.set_user(CLINICIAN)
		self._warm()
		counts = {}
		for n in (1, 20, 100):
			status, body, statements, rows = measure(fhir.lastn, subjects=self.subjects[:n], code="8480-6")
			self.assertEqual((status, body["total"]), (200, n))
			counts[n] = len(statements)
			print(f"LASTN_QUERY_COUNT subjects={n} queries={len(statements)} rows_returned_by_sql={rows}")
			if n == 20:  # input for scripts/count-queries.mjs (synthetic data only)
				print("LASTN_BEGIN subjects=20")
				for sql in statements:
					print("SQL: " + sql)
				print("LASTN_END")
		with self.assertQueryCount(MAX_QUERIES):
			call(fhir.lastn, subjects=self.subjects, code="8480-6")
		self.assertEqual(counts[1], counts[100], f"query count grows with subjects: {counts}")

	def test_lastn_still_returns_the_latest_per_patient(self):
		frappe.set_user(CLINICIAN)
		status, body = call(fhir.lastn, subjects=self.subjects[:3] + ["SLP-MISSING"], code="8480-6")
		self.assertEqual((status, body["total"]), (200, 3))
		self.assertEqual([e["resource"]["subject"]["reference"] for e in body["entry"]],
			["Patient/" + s for s in self.subjects[:3]])  # request order kept, unknown id skipped
		for entry in body["entry"]:
			self.assertEqual(entry["resource"]["valueQuantity"]["value"], 120.0)  # minutes_ago=10 is newest

	def test_lastn_rejects_more_than_100_subjects(self):
		status, body = call(fhir.lastn, subjects=[f"SLP-{i:05d}" for i in range(101)])
		self.assertEqual((status, body["issue"][0]["code"]), (400, "too-costly"))
