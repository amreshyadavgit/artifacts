# Copyright (c) 2026, AI-SDLC Course and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from spice_lite.audit import log_access


class SLEncounter(Document):
	def validate(self):
		if self.status == "finished" and not self.encounter_date:
			frappe.throw(_("A finished Encounter must have an Encounter Date"))

	def on_update(self):
		log_access("write", self.doctype, self.name)
