# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Security probes for the security-review skill (spice_lite, Frappe v15).

NOT part of the app's test suite. Copy it into spice_lite/tests/ for one run, then delete it.
See probes/RUN.md for the one-shot command. Every probe creates synthetic data inside a
FrappeTestCase, so everything is rolled back at class end. Each probe prints one
`PROBE <id> ...` line that the security report quotes as evidence.

What each probe demonstrates (on the UNMODIFIED app):
  SEC-PROBE-1  lastn() returns an SL Observation the caller cannot read (User Permission)
  SEC-PROBE-2  lastn() ignores a permission_query_conditions Frappe hook on SL Observation
  SEC-PROBE-3  create_observation() writes to a patient hidden from the caller by User Permission
  SEC-PROBE-4  get_patient() answers 404 vs 403, so document names can be enumerated
  SEC-PROBE-5  an unhandled error in create_observation() puts the request values into the
               Error Log traceback (local variables) and into frappe.log (Form Dict)
  SEC-PROBE-6  track_changes on SL Patient copies PHI into Version.data
  SEC-PROBE-7  what an f-string frappe.db.sql would do (exercise-introduced, not in the app)
"""

import logging

import frappe
from frappe.permissions import add_user_permission
from frappe.tests.utils import FrappeTestCase

from spice_lite.api import fhir
from spice_lite.tests.utils import CLINICIAN, call, ensure_test_users, make_observation, make_patient

SENTINEL_VALUE = 187.25  # synthetic "measurement" we look for in error sinks


def hide_code_8480_6(user=None, doctype=None):
	"""A country-app style permission_query_conditions hook: Clinicians must not see code 8480-6."""
	return "`tabSL Observation`.code != '8480-6'"


class TestSecurityProbes(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		ensure_test_users()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_probe_1_lastn_bypasses_user_permission_on_observation(self):
		p = make_patient()
		old = make_observation(p.name, minutes_ago=60)
		new = make_observation(p.name, minutes_ago=5)
		add_user_permission("SL Observation", old.name, CLINICIAN, ignore_permissions=True)

		frappe.set_user(CLINICIAN)
		visible = frappe.get_list("SL Observation", filters={"patient": p.name}, pluck="name")
		can_read_new = frappe.has_permission("SL Observation", "read", doc=new.name)
		status, body = call(fhir.lastn, subjects=[p.name])
		returned = [e["resource"]["id"] for e in body["entry"]]
		print(
			f"PROBE SEC-PROBE-1 get_list={visible} has_permission(new)={can_read_new} "
			f"lastn_status={status} lastn_returned={returned} hidden={new.name}"
		)
		self.assertEqual(visible, [old.name])
		self.assertFalse(can_read_new)
		self.assertEqual(returned, [new.name])  # the document the user may not read

	def test_probe_2_lastn_ignores_permission_query_conditions(self):
		p = make_patient()
		obs = make_observation(p.name, minutes_ago=5)
		orig_get_hooks = frappe.get_hooks

		def get_hooks(hook=None, default="_KEEP_DEFAULT_LIST", app_name=None):
			if hook == "permission_query_conditions":
				hooks = dict(orig_get_hooks(hook, {}, app_name) or {})
				hooks["SL Observation"] = [__name__ + ".hide_code_8480_6"]
				return hooks
			return orig_get_hooks(hook, default, app_name)

		frappe.get_hooks = get_hooks
		try:
			frappe.set_user(CLINICIAN)
			visible = frappe.get_list("SL Observation", filters={"patient": p.name}, pluck="name")
			status, body = call(fhir.lastn, subjects=[p.name], code="8480-6")
		finally:
			frappe.get_hooks = orig_get_hooks
		returned = [e["resource"]["id"] for e in body["entry"]]
		print(f"PROBE SEC-PROBE-2 get_list={visible} lastn_status={status} lastn_returned={returned}")
		self.assertEqual(visible, [])
		self.assertEqual(returned, [obs.name])

	def test_probe_3_create_observation_on_hidden_patient(self):
		allowed, hidden = make_patient(), make_patient()
		add_user_permission("SL Patient", allowed.name, CLINICIAN, ignore_permissions=True)

		frappe.set_user(CLINICIAN)
		can_read_hidden = frappe.has_permission("SL Patient", "read", doc=hidden.name)
		status, body = call(
			fhir.create_observation, patient=hidden.name, code="8867-4", value=71, unit="/min"
		)
		print(
			f"PROBE SEC-PROBE-3 has_permission(hidden_patient)={can_read_hidden} "
			f"create_status={status} issue={body.get('issue', [{}])[0].get('code')}"
		)
		self.assertFalse(can_read_hidden)
		self.assertEqual(status, 403)  # Frappe's user-permission check on Link fields blocks the write

	def test_probe_4_get_patient_existence_oracle(self):
		allowed, hidden = make_patient(), make_patient()
		add_user_permission("SL Patient", allowed.name, CLINICIAN, ignore_permissions=True)

		frappe.set_user(CLINICIAN)
		s_hidden, _ = call(fhir.get_patient, name=hidden.name)
		s_missing, _ = call(fhir.get_patient, name="SLP-99999999")
		print(f"PROBE SEC-PROBE-4 existing_but_forbidden={s_hidden} not_existing={s_missing}")
		self.assertEqual((s_hidden, s_missing), (403, 404))

	def test_probe_5_unhandled_error_copies_request_values_into_error_sinks(self):
		p = make_patient()
		form = {"patient": p.name, "code": "8480-6", "value": SENTINEL_VALUE, "unit": "mm[Hg]",
			"effective_datetime": "not-a-datetime"}
		frappe.local.form_dict = frappe._dict(form)
		frappe.db.savepoint("sec_probe_5")
		error_type, traceback = None, ""
		try:
			status, body = call(fhir.create_observation, **form)
		except Exception as e:  # what frappe.app.handle_exception sees for a 500
			error_type = type(e).__name__
			traceback = frappe.get_traceback(with_context=True)  # what log_error() stores
		finally:
			frappe.db.rollback(save_point="sec_probe_5")

		# frappe.app.handle_exception -> log_error_snapshot -> frappe.logger(with_more_info=True)
		from frappe.utils.logger import SiteContextFilter

		record = logging.LogRecord("frappe", logging.ERROR, __file__, 1, "New Exception collected in error log", None, None)
		SiteContextFilter().filter(record)
		frappe.local.form_dict = frappe._dict()
		print(
			f"PROBE SEC-PROBE-5 error={error_type} value_in_error_log_traceback={str(SENTINEL_VALUE) in traceback} "
			f"value_in_frappe_log_line={str(SENTINEL_VALUE) in record.msg} "
			f"traceback_has_locals={'value = ' in traceback}"
		)
		self.assertIsNotNone(error_type, "create_observation handled the bad datetime; probe premise changed")
		self.assertIn(str(SENTINEL_VALUE), traceback)
		self.assertIn(str(SENTINEL_VALUE), record.msg)

	def test_probe_6_version_stores_phi_diff(self):
		p = frappe.get_doc("SL Patient", make_patient(last_name="Probeold").name)
		p.last_name = "Probenew"
		p.save(ignore_version=False)  # in tests frappe.flags.in_test makes save() skip Version; production saves do not
		data = frappe.db.get_value("Version", {"ref_doctype": "SL Patient", "docname": p.name}, "data") or ""
		clinician_can_read_version = frappe.has_permission("Version", "read", user=CLINICIAN)
		print(
			f"PROBE SEC-PROBE-6 version_rows={frappe.db.count('Version', {'ref_doctype': 'SL Patient', 'docname': p.name})} "
			f"last_name_in_version={'Probenew' in data and 'Probeold' in data} "
			f"clinician_can_read_version={clinician_can_read_version}"
		)
		self.assertIn("Probenew", data)
		self.assertFalse(clinician_can_read_version)

	def test_probe_7_fstring_sql_is_injectable(self):
		p1 = make_patient(last_name="Probeinj")
		make_patient(last_name="Probeother")
		payload = "nobody' or '1'='1"

		def unsafe(family):  # the pattern the exercise patch introduces; never ship this
			return frappe.db.sql(f"select name from `tabSL Patient` where last_name = '{family}'", pluck=True)

		def safe(family):
			return frappe.db.sql("select name from `tabSL Patient` where last_name = %s", (family,), pluck=True)

		n_unsafe, n_safe = len(unsafe(payload)), len(safe(payload))
		total = frappe.db.count("SL Patient")
		print(f"PROBE SEC-PROBE-7 unsafe_rows={n_unsafe} safe_rows={n_safe} total_patients={total}")
		self.assertEqual(n_unsafe, total)
		self.assertEqual(n_safe, 0)
		self.assertIn(p1.name, unsafe(payload))
