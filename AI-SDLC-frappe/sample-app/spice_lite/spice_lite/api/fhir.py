# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""FHIR-lite API for spice_lite.

Endpoints (all require login; none are allow_guest):
    GET  /api/method/spice_lite.api.fhir.get_patient?name=SLP-00001
    GET  /api/method/spice_lite.api.fhir.search_patients?family=Otieno | ?identifier=MRN-1
    POST /api/method/spice_lite.api.fhir.create_observation
    GET  /api/method/spice_lite.api.fhir.lastn?subjects=["SLP-00001","SLP-00002"]&code=8480-6

Frappe wraps whatever a whitelisted method returns in {"message": ...}; the FHIR-lite
resource is that "message". Errors set an HTTP status on
`frappe.local.response.http_status_code` and return an OperationOutcome.

Permissions: every read goes through `frappe.has_permission` / `frappe.get_list`
(permission-aware). Nothing here uses ignore_permissions.
"""

import frappe
from frappe import _

from spice_lite.api.mappers import (
	bundle,
	observation_to_fhir,
	operation_outcome,
	parse_reference,
	parse_subjects,
	parse_token,
	patient_to_fhir,
)
from spice_lite.audit import log_access

PATIENT_FIELDS = ["name", "mrn", "first_name", "last_name", "gender", "birth_date", "active", "country"]
MAX_SEARCH_RESULTS = 50
MAX_LASTN_SUBJECTS = 100
LIKE_METACHARS = ("%", "_", "\\")


def _error(status: int, code: str, diagnostics: str) -> dict:
	frappe.local.response.http_status_code = status
	return operation_outcome(code, diagnostics)


def _forbidden(doctype: str, ptype: str = "read") -> dict:
	return _error(403, "forbidden", _("Not permitted to {0} {1}").format(ptype, doctype))


@frappe.whitelist(methods=["GET"])
def get_patient(name: str):
	if not frappe.has_permission("SL Patient", "read"):
		return _forbidden("SL Patient")
	if not name or not frappe.db.exists("SL Patient", name):
		return _error(404, "not-found", _("Patient {0} not found").format(name))

	doc = frappe.get_doc("SL Patient", name)
	if not frappe.has_permission("SL Patient", "read", doc=doc):
		return _forbidden("SL Patient")

	log_access("read", "SL Patient", doc.name)
	return patient_to_fhir(doc.as_dict())


@frappe.whitelist(methods=["GET"])
def search_patients(family: str | None = None, identifier: str | None = None):
	family = (family or "").strip()
	mrn = parse_token(identifier)
	if not family and not mrn:
		return _error(400, "required", _("Provide at least one search parameter: family or identifier"))
	if any(c in family for c in LIKE_METACHARS):
		# frappe's filter layer re-escapes backslashes, so a literal %/_ cannot be expressed in a
		# LIKE filter; reject instead of letting family="%" turn into "list every patient".
		return _error(400, "invalid", _("family must not contain %, _ or \\"))
	if not frappe.has_permission("SL Patient", "read"):
		return _forbidden("SL Patient")

	filters = []
	if family:
		# prefix match so the last_name index can be used
		filters.append(["last_name", "like", f"{family}%"])
	if mrn:
		filters.append(["mrn", "=", mrn])

	rows = frappe.get_list(
		"SL Patient",
		filters=filters,
		fields=PATIENT_FIELDS,
		order_by="last_name asc, name asc",
		limit_page_length=MAX_SEARCH_RESULTS,
	)
	# audit: names + count only. NEVER the search terms (a family name is PHI).
	log_access("search", "SL Patient", [r.name for r in rows], result_count=len(rows))
	return bundle([patient_to_fhir(r) for r in rows])


@frappe.whitelist(methods=["POST"])
def create_observation(
	patient: str,
	code: str,
	status: str = "final",
	value: float | None = None,
	unit: str | None = None,
	code_display: str | None = None,
	effective_datetime: str | None = None,
	encounter: str | None = None,
	replaces: str | None = None,
):
	if not frappe.has_permission("SL Observation", "create"):
		return _forbidden("SL Observation", "create")

	doc = frappe.get_doc(
		{
			"doctype": "SL Observation",
			"patient": parse_reference(patient),
			"encounter": parse_reference(encounter, "Encounter"),
			"code": code,
			"code_display": code_display,
			"status": status,
			"value": value,
			"unit": unit,
			"effective_datetime": effective_datetime,
			"replaces": parse_reference(replaces, "Observation"),
		}
	)
	frappe.db.savepoint("sl_create_observation")
	try:
		doc.insert()  # permission-aware: checks "create" again for this doc
	except frappe.PermissionError:
		frappe.db.rollback(save_point="sl_create_observation")
		return _forbidden("SL Observation", "create")
	except frappe.ValidationError as e:
		frappe.db.rollback(save_point="sl_create_observation")
		frappe.clear_messages()
		return _error(422, "invalid", str(e) or e.__class__.__name__)

	log_access("create", "SL Observation", doc.name)
	frappe.local.response.http_status_code = 201
	return observation_to_fhir(doc.as_dict())


@frappe.whitelist(methods=["GET"])
def lastn(subjects, code: str | None = None):
	"""Latest Observation per patient (FHIR `$lastn` with max=1), as a Bundle."""
	try:
		subject_list = parse_subjects(subjects)
	except ValueError:
		return _error(400, "invalid", _("subjects must be a JSON list or comma-separated ids"))
	if not subject_list:
		return _error(400, "required", _("subjects is required"))
	if len(subject_list) > MAX_LASTN_SUBJECTS:
		return _error(400, "too-costly", _("At most {0} subjects per call").format(MAX_LASTN_SUBJECTS))
	if not frappe.has_permission("SL Observation", "read") or not frappe.has_permission("SL Patient", "read"):
		return _forbidden("SL Observation")

	results = []
	for s in subject_list:
		# TEACHING-DEFECT(perf-n+1): one get_doc + one get_all PER SUBJECT -> 2N queries
		# (plus fetching every column and every observation of that patient only to keep
		# the first row). With 100 subjects that is 200+ round trips. Because it uses
		# frappe.get_all it also skips row-level permission checks on SL Observation.
		# Fix: validate subjects with one frappe.get_list("SL Patient", filters={"name": ("in", ...)})
		# and fetch observations in ONE permission-aware frappe.get_list with explicit fields,
		# then pick the latest per patient in Python (or a window function via frappe.qb).
		# See docs/KNOWN_DEFECTS.md. Left in on purpose for the course -- do not "fix" silently.
		try:
			patient = frappe.get_doc("SL Patient", s)
		except frappe.DoesNotExistError:
			frappe.clear_messages()
			continue
		if not frappe.has_permission("SL Patient", "read", doc=patient):
			continue
		# NOT ("is", "set"): on Postgres frappe v15 renders that as `effective_datetime != ''`,
		# which is invalid for a timestamp column (see docs/KNOWN_DEFECTS.md, D-2).
		# A range filter excludes NULLs on both MariaDB and Postgres.
		filters = {"patient": patient.name, "effective_datetime": (">", "1900-01-01 00:00:00")}
		if code:
			filters["code"] = code
		rows = frappe.get_all(
			"SL Observation",
			filters=filters,
			order_by="effective_datetime desc, creation desc",
			fields=["*"],
		)
		if rows:
			results.append(observation_to_fhir(rows[0]))

	log_access("lastn", "SL Observation", [r["id"] for r in results], result_count=len(results))
	return bundle(results)
