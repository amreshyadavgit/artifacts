#!/usr/bin/env python3
# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Create or remove the read-only API user the spice-site MCP server authenticates as. TEST SITES ONLY.

    cd /home/user/frappe-bench/sites            # as the bench user
    ../env/bin/python /path/to/AI-SDLC-frappe/mcp/spice-site-server/scripts/provision_api_user.py \
        --site test.localhost setup [--sample-data] [--format env|json]
    ../env/bin/python .../provision_api_user.py --site test.localhost teardown

setup:
  - Role "SL Aggregate Reader" (desk access, no other rights).
  - Custom DocPerm read=1 (nothing else) for that role on SL Patient, SL Encounter, SL Observation.
    Frappe copies the standard DocPerm rows into Custom DocPerm the first time a custom rule is added
    (frappe.permissions.setup_custom_perms), so setup REFUSES if a DocType already has Custom DocPerm
    rows: teardown resets them with frappe.permissions.reset_perms, which would also drop someone else's.
  - User mcp-reader@spice-lite.test (synthetic, reserved .test domain) with only that role, and an API
    key/secret from frappe.core.doctype.user.user.generate_keys. The secret is printed once.
  - --sample-data: synthetic patients (MRN prefix MCPTEST-, countries XA and XB, ISO user-assigned codes)
    and preliminary observations, so the aggregate tools have something to count.
teardown removes all of the above and restores the DocTypes' standard permissions.

