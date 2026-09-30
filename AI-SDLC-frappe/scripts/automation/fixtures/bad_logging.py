# SYNTHETIC fixture for check-phi-logging.mjs: every PHI-logging mistake the checker must catch, plus lines it
# must NOT flag. Not part of spice_lite; never imported.
import frappe
from frappe import _

from spice_lite.audit import log_access


def search_patients(family=None, identifier=None):
	# BAD phi-field (2 findings): search terms are PHI
	frappe.logger("spice_lite.search").info(f"search family={family} identifier={identifier}")
	# BAD more-info: appends frappe.form_dict (the request parameters) to every line
	log = frappe.logger("spice_lite.search", with_more_info=True)
	rows = frappe.get_list("SL Patient", filters={"last_name": family}, pluck="name")  # not a sink: fine
	# GOOD: names and a count only
	log_access("search", "SL Patient", rows, result_count=len(rows))
	return rows


def validate_unique_mrn(doc):
	# GOOD: the word MRN inside a plain string is not a value
	frappe.throw(_("A patient with this MRN already exists"))
	# BAD phi-field: the value itself reaches the client and the Error Log
	frappe.throw(_("MRN {0} already exists").format(doc.mrn))


def sync_to_erpnext(doc):
	try:
		pass
	except Exception:
		# BAD whole-doc: the full document, with every PHI field, lands in the Error Log DocType
		frappe.log_error(title="ERPNext sync failed", message=str(doc.as_dict()))


def rename_patient(patient):
	# BAD phi-field, multi-line call with a "#" inside the string
	frappe.logger().info(
		"# renamed {0}".format(
			patient.last_name,
		)
	)
