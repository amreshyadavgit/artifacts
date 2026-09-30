# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Integration tests for spice_lite.api.fhir (run with `bench --site <site> run-tests --app spice_lite`)."""

import frappe
from frappe.tests.utils import FrappeTestCase

from spice_lite.api import fhir
from spice_lite.patches.v0_1 import backfill_patient_country
from spice_lite.tests.utils import (
	CLINICIAN,
	NO_ROLE_USER,
	call,
	ensure_test_users,
	make_observation,
	make_patient,
)


class TestFhirApi(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()
		# unique family name per run so searches only see this class's data
		cls.family = "Zz" + frappe.generate_hash(length=8)
		cls.p1 = make_patient(first_name="Amina", last_name=cls.family, mrn="MRN-A-" + cls.family)
		cls.p2 = make_patient(first_name="Baraka", last_name=cls.family + "son", mrn="MRN-B-" + cls.family)

	def tearDown(self):
		frappe.set_user("Administrator")

	# ---- get_patient -------------------------------------------------------
	def test_get_patient_shape(self):
		status, body = call(fhir.get_patient, name=self.p1.name)
		self.assertEqual(status, 200)
		self.assertEqual(body["resourceType"], "Patient")
		self.assertEqual(body["id"], self.p1.name)
		self.assertEqual(body["identifier"][0], {"system": "urn:spice-lite:mrn", "value": self.p1.mrn})
		self.assertEqual(body["name"][0]["family"], self.family)
		self.assertEqual(body["birthDate"], "1980-01-01")
		self.assertIs(body["active"], True)

	def test_get_patient_not_found(self):
		status, body = call(fhir.get_patient, name="SLP-99999999")
		self.assertEqual(status, 404)
		self.assertEqual(body["resourceType"], "OperationOutcome")
		self.assertEqual(body["issue"][0]["code"], "not-found")

	# ---- search_patients ---------------------------------------------------
	def test_search_by_family_returns_bundle(self):
		status, body = call(fhir.search_patients, family=self.family)
		self.assertEqual(status, 200)
		self.assertEqual(body["resourceType"], "Bundle")
		self.assertEqual(body["type"], "searchset")
		ids = [e["resource"]["id"] for e in body["entry"]]
		self.assertEqual(ids, [self.p1.name, self.p2.name])  # prefix match, ordered by last_name
		self.assertEqual(body["total"], 2)
		self.assertTrue(all(e["resource"]["resourceType"] == "Patient" for e in body["entry"]))

	def test_search_by_identifier_token(self):
		status, body = call(fhir.search_patients, identifier="urn:spice-lite:mrn|" + self.p2.mrn)
		self.assertEqual(status, 200)
		self.assertEqual([e["resource"]["id"] for e in body["entry"]], [self.p2.name])

	def test_search_without_params_is_400_operation_outcome(self):
		status, body = call(fhir.search_patients)
		self.assertEqual(status, 400)
		self.assertEqual(body["resourceType"], "OperationOutcome")
		self.assertEqual(body["issue"][0]["severity"], "error")
		self.assertEqual(body["issue"][0]["code"], "required")

	def test_search_rejects_like_wildcards(self):
		# family="%" must not become "list every patient"
		for family in ("%", "_", self.family[:2] + "%", "a\\b"):
			status, body = call(fhir.search_patients, family=family)
			self.assertEqual((status, body["issue"][0]["code"]), (400, "invalid"), family)

	def test_search_no_match_is_empty_bundle(self):
		status, body = call(fhir.search_patients, family="Nobody" + self.family)
		self.assertEqual(status, 200)
		self.assertEqual(body["total"], 0)
		self.assertEqual(body["entry"], [])

	# ---- permissions -------------------------------------------------------
	def test_user_without_clinician_role_is_forbidden(self):
		frappe.set_user(NO_ROLE_USER)
		for fn, kwargs in (
			(fhir.get_patient, {"name": self.p1.name}),
			(fhir.search_patients, {"family": self.family}),
			(fhir.lastn, {"subjects": [self.p1.name]}),
			(fhir.create_observation, {"patient": self.p1.name, "code": "8480-6", "value": 1, "unit": "x"}),
		):
			status, body = call(fn, **kwargs)
			self.assertEqual(status, 403, fn.__name__)
			self.assertEqual(body["issue"][0]["code"], "forbidden", fn.__name__)

	def test_clinician_can_search_and_read(self):
		frappe.set_user(CLINICIAN)
		status, body = call(fhir.search_patients, family=self.family)
		self.assertEqual((status, body["total"]), (200, 2))
		status, body = call(fhir.get_patient, name=self.p1.name)
		self.assertEqual((status, body["id"]), (200, self.p1.name))

	def test_whitelisted_methods_are_not_guest_accessible(self):
		for fn in (fhir.get_patient, fhir.search_patients, fhir.create_observation, fhir.lastn):
			self.assertIn(fn, frappe.whitelisted)
			self.assertNotIn(fn, frappe.guest_methods)

	# ---- create_observation ------------------------------------------------
	def test_create_observation_as_clinician(self):
		frappe.set_user(CLINICIAN)
		status, body = call(
			fhir.create_observation,
			patient="Patient/" + self.p1.name,
			code="8867-4",
			code_display="Heart rate",
			value="72",  # HTTP params arrive as strings; pydantic coerces to float
			unit="/min",
			effective_datetime="2026-01-01 10:00:00",
		)
		self.assertEqual(status, 201)
		self.assertEqual(body["resourceType"], "Observation")
		self.assertEqual(body["subject"], {"reference": "Patient/" + self.p1.name})
		self.assertEqual(body["valueQuantity"]["value"], 72.0)
		self.assertEqual(body["code"]["coding"][0]["system"], "http://loinc.org")
		self.assertEqual(frappe.db.get_value("SL Observation", body["id"], "owner"), CLINICIAN)

	def test_create_final_observation_without_unit_is_422(self):
		status, body = call(fhir.create_observation, patient=self.p1.name, code="8867-4", value=72)
		self.assertEqual(status, 422)
		self.assertEqual(body["resourceType"], "OperationOutcome")
		self.assertEqual(body["issue"][0]["code"], "invalid")

	# ---- lastn -------------------------------------------------------------
	def test_lastn_returns_latest_per_patient(self):
		old = make_observation(self.p1.name, minutes_ago=60, value=150.0)
		new = make_observation(self.p1.name, minutes_ago=5, value=128.0)
		make_observation(self.p1.name, minutes_ago=1, code="8867-4", unit="/min", value=70.0)  # other code
		# undated observation must never win (Postgres sorts NULLs FIRST on DESC)
		make_observation(self.p1.name, status="preliminary", effective_datetime=None, value=1.0)
		p2_obs = make_observation(self.p2.name, minutes_ago=30, value=110.0)

		status, body = call(
			fhir.lastn, subjects=f'["Patient/{self.p1.name}", "{self.p2.name}", "SLP-MISSING"]', code="8480-6"
		)
		self.assertEqual(status, 200)
		self.assertEqual(body["resourceType"], "Bundle")
		by_subject = {e["resource"]["subject"]["reference"]: e["resource"] for e in body["entry"]}
		self.assertEqual(by_subject["Patient/" + self.p1.name]["id"], new.name)
		self.assertNotEqual(by_subject["Patient/" + self.p1.name]["id"], old.name)
		self.assertEqual(by_subject["Patient/" + self.p2.name]["id"], p2_obs.name)
		self.assertEqual(body["total"], 2)  # the missing subject is skipped

	def test_lastn_requires_subjects(self):
		status, body = call(fhir.lastn, subjects="")
		self.assertEqual(status, 400)
		self.assertEqual(body["resourceType"], "OperationOutcome")

	def test_lastn_query_count_grows_with_subjects(self):
		"""Pins the TEACHING-DEFECT(perf-n+1): SQL queries scale with the number of subjects.

		After fixing the N+1, replace this with `with self.assertQueryCount(<small constant>):`
		(FrappeTestCase.assertQueryCount asserts "<= count").
		"""
		subjects = [make_patient().name for _ in range(5)]
		for s in subjects:
			make_observation(s)
		call(fhir.lastn, subjects=subjects)  # warm meta/permission caches

		def count_queries(n):
			executed = []
			orig_sql = frappe.db.__class__.sql

			def _sql(db, *args, **kwargs):
				executed.append(args[0] if args else "")
				return orig_sql(db, *args, **kwargs)

			frappe.db.__class__.sql = _sql
			try:
				status, body = call(fhir.lastn, subjects=subjects[:n])
			finally:
				frappe.db.__class__.sql = orig_sql
			self.assertEqual((status, body["total"]), (200, n))
			return len(executed)

		one, five = count_queries(1), count_queries(5)
		# >= 2 extra queries per extra subject: one get_doc + one get_all each
		self.assertGreaterEqual(five - one, 2 * 4, f"1 subject: {one} queries, 5 subjects: {five}")

	def test_framework_defect_is_set_filter_on_datetime(self):
		"""Pins discovered defect D-2 (docs/KNOWN_DEFECTS.md): in frappe v15, a filter
		("is", "set") on a Datetime field renders `col != ''`; Postgres rejects that for timestamps.
		That is why lastn() filters with (">", "1900-01-01 00:00:00") instead."""
		frappe.db.savepoint("sl_d2")
		try:
			frappe.get_all("SL Observation", filters={"effective_datetime": ("is", "set")}, limit=1)
			raised = False
		except Exception:
			raised = True
		finally:
			# Postgres aborts the whole transaction on error: roll back to the savepoint only
			frappe.db.rollback(save_point="sl_d2")
		self.assertEqual(raised, frappe.db.db_type == "postgres")

	# ---- patch -------------------------------------------------------------
	def test_backfill_country_patch(self):
		p = make_patient(country=None)
		frappe.conf["spice_lite_country_code"] = "UG"
		frappe.conf["spice_lite_country_name"] = "Uganda"
		try:
			backfill_patient_country.execute()
			backfill_patient_country.execute()  # idempotent
		finally:
			frappe.conf.pop("spice_lite_country_code", None)
			frappe.conf.pop("spice_lite_country_name", None)
		self.assertEqual(frappe.db.get_value("SL Patient", p.name, "country"), "UG")
		self.assertEqual(frappe.db.get_value("SL Country", "UG", "country_name"), "Uganda")
		self.assertEqual(frappe.db.get_value("SL Patient", self.p1.name, "country"), "KE")  # untouched

	# ---- audit -------------------------------------------------------------
	def test_audit_record_has_names_only(self):
		from spice_lite.audit import log_access

		rec = log_access("search", "SL Patient", [self.p1.name], result_count=1, family="PHI-should-drop")
		self.assertEqual(rec["names"], [self.p1.name])
		self.assertNotIn("family", rec)  # non-int extras are dropped

	def test_audit_logger_emits_info(self):
		# Regression: frappe.logger() defaults to ERROR level, which silently dropped audit lines.
		import logging

		from spice_lite.audit import _logger

		self.assertTrue(_logger().isEnabledFor(logging.INFO))
