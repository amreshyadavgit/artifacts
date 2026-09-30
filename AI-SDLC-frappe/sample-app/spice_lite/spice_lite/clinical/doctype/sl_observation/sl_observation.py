# Copyright (c) 2026, AI-SDLC Course and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from spice_lite.audit import log_access

LOCKED_STATUSES = ("final", "amended")


class FinalObservationError(frappe.ValidationError):
	"""Raised when someone tries to change or delete a final/amended Observation."""


class SLObservation(Document):
	"""A single measurement (FHIR Observation, lite).

	Rules:
	- patient must exist; encounter (if set) must belong to the same patient
	- status final/amended requires value and unit
	- a final (or amended) Observation is immutable. Corrections are made by
	  inserting a NEW Observation with status 'amended' and `replaces` = the old one.
	"""

	def validate(self):
		self.validate_immutable()  # first: nothing else matters if the doc is locked
		self.validate_patient()
		self.validate_encounter()
		self.validate_value_for_final()
		self.validate_amendment()

	def validate_patient(self):
		if not self.patient or not frappe.db.exists("SL Patient", self.patient):
			frappe.throw(_("Patient {0} does not exist").format(self.patient), frappe.LinkValidationError)

	def validate_encounter(self):
		if not self.encounter:
			return
		enc_patient = frappe.db.get_value("SL Encounter", self.encounter, "patient")
		if enc_patient != self.patient:
			frappe.throw(_("Encounter {0} does not belong to Patient {1}").format(self.encounter, self.patient))

	def validate_value_for_final(self):
		if self.status in LOCKED_STATUSES:
			if self.value is None or not self.unit:
				frappe.throw(_("A {0} Observation must have a value and a unit").format(self.status))

	def validate_amendment(self):
		if self.status != "amended":
			return
		if not self.replaces:
			frappe.throw(_("An amended Observation must reference the Observation it replaces"))
		prev = frappe.db.get_value("SL Observation", self.replaces, ["patient", "status"], as_dict=True)
		if not prev or prev.patient != self.patient or prev.status not in LOCKED_STATUSES:
			frappe.throw(_("`replaces` must be a final or amended Observation of the same patient"))

	def validate_immutable(self):
		if self.is_new():
			return
		before = self.get_doc_before_save()
		if before and before.status in LOCKED_STATUSES:
			frappe.throw(
				_("Observation {0} is {1} and cannot be changed. Create an amended Observation instead.").format(
					self.name, before.status
				),
				FinalObservationError,
			)

	def on_trash(self):
		if self.status in LOCKED_STATUSES:
			frappe.throw(_("A {0} Observation cannot be deleted").format(self.status), FinalObservationError)

	def on_update(self):
		log_access("write", self.doctype, self.name)
