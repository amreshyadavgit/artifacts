"""Unit tests for audit_api_users.audit (no bench needed).

Run: cd AI-SDLC-frappe && python3 -m unittest scripts/governance/test_audit_api_users.py -v
"""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from audit_api_users import audit  # noqa: E402

REGISTRY = {
	"integrations": [
		{"name": "erpnext-billing", "user": "erpnext.integration@spice-lite.test", "roles": ["Clinician"]},
		{"name": "telephony", "user": "telephony.integration@spice-lite.test", "roles": ["Clinician"]},
	]
}


def row(user, **kw):
	base = {"user": user, "enabled": True, "user_type": "System User", "has_api_key": True, "restrict_ip": "10.20.0.15", "roles": ["Clinician"]}
	base.update(kw)
	return base


def errors(findings):
	return [(u, m) for level, u, m in findings if level == "error"]


class TestAuditApiUsers(unittest.TestCase):
	def test_compliant_integrations_pass(self):
		f = audit([row("erpnext.integration@spice-lite.test"), row("telephony.integration@spice-lite.test")], REGISTRY)
		self.assertEqual(f, [])

	def test_system_manager_on_integration_key_is_an_error(self):
		f = audit([row("telephony.integration@spice-lite.test", roles=["Clinician", "System Manager"])], REGISTRY)
		self.assertTrue(any("never carry admin rights" in m for _, m in errors(f)))

	def test_unregistered_key_is_an_error(self):
		f = audit([row("clinician@spice-lite.test")], REGISTRY)
		self.assertTrue(any("not in docs/governance/integration-users.json" in m for _, m in errors(f)))

	def test_administrator_key_is_an_error(self):
		f = audit([row("Administrator", roles=["System Manager"])], REGISTRY)
		self.assertEqual(errors(f), [("Administrator", "has an API key; Administrator and Guest must never have one")])

	def test_shared_user_across_integrations_is_an_error(self):
		reg = {"integrations": REGISTRY["integrations"] + [{"name": "sms", "user": "telephony.integration@spice-lite.test", "roles": ["Clinician"]}]}
		f = audit([], reg)
		self.assertTrue(any("share one user" in m for _, m in errors(f)))

	def test_extra_role_is_an_error(self):
		f = audit([row("erpnext.integration@spice-lite.test", roles=["Clinician", "Accounts Manager"])], REGISTRY)
		self.assertTrue(any("Accounts Manager" in m for _, m in errors(f)))

	def test_missing_ip_allowlist_and_disabled_user_are_warnings(self):
		f = audit([row("erpnext.integration@spice-lite.test", restrict_ip="", enabled=False)], REGISTRY)
		levels = sorted(level for level, _, _ in f)
		self.assertEqual(errors(f), [])
		self.assertIn("warn", levels)
		self.assertTrue(any("restrict_ip" in m for _, _, m in f))

	def test_registered_but_unprovisioned_is_a_warning(self):
		f = audit([row("erpnext.integration@spice-lite.test", has_api_key=False)], REGISTRY)
		self.assertEqual(errors(f), [])
		self.assertTrue(any("no API key" in m for _, _, m in f))


if __name__ == "__main__":
	unittest.main()
