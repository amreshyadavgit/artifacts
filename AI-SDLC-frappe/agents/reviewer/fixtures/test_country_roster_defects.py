# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Proves the seeded defects in agents/reviewer/fixtures/country-roster.patch (module 05).

This is NOT an app test. verify-fixture.sh copies it into spice_lite/tests/ only while the patch is
applied, runs it with `bench --site <site> run-tests --module spice_lite.tests.test_country_roster_defects`,
and removes it again. Every test PASSES when the defect is present. Synthetic data only.
"""

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from spice_lite.api import fhir
from spice_lite.tests.utils import (
	CLINICIAN,
	NO_ROLE_USER,
	call,
	ensure_country,
	ensure_test_users,
	make_encounter,
	make_patient,
)


class TestCountryRosterDefects(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()
		cls.tag = frappe.generate_hash(length=6).upper()
		cls.home = ensure_country("QA", "Test Country A")
		cls.other = ensure_country("QB", "Test Country B")
		cls.p_home = make_patient(country=cls.home, last_name="Zz" + cls.tag, mrn="MRN-HA-" + cls.tag)
		cls.p_other = make_patient(country=cls.other, last_name="Zz" + cls.tag, mrn="MRN-HB-" + cls.tag)
		for _ in range(3):
			make_encounter(cls.p_home.name)

	def tearDown(self):
		frappe.set_user("Administrator")

	def _names(self, body):
		return {r["name"] for r in body["patients"]}

	def test_rev_sql_injection_reads_other_countries(self):
		status, body = call(fhir.country_roster, country="QA")
		self.assertEqual(status, 200)
		self.assertIn(self.p_home.name, self._names(body))
		self.assertNotIn(self.p_other.name, self._names(body))
		# f-string SQL: the quote closes the literal and OR widens the WHERE clause
		status, body = call(fhir.country_roster, country="QA' or '1'='1")
		self.assertIn(self.p_other.name, self._names(body), "injection did not widen the query")

	def test_rev_no_permission_check_user_without_role_reads_phi(self):
		frappe.set_user(NO_ROLE_USER)
		self.assertFalse(frappe.has_permission("SL Patient", "read"))
		status, body = call(fhir.country_roster, country="QA")
		self.assertEqual(status, 200)
		row = next(r for r in body["patients"] if r["name"] == self.p_home.name)
		self.assertEqual(row["mrn"], self.p_home.mrn)  # PHI returned to a user with no role
		# the existing API refuses the same user
		status, _ = call(fhir.search_patients, family="Zz" + self.tag)
		self.assertEqual(status, 403)

	def test_rev_audit_log_receives_mrns_not_names(self):
		with mock.patch.object(fhir, "log_access", wraps=fhir.log_access) as spy:
			call(fhir.country_roster, country="QA")
		logged = spy.call_args.args[2]
		self.assertIn(self.p_home.mrn, logged)
		self.assertNotIn(self.p_home.name, logged)

	def test_rev_count_query_per_patient(self):
		def queries(country):
			executed = []
			orig = frappe.db.__class__.sql

			def _sql(db, *args, **kwargs):
				executed.append(args[0] if args else "")
				return orig(db, *args, **kwargs)

			frappe.db.__class__.sql = _sql
			try:
				_, body = call(fhir.country_roster, country=country)
			finally:
				frappe.db.__class__.sql = orig
			return len(executed), body["total"]

		queries("QA")  # warm caches
		base, n_home = queries("QA")
		for _ in range(4):
			make_patient(country=self.home)
		more, n_more = queries("QA")
		self.assertEqual(n_more - n_home, 4)
		self.assertGreaterEqual(more - base, 4, f"{n_home} rows: {base} queries, {n_more} rows: {more}")

	def test_rev_whitelist_accepts_every_http_method(self):
		allowed = frappe.allowed_http_methods_for_whitelisted_func[fhir.country_roster]
		self.assertEqual(sorted(allowed), ["DELETE", "GET", "POST", "PUT"])
		self.assertEqual(frappe.allowed_http_methods_for_whitelisted_func[fhir.search_patients], ["GET"])

	def test_rev_response_is_not_a_fhir_bundle(self):
		_, body = call(fhir.country_roster, country="QA")
		self.assertNotIn("resourceType", body)
		self.assertIn("encounters", body["patients"][0])

	def test_rev_clinician_delete_permission_after_migrate(self):
		# Only meaningful on a site migrated with the patched sl_patient.json (verify-fixture.sh --scratch-site).
		perms = frappe.get_meta("SL Patient").permissions
		clinician = [p for p in perms if p.role == "Clinician"]
		migrated = bool(clinician and clinician[0].delete)
		if not migrated:
			self.skipTest("sl_patient.json change not migrated on this site (expected on test.localhost)")
		frappe.set_user(CLINICIAN)
		self.assertTrue(frappe.has_permission("SL Patient", "delete"))
