# Negative control: a PHI leak in the evidence

Synthetic. The surname in these two files is invented, but it is shaped exactly like the leaks security-review reports (SEC-002: `Form Dict` lines in `logs/frappe.log`; SEC-003: search terms in the nginx access log). `build-timeline.mjs` must exit 3, name `frappe.log:3` and `nginx-access.log:1`, and print neither the surname nor any timeline.
