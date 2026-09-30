"""Capture the SQL a spice_lite whitelisted method really sends to the database.

Used to build `.claude/skills/explain-endpoint/reference.md` from observation instead of memory.

Run with the bench's Python, from the bench's `sites/` directory, as the bench user:

	cd /home/user/frappe-bench/sites
	../env/bin/python /path/to/AI-SDLC-frappe/docs/tutorials/level-2/tools/capture_sql.py test.localhost get_patient

Endpoints: get_patient, search_patients, lastn, create_observation. Add `--subjects N` for lastn.

How it works:
- It records every statement through `Database._log_query`, the method Frappe calls after each
  executed query (`frappe/database/database.py`, `log_query`). On Postgres the recorded text is
  `cursor.query`, the statement exactly as psycopg2 sent it, after Frappe's `modify_query` rewrote
  backticks to double quotes.
- It creates its own synthetic patients and observations, then calls the method twice as the
  Clinician test user: the first (cold) call also loads DocType meta, permission and value caches;
  the second (warm) call is what a busy web worker runs. Both counts are printed.
- It never commits: everything is rolled back in `finally`. It does not change site config or the
  shared Redis cache flag that `frappe.print_sql(True)` would set.

Hold the shared bench lock while it runs (see the level-2 tutorial README).
"""

import argparse
import re
import sys

import frappe


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument("site")
	parser.add_argument("endpoint", choices=["get_patient", "search_patients", "lastn", "create_observation"])
	parser.add_argument("--subjects", type=int, default=2, help="lastn only: number of subjects")
	parser.add_argument("--cold", action="store_true", help="list the first (cold-cache) call instead of the second")
	args = parser.parse_args()

	frappe.init(site=args.site, sites_path=".")
	frappe.connect()
	frappe.flags.in_test = True  # same argument type coercion as a request (typing_validations)
	recorded: list[str] = []
	db_class = frappe.db.__class__
	original_log_query = db_class._log_query

	def recording_log_query(self, mogrified_query, *a, **kw):
		recorded.append(str(mogrified_query))
		return original_log_query(self, mogrified_query, *a, **kw)

	try:
		from spice_lite.api import fhir
		from spice_lite.tests.utils import CLINICIAN, call, ensure_test_users, make_observation, make_patient

		frappe.set_user("Administrator")
		ensure_test_users()
		family = "Zz" + frappe.generate_hash(length=8)
		patients = [make_patient(last_name=family) for _ in range(max(args.subjects, 1))]
		for p in patients:
			make_observation(p.name, minutes_ago=30)
			make_observation(p.name, minutes_ago=5)

		calls = {
			"get_patient": (fhir.get_patient, {"name": patients[0].name}),
			"search_patients": (fhir.search_patients, {"family": family}),
			"lastn": (fhir.lastn, {"subjects": [p.name for p in patients[: args.subjects]], "code": "8480-6"}),
			"create_observation": (
				fhir.create_observation,
				{"patient": "Patient/" + patients[0].name, "code": "8867-4", "value": "72", "unit": "/min",
				 "effective_datetime": "2026-09-30 09:00:00"},
			),
		}
		fn, kwargs = calls[args.endpoint]
		frappe.set_user(CLINICIAN)
		db_class._log_query = recording_log_query
		try:
			call(fn, **kwargs)  # cold: loads DocType meta, permission and value caches
			cold = recorded[:]
			recorded.clear()
			status, body = call(fn, **kwargs)  # warm: the steady state of a busy worker
		finally:
			db_class._log_query = original_log_query

		shown = cold if args.cold else recorded
		print(
			f"# {args.endpoint} as {CLINICIAN} on {frappe.db.db_type}: HTTP {status}; "
			f"cold call {len(cold)} statements, warm call {len(recorded)} statements; listing {'cold' if args.cold else 'warm'}"
		)
		for i, q in enumerate(shown, 1):
			q = re.sub(r"\s+", " ", q).strip()
			q = q.replace(family, "<family>").replace(frappe.conf.db_name or "\0", "<db_name>")
			for p in patients:
				q = q.replace(p.name, "<patient>").replace(p.mrn, "<mrn>")
			print(f"{i:>2}. {q}")
		return 0
	finally:
		frappe.db.rollback()
		frappe.destroy()


if __name__ == "__main__":
	sys.exit(main())
