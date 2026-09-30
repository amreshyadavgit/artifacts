# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Site-less unit tests for the FHIR-lite mappers.

Run WITHOUT a bench:   cd sample-app/spice_lite && python -m pytest spice_lite/tests/unit
                  or:  cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .
Nothing here imports frappe (or pytest): `bench run-tests --app spice_lite` also picks this file up,
and the bench venv has no pytest. mappers.py must stay frappe-free at module level.
"""

import datetime as dt
import importlib.util
import pathlib
import unittest

# Import mappers.py by path so `spice_lite/__init__.py` / frappe are never needed.
_MAPPERS = pathlib.Path(__file__).resolve().parents[2] / "api" / "mappers.py"
_spec = importlib.util.spec_from_file_location("spice_lite_mappers_under_test", _MAPPERS)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


class TestMappers(unittest.TestCase):
	def test_mappers_module_does_not_import_frappe(self):
		assert "frappe" not in m.__dict__
		lines = [ln.strip() for ln in _MAPPERS.read_text().splitlines()]
		assert not [ln for ln in lines if ln.startswith(("import frappe", "from frappe"))]


	def test_patient_to_fhir_full(self):
		row = {
			"name": "SLP-00001",
			"mrn": "MRN-1",
			"first_name": "Amina",
			"last_name": "Otieno",
			"gender": "female",
			"birth_date": dt.date(1980, 1, 2),
			"active": 1,
			"country": "KE",
		}
		assert m.patient_to_fhir(row) == {
			"resourceType": "Patient",
			"id": "SLP-00001",
			"identifier": [{"system": "urn:spice-lite:mrn", "value": "MRN-1"}],
			"active": True,
			"name": [{"family": "Otieno", "given": ["Amina"]}],
			"gender": "female",
			"birthDate": "1980-01-02",
			"address": [{"country": "KE"}],
		}


	def test_patient_to_fhir_drops_empty_and_unknown_gender_value(self):
		out = m.patient_to_fhir({"name": "SLP-2", "active": 0, "gender": "M"})
		assert out == {"resourceType": "Patient", "id": "SLP-2", "active": False}


	def test_observation_to_fhir_with_quantity(self):
		row = {
			"name": "SLO-1",
			"patient": "SLP-1",
			"encounter": "SLE-1",
			"code": "8480-6",
			"code_display": "Systolic blood pressure",
			"status": "final",
			"effective_datetime": "2026-01-01 10:00:00.123456",
			"value": 120,
			"unit": "mm[Hg]",
		}
		out = m.observation_to_fhir(row)
		assert out["subject"] == {"reference": "Patient/SLP-1"}
		assert out["encounter"] == {"reference": "Encounter/SLE-1"}
		assert out["effectiveDateTime"] == "2026-01-01T10:00:00"
		assert out["code"]["coding"] == [{"system": "http://loinc.org", "code": "8480-6", "display": "Systolic blood pressure"}]
		assert out["valueQuantity"] == {
			"value": 120.0,
			"unit": "mm[Hg]",
			"system": "http://unitsofmeasure.org",
			"code": "mm[Hg]",
		}


	def test_observation_without_unit_has_no_value_quantity(self):
		out = m.observation_to_fhir({"name": "SLO-2", "patient": "SLP-1", "code": "x", "status": "preliminary", "value": 0.0})
		assert "valueQuantity" not in out


	def test_bundle_and_operation_outcome_shapes(self):
		b = m.bundle([{"resourceType": "Patient", "id": "a"}])
		assert b == {"resourceType": "Bundle", "type": "searchset", "total": 1, "entry": [{"resource": {"resourceType": "Patient", "id": "a"}}]}
		oo = m.operation_outcome("required", "need a param")
		assert oo["resourceType"] == "OperationOutcome"
		assert oo["issue"] == [{"severity": "error", "code": "required", "diagnostics": "need a param"}]


	def test_parse_subjects(self):
		cases = [
			(None, []),
			("", []),
			("SLP-1", ["SLP-1"]),
			("Patient/SLP-1, SLP-2 ,SLP-1", ["SLP-1", "SLP-2"]),
			('["Patient/SLP-3", "SLP-4"]', ["SLP-3", "SLP-4"]),
			(["SLP-5", "Patient/SLP-6"], ["SLP-5", "SLP-6"]),
		]
		for value, expected in cases:
			with self.subTest(value=value):
				assert m.parse_subjects(value) == expected


	def test_parse_subjects_bad_json_raises_value_error(self):
		with self.assertRaises(ValueError):
			m.parse_subjects("[not json")


	def test_parse_token_and_reference(self):
		assert m.parse_token("urn:spice-lite:mrn|MRN-9") == "MRN-9"
		assert m.parse_token("MRN-9") == "MRN-9"
		assert m.parse_token("sys|") is None
		assert m.parse_reference("Encounter/SLE-1", "Encounter") == "SLE-1"
		assert m.parse_reference("SLE-1", "Encounter") == "SLE-1"
