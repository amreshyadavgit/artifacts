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

## AI-SDLC: Agent & Skill Engineering with Claude Code

A hands-on curriculum (levels 1–9) for building subagents, skills, hooks, MCP integrations, workflows, and an eval harness with Claude Code, taught against a real Spring Boot FHIR-lite API. The reference repository it teaches lives in [`AI-SDLC/`](AI-SDLC/); the page is built from `content/modules/` by `node build/build.mjs --edition java`. English and Hinglish, with a link to the Frappe edition.

**View:** https://amreshyadavgit.github.io/artifacts/ai-sdlc-curriculum.html

## AI-SDLC for Frappe

The same curriculum rebuilt for Frappe: subagents, skills, Claude Code hooks, MCP, workflows, evals and governance, taught against `spice_lite`, a real Frappe v15 clinical app (Patient, Encounter, Observation) tested on PostgreSQL 16, modelled on a spice-style per-country platform. The reference repository is [`AI-SDLC-frappe/`](AI-SDLC-frappe/); the page is built from `content-frappe/modules/` by `node build/build.mjs --edition frappe`. English and Hinglish, with a link to the Java edition.

**View:** https://amreshyadavgit.github.io/artifacts/ai-sdlc-frappe-curriculum.html
