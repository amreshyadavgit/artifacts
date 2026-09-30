# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Pure FHIR-lite mappers.

This module must stay importable WITHOUT Frappe (no `import frappe` at module
level) so `python -m pytest spice_lite/tests/unit` runs on a laptop with no bench.
Inputs are plain dicts (e.g. `doc.as_dict()` or rows from `frappe.get_list`).

"FHIR-lite" = the JSON *shapes* of FHIR R4 Patient / Observation / Bundle /
OperationOutcome, not a conformant FHIR server.
"""

from __future__ import annotations

import datetime as _dt
import json

MRN_SYSTEM = "urn:spice-lite:mrn"
LOINC_SYSTEM = "http://loinc.org"
UCUM_SYSTEM = "http://unitsofmeasure.org"

GENDERS = {"male", "female", "other", "unknown"}


def _iso(value) -> str | None:
	if value in (None, ""):
		return None
	if isinstance(value, _dt.datetime):
		return value.replace(microsecond=0).isoformat()
	if isinstance(value, _dt.date):
		return value.isoformat()
	text = str(value).strip()
	# Frappe stores datetimes as "YYYY-MM-DD HH:MM:SS[.ffffff]"
	if len(text) > 10 and text[10] == " ":
		text = text[:10] + "T" + text[11:]
	if len(text) > 19 and text[19] == ".":
		text = text[:19]
	return text


def _drop_empty(d: dict) -> dict:
	return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def patient_to_fhir(row: dict) -> dict:
	given = [row["first_name"]] if row.get("first_name") else []
	name = _drop_empty({"family": row.get("last_name"), "given": given})
	gender = row.get("gender") if row.get("gender") in GENDERS else None
	resource = {
		"resourceType": "Patient",
		"id": row.get("name"),
		"identifier": [{"system": MRN_SYSTEM, "value": row.get("mrn")}] if row.get("mrn") else [],
		"active": bool(row.get("active")) if row.get("active") is not None else None,
		"name": [name] if name else [],
		"gender": gender,
		"birthDate": _iso(row.get("birth_date")),
		"address": [{"country": row["country"]}] if row.get("country") else [],
	}
	return _drop_empty(resource)


def observation_to_fhir(row: dict) -> dict:
	coding = _drop_empty({"system": LOINC_SYSTEM, "code": row.get("code"), "display": row.get("code_display")})
	value = row.get("value")
	quantity = None
	if value is not None and row.get("unit"):
		quantity = {"value": float(value), "unit": row["unit"], "system": UCUM_SYSTEM, "code": row["unit"]}
	resource = {
		"resourceType": "Observation",
		"id": row.get("name"),
		"status": row.get("status"),
		"code": {"coding": [coding]} if coding.get("code") else None,
		"subject": {"reference": f"Patient/{row['patient']}"} if row.get("patient") else None,
		"encounter": {"reference": f"Encounter/{row['encounter']}"} if row.get("encounter") else None,
		"effectiveDateTime": _iso(row.get("effective_datetime")),
		"valueQuantity": quantity,
	}
	if row.get("replaces"):
		resource["replaces"] = {"reference": f"Observation/{row['replaces']}"}
	return _drop_empty(resource)


def bundle(resources: list[dict], bundle_type: str = "searchset") -> dict:
	return {
		"resourceType": "Bundle",
		"type": bundle_type,
		"total": len(resources),
		"entry": [{"resource": r} for r in resources],
	}


def operation_outcome(code: str, diagnostics: str, severity: str = "error") -> dict:
	"""`code` is a FHIR IssueType code: invalid, required, forbidden, not-found, exception..."""
	return {
		"resourceType": "OperationOutcome",
		"issue": [{"severity": severity, "code": code, "diagnostics": diagnostics}],
	}


def parse_reference(value: str | None, resource_type: str = "Patient") -> str | None:
	"""'Patient/SLP-00001' -> 'SLP-00001'; a bare id is returned unchanged."""
	if not value:
		return None
	value = str(value).strip()
	prefix = resource_type + "/"
	return value[len(prefix) :] if value.startswith(prefix) else value


def parse_token(value: str | None) -> str | None:
	"""FHIR token search 'system|value' -> 'value'; plain 'value' unchanged."""
	if not value:
		return None
	return str(value).split("|")[-1].strip() or None


def parse_subjects(subjects) -> list[str]:
	"""Accept a list, a JSON list string, or a comma-separated string of references/ids."""
	if subjects is None or subjects == "":
		return []
	if isinstance(subjects, str):
		text = subjects.strip()
		if text.startswith("["):
			subjects = json.loads(text)
		else:
			subjects = text.split(",")
	out: list[str] = []
	for s in subjects:
		ref = parse_reference(s)
		if ref and ref not in out:
			out.append(ref)
	return out