Why a Custom DocPerm and not an aggregate-only permission: Frappe has no "count only" permission type.
frappe.desk.listview.get_group_by_count calls frappe.get_list, which needs read (or select, which exposes
the DocType's search_fields, i.e. mrn and last_name on SL Patient). So this key CAN read rows through
/api/resource; the MCP server is the PHI boundary, and the key must live only in the server's environment.
docs/mcp/spice-site-server.md describes the stronger design (a whitelisted aggregate method in an
integration app, and a role with no DocType read at all).
"""

import argparse
import json
import sys

import frappe

USER = "mcp-reader@spice-lite.test"
ROLE = "SL Aggregate Reader"
DOCTYPES = ("SL Patient", "SL Encounter", "SL Observation")
MRN_PREFIX = "MCPTEST-"
COUNTRIES = {"XA": "Synthetic Country A", "XB": "Synthetic Country B"}
# (country, number of patients); XB stays below the MCP server's minimum cell size of 5.
SAMPLE_PATIENTS = (("XA", 12), ("XB", 3))
# (LOINC code, display, number of observations); 2339-0 stays below 5.
SAMPLE_OBSERVATIONS = (("8480-6", "Systolic blood pressure", 9), ("8867-4", "Heart rate", 6), ("2339-0", "Glucose", 2))


def refuse(msg):
	print(f"refused: {msg}", file=sys.stderr)
	sys.exit(2)


def custom_perm_roles(doctype):
	return set(frappe.get_all("Custom DocPerm", filters={"parent": doctype}, pluck="role"))


def setup(sample_data):
	if not (frappe.conf.get("allow_tests") or frappe.conf.get("developer_mode")):
		refuse("this site has neither allow_tests nor developer_mode set; provision real API users through your change process")
	from frappe.core.doctype.user.user import generate_keys
	from frappe.permissions import add_permission

	for dt in DOCTYPES:
		roles = custom_perm_roles(dt)
		if roles and ROLE not in roles:
			refuse(f"{dt} already has Custom DocPerm rows; add the {ROLE} read rule by hand instead")

	if not frappe.db.exists("Role", ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(ignore_permissions=True)
	for dt in DOCTYPES:
		if not frappe.db.exists("Custom DocPerm", {"parent": dt, "role": ROLE}):
			add_permission(dt, ROLE, permlevel=0, ptype="read")
		frappe.clear_cache(doctype=dt)

	if not frappe.db.exists("User", USER):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": USER,
				"first_name": "MCP Reader",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": ROLE}],
			}
		).insert(ignore_permissions=True)
	keys = generate_keys(USER)

	sample = add_sample_data() if sample_data else None
	frappe.db.commit()
	return {"user": USER, "role": ROLE, "api_key": keys["api_key"], "api_secret": keys["api_secret"], "sample": sample}


def add_sample_data():
	for code, name in COUNTRIES.items():
		if not frappe.db.exists("SL Country", code):
			frappe.get_doc({"doctype": "SL Country", "country_code": code, "country_name": name}).insert(ignore_permissions=True)
	patients = []
	n = 0
	for country, count in SAMPLE_PATIENTS:
		for _ in range(count):
			n += 1
			doc = frappe.get_doc(
				{
					"doctype": "SL Patient",
					"mrn": f"{MRN_PREFIX}{n:04d}",
					"first_name": "Test",
					"last_name": "Patient",
					"gender": "unknown",
					"birth_date": "1980-01-01",
					"country": country,
				}
			).insert(ignore_permissions=True)
			patients.append(doc.name)
	i = 0
	for code, display, count in SAMPLE_OBSERVATIONS:
		for _ in range(count):
			# preliminary, not final: final Observations cannot be deleted, and teardown must remove these.
			frappe.get_doc(
				{
					"doctype": "SL Observation",
					"patient": patients[i % len(patients)],
					"code": code,
					"code_display": display,
					"status": "preliminary",
					"value": 1.0,
					"unit": "1",
				}
			).insert(ignore_permissions=True)
			i += 1
	return {"patients": len(patients), "observations": i}


def teardown():
	patients = frappe.get_all("SL Patient", filters={"mrn": ("like", f"{MRN_PREFIX}%")}, pluck="name")
	observations = frappe.get_all("SL Observation", filters={"patient": ("in", patients)}, pluck="name") if patients else []
	if observations:
		# frappe.db.delete skips on_trash on purpose: these are synthetic rows this script created.
		frappe.db.delete("SL Observation", {"name": ("in", observations)})
		frappe.db.delete("Version", {"ref_doctype": "SL Observation", "docname": ("in", observations)})
	if patients:
		frappe.db.delete("SL Patient", {"name": ("in", patients)})
		frappe.db.delete("Version", {"ref_doctype": "SL Patient", "docname": ("in", patients)})
	for code in COUNTRIES:
		if frappe.db.exists("SL Country", code) and not frappe.db.exists("SL Patient", {"country": code}):
			frappe.delete_doc("SL Country", code, ignore_permissions=True, force=True)

	if frappe.db.exists("User", USER):
		frappe.delete_doc("User", USER, ignore_permissions=True, force=True)
	reset = []
	for dt in DOCTYPES:
		if ROLE in custom_perm_roles(dt):
			frappe.permissions.reset_perms(dt)
			reset.append(dt)
		frappe.clear_cache(doctype=dt)
	if frappe.db.exists("Role", ROLE):
		frappe.delete_doc("Role", ROLE, ignore_permissions=True, force=True)
	frappe.db.commit()
	return {"removed_user": USER, "reset_permissions": reset, "removed_patients": len(patients), "removed_observations": len(observations)}


def main():
	parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	parser.add_argument("--site", required=True)
	parser.add_argument("--sites-path", default=".")
	parser.add_argument("action", choices=["setup", "teardown"])
	parser.add_argument("--sample-data", action="store_true")
	parser.add_argument("--format", choices=["json", "env"], default="json")
	args = parser.parse_args()

	frappe.init(site=args.site, sites_path=args.sites_path)
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		out = setup(args.sample_data) if args.action == "setup" else teardown()
	finally:
		frappe.destroy()
	if args.action == "setup" and args.format == "env":
		print(f"export SPICE_SITE_API_KEY={out['api_key']}")
		print(f"export SPICE_SITE_API_SECRET={out['api_secret']}")
		print(f"# user={out['user']} role={out['role']} sample={json.dumps(out['sample'])}", file=sys.stderr)
	else:
		print(json.dumps(out))


if __name__ == "__main__":
	main()
