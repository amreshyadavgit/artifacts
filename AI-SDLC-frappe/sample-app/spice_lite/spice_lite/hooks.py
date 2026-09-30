app_name = "spice_lite"
app_title = "Spice Lite"
app_publisher = "AI-SDLC Course"
app_description = "Teaching reference app: a tiny FHIR-lite clinical core (Patient, Encounter, Observation) on Frappe v15"
app_email = "course@example.com"
app_license = "mit"

# Apps
# ------------------
# frappe is always implied; list other apps this one needs installed first.
required_apps = []

# Installation
# ------------
# Roles are created in code (idempotent) rather than shipped as fixtures, so a
# fresh site and an existing site converge to the same state.
after_install = "spice_lite.install.after_install"

# Migration
# ---------
# Re-run the idempotent role/bootstrap step on every `bench migrate`.
after_migrate = ["spice_lite.install.after_migrate"]

# Document Events
# ---------------
# Not needed: each DocType controller implements its own validate/on_update.
# doc_events = {
# 	"SL Observation": {"on_update": "spice_lite.audit.some_handler"},
# }

# Scheduled Tasks
# ---------------
# scheduler_events = {"daily": ["spice_lite.tasks.daily"]}

# Testing
# -------
# before_tests = "spice_lite.install.before_tests"
