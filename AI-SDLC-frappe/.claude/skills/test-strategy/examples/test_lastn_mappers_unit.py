# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Unit tests from the lastn test plan (no Frappe, no site).

Copy to sample-app/spice_lite/spice_lite/tests/unit/test_lastn_mappers_unit.py, then:

    cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .

Standard library only: `bench run-tests --app` imports every test_*.py in the app and the
bench venv has no pytest.
"""

import unittest

from spice_lite.api import mappers as m


class TestLastnMappers(unittest.TestCase):
	def test_zero_value_with_unit_is_emitted_as_zero_quantity(self):
		# Pins D-1 at the mapper level: the mapper cannot tell "0.0 stored for a missing value"
		# from a real zero, so lastn must not pick incomplete observations (SL-133).
		resource = m.observation_to_fhir(
			{"name": "SLO-1", "patient": "SLP-1", "status": "preliminary", "value": 0.0, "unit": "mm[Hg]"}
		)
		self.assertEqual(resource["valueQuantity"]["value"], 0.0)

	def test_parse_subjects_does_not_cap_the_list(self):
		# The 100-subject cap lives in fhir.lastn (MAX_LASTN_SUBJECTS), not in the mapper,
		# so a 400 for 101 subjects must be tested at the API layer.
		subjects = ",".join(f"SLP-{i:05d}" for i in range(101))
		self.assertEqual(len(m.parse_subjects(subjects)), 101)
