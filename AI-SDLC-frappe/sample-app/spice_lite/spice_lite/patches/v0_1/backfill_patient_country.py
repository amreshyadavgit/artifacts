# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""v0.1: backfill SL Patient.country for the deployment's country.

One deployment per country: the site config says which country this site
serves, e.g.  bench --site ke.localhost set-config spice_lite_country_code KE
             bench --site ke.localhost set-config spice_lite_country_name Kenya
Patients created before `country` existed get that code. Runs in
[post_model_sync] because it needs the new column. Idempotent.
"""

import frappe


def execute():
	code = (frappe.conf.get("spice_lite_country_code") or "").strip().upper()
	if not code:
		return

	if not frappe.db.exists("SL Country", code):
		frappe.get_doc(
			{
				"doctype": "SL Country",
				"country_code": code,
				"country_name": frappe.conf.get("spice_lite_country_name") or code,
			}
		).insert(ignore_permissions=True)

	patient = frappe.qb.DocType("SL Patient")
	(
		frappe.qb.update(patient)
		.set(patient.country, code)
		.where(patient.country.isnull() | (patient.country == ""))
	).run()
