# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Shared helpers for spice_lite integration tests (need a site: `bench run-tests`).

All data is synthetic. Test users use the reserved `.test` TLD.
"""

import frappe
from frappe.utils import add_to_date, now_datetime

CLINICIAN = "clinician@spice-lite.test"
NO_ROLE_USER = "norole@spice-lite.test"
TEST_COUNTRY = "KE"


def ensure_user(email: str, roles: list[str]) -> str:
	if not frappe.db.exists("User", email):
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0].title(),
				"send_welcome_email": 0,
				"user_type": "System User",
			}
		)
		user.insert(ignore_permissions=True)
	user = frappe.get_doc("User", email)
	current = {r.role for r in user.roles}
	wanted = set(roles)
	if current != wanted:
		user.set("roles", [])
		for role in sorted(wanted):
			user.append("roles", {"role": role})
		user.save(ignore_permissions=True)
	return email


def ensure_test_users():
	from spice_lite.install import ensure_roles

	ensure_roles()
	ensure_country()
	ensure_user(CLINICIAN, ["Clinician"])
	ensure_user(NO_ROLE_USER, [])


def ensure_country(code: str = TEST_COUNTRY, name: str = "Kenya") -> str:
	if not frappe.db.exists("SL Country", code):
		frappe.get_doc({"doctype": "SL Country", "country_code": code, "country_name": name}).insert()
	return code


def make_patient(**kwargs):
	data = {
		"doctype": "SL Patient",
		"mrn": "MRN-" + frappe.generate_hash(length=10),
		"first_name": "Test",
		"last_name": "Patient",
		"gender": "female",
		"birth_date": "1980-01-01",
		"country": ensure_country(),
	}
	data.update(kwargs)
	return frappe.get_doc(data).insert()


def make_encounter(patient: str, **kwargs):
	data = {
		"doctype": "SL Encounter",
		"patient": patient,
		"encounter_date": now_datetime(),
		"encounter_type": "screening",
		"status": "in-progress",
	}
	data.update(kwargs)
	return frappe.get_doc(data).insert()


def make_observation(patient: str, minutes_ago: int = 0, **kwargs):
	data = {
		"doctype": "SL Observation",
		"patient": patient,
		"code": "8480-6",
		"code_display": "Systolic blood pressure",
		"status": "final",
		"value": 120.0,
		"unit": "mm[Hg]",
		"effective_datetime": add_to_date(now_datetime(), minutes=-minutes_ago),
	}
	data.update(kwargs)
	return frappe.get_doc(data).insert()


def call(fn, **kwargs):
	"""Call a whitelisted API function in-process; return (http_status, body)."""
	frappe.local.response.pop("http_status_code", None)
	body = fn(**kwargs)
	status = frappe.local.response.pop("http_status_code", None) or 200
	return status, body
