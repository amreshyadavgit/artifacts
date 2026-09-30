# Copyright (c) 2026, AI-SDLC Course and contributors
# License: MIT. See license.txt
"""Access audit logging for spice_lite.

Rule: log WHO did WHAT to WHICH document -- by document *name* only.
Never log field values, search terms (a family name is PHI), MRNs or request
bodies. That is also why this module does NOT use `with_more_info=True`:
Frappe's SiteContextFilter would then append `frappe.form_dict` (the request
parameters) to every line.

Lines go to `<bench>/logs/spice_lite.audit.log` and
`<bench>/sites/<site>/logs/spice_lite.audit.log` (see frappe/utils/logger.py).
"""

import logging

import frappe

AUDIT_LOGGER = "spice_lite.audit"


def _logger() -> logging.Logger:
	logger = frappe.logger(AUDIT_LOGGER, allow_site=True, max_size=1_000_000, file_count=10)
	# frappe.logger() sets the level to frappe.log_level or ERROR (WARNING under `bench serve`),
	# see frappe/utils/logger.py `default_log_level`. Without this, .info() audit lines are
	# silently dropped. Loggers are cached in frappe.loggers, so this sticks per process.
	logger.setLevel(logging.INFO)
	return logger


def log_access(action: str, doctype: str, names=None, **counts) -> dict:
	"""Record an access event. `names` is a doc name or list of doc names.

	`counts` may carry non-identifying integers (e.g. result_count=3).
	Returns the logged record (handy for tests).
	"""
	if names is None:
		names = []
	elif isinstance(names, str):
		names = [names]
	record = {
		"action": action,
		"doctype": doctype,
		"names": list(names),
		"user": getattr(getattr(frappe, "session", None), "user", None),
	}
	for key, value in counts.items():
		if isinstance(value, int):
			record[key] = value
	_logger().info(record)
	return record
