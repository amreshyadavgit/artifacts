# Copyright (c) 2026, AI-SDLC Course and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, today

from spice_lite.tests.utils import CLINICIAN, NO_ROLE_USER, ensure_test_users, make_patient


class TestSLPatient(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_create_read_update(self):
		p = make_patient(first_name="Amina", last_name="Otieno")
		self.assertTrue(p.name.startswith("SLP-"))
		self.assertNotIn(p.mrn, p.name)  # MRN (PHI) never becomes the doc name
		self.assertEqual(p.active, 1)  # default
		p.gender = "other"
		p.save()
		self.assertEqual(frappe.db.get_value("SL Patient", p.name, "gender"), "other")

	def test_future_birth_date_rejected(self):
		self.assertRaises(frappe.ValidationError, make_patient, birth_date=add_days(today(), 1))

	def test_duplicate_mrn_rejected(self):
		p = make_patient()
		self.assertRaises(frappe.UniqueValidationError, make_patient, mrn=p.mrn)

	def test_clinician_can_create_but_not_delete(self):
		frappe.set_user(CLINICIAN)
		p = make_patient()
		self.assertTrue(frappe.has_permission("SL Patient", "write", doc=p))
		self.assertFalse(frappe.has_permission("SL Patient", "delete"))
		self.assertRaises(frappe.PermissionError, frappe.delete_doc, "SL Patient", p.name)

	def test_user_without_role_cannot_read(self):
		p = make_patient()
		frappe.set_user(NO_ROLE_USER)
		self.assertFalse(frappe.has_permission("SL Patient", "read"))
		self.assertRaises(frappe.PermissionError, frappe.get_list, "SL Patient")
		self.assertRaises(frappe.PermissionError, frappe.get_doc("SL Patient", p.name).check_permission, "read")
