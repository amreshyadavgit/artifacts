# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
import frappe

ROLES = ("Clinician",)


def ensure_roles():
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			# install-time bootstrap runs as Administrator; ignore_permissions only here.
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)


def after_install():
	ensure_roles()


def after_migrate():
	ensure_roles()
