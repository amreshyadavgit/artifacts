# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""lastn test plan, implemented (test-strategy skill example).

Integration tests: they need a site. To run them, copy this file to
sample-app/spice_lite/spice_lite/tests/test_lastn_plan.py and run, from the bench:

    bench --site test.localhost run-tests --module spice_lite.tests.test_lastn_plan

Tests marked @unittest.skip("SL-13x ...") are `new-failing` in the plan: they fail today
because of a defect the plan found. Remove the skip line to watch them fail.
All data is synthetic.
"""

import unittest
from contextlib import contextmanager
from unittest import mock

import frappe
from frappe.permissions import add_user_permission
from frappe.tests.utils import FrappeTestCase

from spice_lite.api import fhir
from spice_lite.tests.utils import (
	CLINICIAN,
	call,
	ensure_test_users,
	make_observation,
	make_patient,
)


@contextmanager
def count_queries():
	"""Count frappe.db.sql calls. Use this instead of FrappeTestCase.assertQueryCount on
	Postgres: in Frappe v15.121.2 assertQueryCount builds its failure message with
	"\n\n".join(queries), and on Postgres each entry is a LazyDecode, so it raises
	TypeError even when the count is under the limit (frappe/tests/utils.py:144)."""
	executed = []
	orig_sql = frappe.db.__class__.sql

	def _sql(db, *args, **kwargs):
		executed.append(str(args[0]) if args else "")
		return orig_sql(db, *args, **kwargs)

	frappe.db.__class__.sql = _sql
	try:
		yield executed
	finally:
		frappe.db.__class__.sql = orig_sql


class TestLastnPlan(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()

	def setUp(self):
		# a fresh patient per test: FrappeTestCase rolls back only at class end
		self.patient = make_patient()

	def tearDown(self):
		frappe.set_user("Administrator")

	def latest(self, subjects, **kwargs):
		status, body = call(fhir.lastn, subjects=subjects, **kwargs)
		self.assertEqual(status, 200, body)
		return body

	# ---- api ---------------------------------------------------------------
	def test_lastn_without_code_returns_latest_of_any_code(self):
		make_observation(self.patient.name, minutes_ago=30)
		hr = make_observation(self.patient.name, minutes_ago=5, code="8867-4", unit="/min", value=72.0)
		body = self.latest([self.patient.name])
		self.assertEqual([e["resource"]["id"] for e in body["entry"]], [hr.name])

	def test_lastn_accepts_json_and_comma_separated_subjects(self):
		obs = make_observation(self.patient.name)
		for subjects in (f'["Patient/{self.patient.name}"]', f"Patient/{self.patient.name}", self.patient.name):
			with self.subTest(subjects=subjects):
				self.assertEqual(self.latest(subjects)["entry"][0]["resource"]["id"], obs.name)

	# ---- negative ----------------------------------------------------------
	def test_lastn_with_malformed_json_is_400_invalid(self):
		status, body = call(fhir.lastn, subjects="[not json")
		self.assertEqual((status, body["issue"][0]["code"]), (400, "invalid"))

	def test_lastn_with_101_subjects_is_400_too_costly(self):
		subjects = [f"SLP-{i:05d}" for i in range(101)]
		status, body = call(fhir.lastn, subjects=subjects)
		self.assertEqual((status, body["issue"][0]["code"]), (400, "too-costly"))
		status, _ = call(fhir.lastn, subjects=subjects[:100])
		self.assertEqual(status, 200)  # the boundary itself is allowed

	# ---- edge --------------------------------------------------------------
	def test_lastn_deduplicates_repeated_subjects(self):
		make_observation(self.patient.name)
		body = self.latest([self.patient.name, "Patient/" + self.patient.name])
		self.assertEqual(body["total"], 1)

	def test_lastn_breaks_equal_timestamps_by_creation(self):
		first = make_observation(self.patient.name, minutes_ago=10, value=130.0)
		second = make_observation(
			self.patient.name, value=125.0, effective_datetime=first.effective_datetime
		)
		self.assertEqual(self.latest([self.patient.name])["entry"][0]["resource"]["id"], second.name)

	@unittest.skip("SL-131: lastn compares `code` verbatim; a system|code token matches nothing")
	def test_lastn_accepts_loinc_token_with_system(self):
		obs = make_observation(self.patient.name)
		body = self.latest([self.patient.name], code="http://loinc.org|8480-6")
		self.assertEqual([e["resource"]["id"] for e in body["entry"]], [obs.name])

	@unittest.skip("SL-132: an amended Observation without effective_datetime is filtered out")
	def test_lastn_prefers_undated_amendment_over_the_final_it_replaces(self):
		original = make_observation(self.patient.name, minutes_ago=60, value=150.0)
		amended = make_observation(
			self.patient.name, status="amended", replaces=original.name, value=140.0, effective_datetime=None
		)
		body = self.latest([self.patient.name])
		self.assertEqual(body["entry"][0]["resource"]["id"], amended.name)

	@unittest.skip("SL-133: a newer preliminary Observation with no value reads back as 0.0 (D-1)")
	def test_lastn_never_reports_a_missing_value_as_zero(self):
		make_observation(self.patient.name, minutes_ago=60, value=150.0)
		make_observation(self.patient.name, minutes_ago=1, status="preliminary", value=None)
		body = self.latest([self.patient.name])
		quantity = body["entry"][0]["resource"].get("valueQuantity")
		self.assertNotEqual((quantity or {}).get("value"), 0.0)

	# ---- performance -------------------------------------------------------
	@unittest.skip("SL-130: TEACHING-DEFECT(perf-n+1), 2 queries per subject")
	def test_lastn_query_count_is_constant_for_20_subjects(self):
		subjects = [make_patient().name for _ in range(20)]
		for s in subjects:
			make_observation(s)
		self.latest(subjects)  # warm meta and permission caches
		with count_queries() as queries:
			self.latest(subjects)
		self.assertLessEqual(len(queries), 10)

	# ---- regression --------------------------------------------------------
	def test_framework_defect_assert_query_count_breaks_on_postgres(self):
		"""Pins why this file uses count_queries(): assertQueryCount raises TypeError on
		Postgres (Frappe v15.121.2) as soon as one query runs, even under the limit."""
		raised = None
		try:
			with self.assertQueryCount(1000):
				frappe.db.sql("select 1")
		except TypeError as e:
			raised = e
		self.assertEqual(raised is not None, frappe.db.db_type == "postgres", raised)

	# ---- security ----------------------------------------------------------
	def test_lastn_is_get_only(self):
		self.assertEqual(frappe.allowed_http_methods_for_whitelisted_func[fhir.lastn], ["GET"])

	def test_lastn_skips_patients_outside_the_users_user_permissions(self):
		other = make_patient()
		make_observation(self.patient.name)
		make_observation(other.name)
		add_user_permission("SL Patient", self.patient.name, CLINICIAN, ignore_permissions=True)
		try:
			frappe.set_user(CLINICIAN)
			body = self.latest([self.patient.name, other.name])
			subjects = [e["resource"]["subject"]["reference"] for e in body["entry"]]
			self.assertEqual(subjects, ["Patient/" + self.patient.name])
		finally:
			frappe.set_user("Administrator")
			# delete explicitly: on_trash clears the cached user permissions in redis,
			# which the class-level rollback would not do
			name = frappe.db.get_value("User Permission", {"user": CLINICIAN, "for_value": self.patient.name})
			frappe.delete_doc("User Permission", name, ignore_permissions=True)

	def test_lastn_audits_names_and_count_only(self):
		obs = make_observation(self.patient.name)
		with mock.patch.object(fhir, "log_access", wraps=fhir.log_access) as spy:
			self.latest([self.patient.name])
		spy.assert_called_once_with("lastn", "SL Observation", [obs.name], result_count=1)
