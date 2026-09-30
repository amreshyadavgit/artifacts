# Copyright (c) 2026, AI-SDLC Course and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from spice_lite.tests.utils import make_encounter, make_patient


class TestSLEncounter(FrappeTestCase):
	def test_create_with_defaults(self):
		p = make_patient()
		enc = frappe.get_doc({"doctype": "SL Encounter", "patient": p.name}).insert()
		self.assertTrue(enc.name.startswith("SLE-"))
		self.assertEqual(enc.status, "planned")
		self.assertEqual(enc.encounter_type, "screening")

	def test_patient_is_mandatory(self):
		self.assertRaises(frappe.MandatoryError, frappe.get_doc({"doctype": "SL Encounter"}).insert)

	def test_unknown_patient_rejected(self):
		self.assertRaises(frappe.LinkValidationError, make_encounter, "SLP-DOES-NOT-EXIST")

	def test_finished_requires_date(self):
		p = make_patient()
		self.assertRaises(frappe.ValidationError, make_encounter, p.name, status="finished", encounter_date=None)
