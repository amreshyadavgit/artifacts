#!/usr/bin/env python3
"""Audit Frappe API keys against the integration-user registry. Read-only; never prints a key or secret.

Policy (docs/governance/secrets.md): every integration (ERPNext connector, telephony app, the read-only
MCP server, ...) authenticates as its OWN User with its OWN api_key/api_secret, holds only the roles the
registry lists for it, is never System Manager or Administrator, and has an IP allowlist (`restrict_ip`,
which Frappe v15 enforces for API-key requests in `frappe.auth.validate_auth`).

Run against a site with the bench's Python (holds a DB connection, reads nothing secret itself):
    cd /home/user/frappe-bench/sites && ../env/bin/python \
        /path/to/AI-SDLC-frappe/scripts/governance/audit_api_users.py --site test.localhost
Offline (rows exported earlier, or a fixture):
    python3 scripts/governance/audit_api_users.py --rows rows.json
Exit 0 = no errors, 1 = errors (warnings allowed unless --strict), 2 = usage error.
"""

import argparse
import json
import pathlib
import sys

REGISTRY = pathlib.Path(__file__).resolve().parents[2] / "docs/governance/integration-users.json"
FORBIDDEN_ROLES = {"System Manager", "Administrator"}
NEVER_KEYED = {"Administrator", "Guest"}


def audit(rows, registry):
	"""rows: [{user, enabled, user_type, has_api_key, restrict_ip, roles}] -> list of (level, user, message)."""
	findings = []
	by_user = {}
	for entry in registry.get("integrations", []):
		u = entry["user"]
		if u in by_user:
			findings.append(("error", u, f"registry: integrations '{by_user[u]['name']}' and '{entry['name']}' share one user; each integration needs its own user and key"))
		by_user[u] = entry
	seen = set()
	for r in rows:
		user = r["user"]
		seen.add(user)
		entry = by_user.get(user)
		roles = set(r.get("roles") or [])
		if not r.get("has_api_key"):
			if entry:
				findings.append(("warn", user, f"registered for '{entry['name']}' but has no API key (not provisioned yet?)"))
			continue
		if user in NEVER_KEYED:
			findings.append(("error", user, "has an API key; Administrator and Guest must never have one"))
			continue
		bad = sorted(roles & FORBIDDEN_ROLES)
		if bad:
			findings.append(("error", user, f"API-key user holds {', '.join(bad)}; an integration key must never carry admin rights"))
		if not entry:
			findings.append(("error", user, "has an API key but is not in docs/governance/integration-users.json (unregistered credential: revoke it or register the integration)"))
			continue
		extra = sorted(roles - set(entry.get("roles", [])))
		if extra:
			findings.append(("error", user, f"roles not allowed for '{entry['name']}': {', '.join(extra)}"))
		if not r.get("enabled"):
			findings.append(("warn", user, "user is disabled but still has an API key; Frappe rejects it, but clear the key so it cannot be re-enabled by accident"))
		if not (r.get("restrict_ip") or "").strip():
			findings.append(("warn", user, f"no restrict_ip allowlist for '{entry['name']}'"))
	for u, entry in by_user.items():
		if u not in seen:
			findings.append(("warn", u, f"registered for '{entry['name']}' but the user does not exist on this site"))
	return findings


def fetch_rows(site, registry):
	import frappe
	from frappe.permissions import AUTOMATIC_ROLES

	frappe.init(site=site, sites_path=".")
	frappe.connect()
	try:
		keyed = frappe.get_all("User", filters={"api_key": ("is", "set")}, pluck="name")
		wanted = sorted(set(keyed) | {e["user"] for e in registry.get("integrations", [])})
		rows = []
		for name in wanted:
			u = frappe.db.get_value("User", name, ["name", "enabled", "user_type", "api_key", "restrict_ip"], as_dict=True)
			if not u:
				continue
			roles = [x for x in frappe.get_roles(name) if x not in AUTOMATIC_ROLES]
			rows.append({"user": u.name, "enabled": bool(u.enabled), "user_type": u.user_type, "has_api_key": bool(u.api_key), "restrict_ip": u.restrict_ip or "", "roles": sorted(roles)})
		return rows
	finally:
		frappe.destroy()


def main(argv=None):
	p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
	g = p.add_mutually_exclusive_group(required=True)
	g.add_argument("--site")
	g.add_argument("--rows", help="JSON file with rows (offline mode)")
	p.add_argument("--registry", default=str(REGISTRY))
	p.add_argument("--strict", action="store_true")
	a = p.parse_args(argv)
	registry = json.loads(pathlib.Path(a.registry).read_text())
	rows = json.loads(pathlib.Path(a.rows).read_text()) if a.rows else fetch_rows(a.site, registry)
	findings = audit(rows, registry)
	keyed = [r for r in rows if r.get("has_api_key")]
	print(f"API-key audit for {a.site or a.rows}: {len(keyed)} user(s) with an API key, {len(registry.get('integrations', []))} registered integration(s)")
	for r in sorted(rows, key=lambda r: r["user"]):
		print(f"  {r['user']:<42} key={'yes' if r.get('has_api_key') else 'no ':<3}  enabled={int(bool(r.get('enabled')))}  roles={','.join(r.get('roles') or []) or '-'}")
	for level, user, msg in sorted(findings, key=lambda f: (f[0] != "error", f[1])):
		print(f"{'ERROR' if level == 'error' else 'WARN '}  {user}: {msg}")
	errors = sum(1 for f in findings if f[0] == "error")
	warns = len(findings) - errors
	print(f"{errors} error(s), {warns} warning(s)")
	return 1 if errors or (a.strict and warns) else 0


if __name__ == "__main__":
	sys.exit(main())
