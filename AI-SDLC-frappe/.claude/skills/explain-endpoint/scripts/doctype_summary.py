#!/usr/bin/env python3
"""One line per DocType: naming, indexed/unique/required fields, Links, and role permissions.

Injected into /explain-endpoint so Claude starts with the schema facts that decide which SQL an
endpoint can use (search_index, unique) and who may call it (the DocPerm rows), read straight
from the DocType JSON files instead of recalled.

	python3 .claude/skills/explain-endpoint/scripts/doctype_summary.py [app_package_dir]

Default app_package_dir: sample-app/spice_lite/spice_lite (relative to AI-SDLC-frappe/).
Exit 0 always when the directory exists (so a skill injection never aborts); 2 if it does not.
Zero dependencies.
"""

import json
import pathlib
import sys

PERM_FLAGS = (("read", "r"), ("write", "w"), ("create", "c"), ("delete", "d"), ("submit", "s"), ("cancel", "x"))


def summarise(path: pathlib.Path) -> str:
	d = json.loads(path.read_text())
	fields = d.get("fields", [])
	idx = [f["fieldname"] for f in fields if f.get("search_index")]
	uniq = [f["fieldname"] for f in fields if f.get("unique")]
	reqd = [f["fieldname"] for f in fields if f.get("reqd")]
	links = [f"{f['fieldname']}->{f.get('options')}" for f in fields if f.get("fieldtype") == "Link"]
	perms = []
	for p in d.get("permissions", []):
		flags = "".join(ch for key, ch in PERM_FLAGS if p.get(key))
		level = f"@{p['permlevel']}" if p.get("permlevel") else ""
		owner = " if_owner" if p.get("if_owner") else ""
		perms.append(f"{p.get('role')}{level}:{flags or '-'}{owner}")
	rel = path.as_posix()
	return (
		f"{d.get('name')} [{rel}] table=`tab{d.get('name')}` autoname={d.get('autoname') or '-'}"
		f" | search_index: {', '.join(idx) or '-'} | unique: {', '.join(uniq) or '-'}"
		f" | reqd: {', '.join(reqd) or '-'} | links: {', '.join(links) or '-'}"
		f" | perms: {'; '.join(perms) or '-'}"
	)


def main(argv: list[str]) -> int:
	root = pathlib.Path(argv[1] if len(argv) > 1 else "sample-app/spice_lite/spice_lite")
	if not root.is_dir():
		print(f"doctype_summary: {root} is not a directory (run from AI-SDLC-frappe/)")
		return 2
	files = sorted(p for p in root.glob("*/doctype/*/*.json") if p.stem == p.parent.name)
	for p in files:
		print(summarise(p))
	if not files:
		print(f"doctype_summary: no DocType JSON under {root}")
	return 0


if __name__ == "__main__":
	sys.exit(main(sys.argv))
