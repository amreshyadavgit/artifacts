# Copyright (c) 2026, AI-SDLC Course and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, today

from spice_lite.audit import log_access


class SLPatient(Document):
	"""A synthetic patient record.

	Naming: `SLP-.#####` (opaque series), NOT the MRN. The MRN is an identifier and
	therefore PHI; keeping it out of the document name keeps it out of URLs,
	link fields, logs and the audit trail (which records doc names only).
	"""

	def validate(self):
		self.mrn = (self.mrn or "").strip()
		self.validate_birth_date()
		self.validate_unique_mrn()

	def validate_birth_date(self):
		if self.birth_date and getdate(self.birth_date) > getdate(today()):
			frappe.throw(_("Birth Date cannot be in the future"), frappe.ValidationError)

	def validate_unique_mrn(self):
		# The DB unique constraint is the real guard; this gives a clean, DB-agnostic message
		# (MariaDB and Postgres raise different low-level errors on unique violation).
		clash = frappe.db.exists("SL Patient", {"mrn": self.mrn, "name": ("!=", self.name)})
		if clash:
			frappe.throw(_("A patient with this MRN already exists"), frappe.UniqueValidationError)

	def on_update(self):
		log_access("write", self.doctype, self.name)
