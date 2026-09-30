# Copyright (c) 2026, AI-SDLC Course and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class SLCountry(Document):
	"""One row per country deployment (spice_next_core runs one deployment per country)."""

	def autoname(self):
		# runs before validate(), so normalise here; the name IS the ISO code
		self.country_code = (self.country_code or "").strip().upper()
		self.name = self.country_code

	def validate(self):
		self.country_code = (self.country_code or "").strip().upper()
		if len(self.country_code) != 2 or not self.country_code.isalpha():
			frappe.throw(_("Country Code must be a 2-letter ISO 3166-1 alpha-2 code"))
