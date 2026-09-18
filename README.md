# Artifacts

Standalone HTML pages — reference docs, explainers, and one-off writeups — published via GitHub Pages.

## Frappe for Spice

Frappe framework brief: app/site model, extensibility, ERPNext integration, and the spice clinical domain.

**View:** https://amreshyadavgit.github.io/artifacts/frappe-for-spice.html

## Shukhee Integration Map

Sequence and dependency diagrams for the Shukhee teleconsultation integration: inbound and outbound Bearer-token auth, the booking/polling flow, and the spice_next_core / shukhee_integration / leapwell_telemetry / uhis app dependency graph.

**View:** https://amreshyadavgit.github.io/artifacts/shukhee-integration-map.html

## Uhis Deploy Flow

How the uhis GitHub Actions workflow builds the all-in-one Docker image (checking out frappe_theme, spice_next_core, shukhee_integration and leapwell_telemetry before uhis itself), and how that image creates its Frappe site and installs each app the first time the container boots.

**View:** https://amreshyadavgit.github.io/artifacts/uhis-deploy-flow.html
