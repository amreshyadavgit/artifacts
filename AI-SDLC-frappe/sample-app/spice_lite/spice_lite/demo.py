# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Synthetic demo data + API keys for trying the API with curl. NEVER run on a real site.

    bench --site test.localhost execute spice_lite.demo.seed_demo

Prints `api_key:api_secret` for the synthetic users. Re-running rotates the secrets.
"""

import frappe

DEMO_PATIENTS = [
	{"mrn": "DEMO-0001", "first_name": "Amina", "last_name": "Otieno", "gender": "female", "birth_date": "1984-03-12"},
	{"mrn": "DEMO-0002", "first_name": "Baraka", "last_name": "Otieno", "gender": "male", "birth_date": "1979-11-02"},
	{"mrn": "DEMO-0003", "first_name": "Chiku", "last_name": "Mwangi", "gender": "female", "birth_date": "1990-07-21"},
]


def seed_demo():
	if not frappe.conf.get("allow_tests") and not frappe.conf.get("developer_mode"):
		frappe.throw("Refusing to seed demo data: set allow_tests or developer_mode on this (test) site first")

	from frappe.core.doctype.user.user import generate_keys

	from spice_lite.tests.utils import CLINICIAN, NO_ROLE_USER, ensure_country, ensure_test_users

	ensure_test_users()
	country = ensure_country()
	names = []
	for p in DEMO_PATIENTS:
		name = frappe.db.get_value("SL Patient", {"mrn": p["mrn"]})
		if not name:
			name = frappe.get_doc({"doctype": "SL Patient", "country": country, **p}).insert().name
		names.append(name)
	if not frappe.db.exists("SL Observation", {"patient": names[0]}):
		for minutes, value in ((90, 148.0), (10, 131.0)):
			frappe.get_doc(
				{
					"doctype": "SL Observation",
					"patient": names[0],
					"code": "8480-6",
					"code_display": "Systolic blood pressure",
					"status": "final",
					"value": value,
					"unit": "mm[Hg]",
					"effective_datetime": frappe.utils.add_to_date(frappe.utils.now_datetime(), minutes=-minutes),
				}
			).insert()

	keys = {user: generate_keys(user) for user in (CLINICIAN, NO_ROLE_USER)}
	frappe.db.commit()  # bench execute also commits; explicit so the keys are usable immediately
	out = {"patients": names}
	for user, k in keys.items():
		out[user] = f"{k['api_key']}:{k['api_secret']}"
	return out
