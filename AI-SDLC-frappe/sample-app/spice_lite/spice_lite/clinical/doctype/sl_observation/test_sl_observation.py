# Copyright (c) 2026, AI-SDLC Course and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from spice_lite.clinical.doctype.sl_observation.sl_observation import FinalObservationError
from spice_lite.tests.utils import CLINICIAN, ensure_test_users, make_encounter, make_observation, make_patient


class TestSLObservation(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()

	def setUp(self):
		self.patient = make_patient()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_final_requires_value_and_unit(self):
		self.assertRaises(frappe.ValidationError, make_observation, self.patient.name, unit=None)
		self.assertRaises(frappe.ValidationError, make_observation, self.patient.name, value=None)
		# preliminary may be incomplete
		obs = make_observation(self.patient.name, status="preliminary", value=None, unit=None)
		self.assertTrue(obs.name.startswith("SLO-"))

	def test_unknown_patient_rejected(self):
		self.assertRaises(frappe.ValidationError, make_observation, "SLP-NOPE")

	def test_encounter_must_belong_to_patient(self):
		other = make_patient()
		enc = make_encounter(other.name)
		self.assertRaises(frappe.ValidationError, make_observation, self.patient.name, encounter=enc.name)

	def test_preliminary_can_be_finalised_then_is_immutable(self):
		obs = make_observation(self.patient.name, status="preliminary")
		obs.status = "final"
		obs.save()  # preliminary -> final is allowed
		obs.reload()
		obs.value = 999
		self.assertRaises(FinalObservationError, obs.save)
		obs.reload()
		obs.status = "amended"
		self.assertRaises(FinalObservationError, obs.save)  # status change counts as an edit
		self.assertRaises(FinalObservationError, frappe.delete_doc, "SL Observation", obs.name)

	def test_amend_via_new_document(self):
		original = make_observation(self.patient.name, value=150.0)
		amended = make_observation(self.patient.name, status="amended", value=140.0, replaces=original.name)
		self.assertEqual(amended.replaces, original.name)
		self.assertEqual(frappe.db.get_value("SL Observation", original.name, "value"), 150.0)
		# amended without `replaces` is invalid
		self.assertRaises(frappe.ValidationError, make_observation, self.patient.name, status="amended")

	def test_missing_value_is_stored_as_zero_known_defect(self):
		"""Pins discovered defect D-1: Frappe stores a NULL Float as 0.0 (NOT NULL DEFAULT 0 column)."""
		obs = make_observation(self.patient.name, status="preliminary", value=None)
		obs.reload()
		self.assertEqual(obs.value, 0.0)

	def test_clinician_cannot_delete(self):
		frappe.set_user(CLINICIAN)
		obs = make_observation(self.patient.name, status="preliminary")
		self.assertRaises(frappe.PermissionError, frappe.delete_doc, "SL Observation", obs.name)
