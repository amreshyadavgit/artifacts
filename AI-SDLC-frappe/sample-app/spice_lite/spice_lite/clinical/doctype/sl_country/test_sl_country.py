# Copyright (c) 2026, AI-SDLC Course and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestSLCountry(FrappeTestCase):
	def test_code_is_normalised_and_used_as_name(self):
		doc = frappe.get_doc({"doctype": "SL Country", "country_code": "tz", "country_name": "Tanzania"})
		doc.insert()
		self.assertEqual(doc.name, "TZ")

	def test_invalid_code_rejected(self):
		doc = frappe.get_doc({"doctype": "SL Country", "country_code": "K1", "country_name": "Bad"})
		self.assertRaises(frappe.ValidationError, doc.insert)
