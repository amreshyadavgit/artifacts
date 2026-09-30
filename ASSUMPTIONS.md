# ASSUMPTIONS

Decisions made without asking, so the run could complete uninterrupted.

## Learner context
1. The learner-context fields in the brief were unfilled templates (`[e.g., ...]`). The bracketed examples were adopted as the real values: **senior backend engineer new to Claude Code agents; Java 21 / Spring Boot / PostgreSQL / Kubernetes; healthcare, FHIR APIs.**
2. "FHIR Patient/Observation API" is implemented as a **FHIR-lite** JSON model (resourceType, Bundle, OperationOutcome shapes) without HAPI FHIR, so the sample app stays small, fast to build, and readable in exercises. It is not a conformant FHIR server.
3. All patient data is synthetic. No real PHI appears anywhere.

## Repository layout
4. Everything lives in the existing `amreshyadavgit/artifacts` repo on branch `claude/ai-sdlc-curriculum-repo-bidp0m`. Build tooling sits at repo root (`build/`, `content/`, `src/`, `dist/`); the taught reference repo is `AI-SDLC/`, which is also the Claude Code project root (its own `CLAUDE.md`, `.claude/`, `.mcp.json`).
5. Runtime Claude Code files live where Claude Code reads them (`AI-SDLC/.claude/agents`, `AI-SDLC/.claude/skills`). The top-level `AI-SDLC/agents/` and `AI-SDLC/skills/` folders hold the *engineering-asset* side: Agent Contracts, READMEs, CHANGELOGs, and skill test cases. This avoids duplicating runtime definitions.
6. Run handoffs are written to `AI-SDLC/.ai-sdlc/runs/<run-id>/` and git-ignored.

## Curriculum structure
7. The brief's ten writers map to 12 modules so that every level 1–9 has content: `00` (worked example, level 1), `01` (W1), `02` (W2), `03`–`05` (W3–W5, level 3), `06` (W6, level 4), `07`/`08` (W7, levels 5 and 6), `09` (W8, level 7), `10` (W9, level 8), `11` (W10, level 9).
8. The worked example module `00-example.json` is a real module (project memory and context engineering), not a throwaway, and ships in the SPA.
9. The schema's `level` is a single integer. W2's "Level 1–3 hands-on" is assigned level 2.
10. Skills and agent files in `AI-SDLC/` are real and loadable by Claude Code, but they have not been executed against a live model in this build (no API key in the build container). The eval harness has an offline replay mode used for the smoke test; the live mode is documented and runnable by the learner.

## SPA
11. The SPA loads marked, highlight.js, mermaid, and JSZip from cdnjs (the brief allows cdnjs and jsDelivr). Syntax-highlight colours are inlined as theme tokens instead of loading a highlight.js stylesheet, so light/dark mode works from one set of tokens.
12. Deep links use bare hash tokens (`#m-<module>`, `#x-<exercise>`, `#t-<type>`, `#f~<path>`), which keeps them valid in sandboxed viewers that only pass simple anchors.
13. "Download starter repo" zips every implementation file at its real path. When a starting file would overwrite an implementation file with the same path, the starting version goes under `starting-files/<exercise-id>/`.
14. `sample-app/` is not embedded in full in the SPA (only the files exercises touch); the full app is in the repository.

## Publication and language (added on request)
15. Published through GitHub Pages from the root of `main`. The build writes the page to both `dist/index.html` and `ai-sdlc-curriculum.html` at the repo root, since Pages serves `main` root (as the repo's existing pages do). URL: https://amreshyadavgit.github.io/artifacts/ai-sdlc-curriculum.html
16. **Hinglish** means Hindi grammar in Latin script with English technical terms kept as is, in the informal "tum" register engineers use with each other. No Devanagari.
17. Only prose is translated: titles, summaries, concepts, table text, exercise objectives, test-case names and descriptive expectations, criteria, improvements, contracts, and checklists. Code, file contents, commands, config keys, mermaid source, and real tool output stay English so they still match the repository byte for byte.
18. Translations are overlay files (`content/i18n/hinglish/<module>.json`) merged by index at runtime. Any missing string falls back to English, and the build warns when an overlay's shape drifts from the English module. The language choice is stored in localStorage (wrapped in try/catch) and defaults to English.
19. The reference repository files (`AI-SDLC/**`: agent prompts, skills, docs) stay English. Agents run best on one language, and the files must match the English content exactly.

## Frappe edition (added on request: "create a separate one for Frappe")
20. The Frappe edition is a second, parallel curriculum. It does not replace the Java edition: same 12 module ids and levels, same agent roster, skill names, handoff format and eval approach. It has its own reference repo `AI-SDLC-frappe/`, content in `content-frappe/`, generators in `build/sources-frappe/`, and output `ai-sdlc-frappe-curriculum.html` (plus `dist/frappe/index.html`). Each edition links to the other from the sidebar.
21. The Frappe reference app `spice_lite` is modelled on the platform described in this repo's `frappe-for-spice.html`: a `spice_next_core`-style clinical core (Patient, Encounter, Observation), one deployment per country, PostgreSQL 16, Redis cache/queue/socketio, integration apps via `required_apps`, ERPNext only as an external integration target. It is a teaching-size app, not a copy of spice_next_core.
22. Frappe `version-15` (15.121.2) on PostgreSQL 16 is the primary target, matching production. The same app is also tested on MariaDB 10.11. Frappe v15 warns that it gets no more Postgres fixes; one v15 Postgres filter bug (D-2) is worked around and documented.
23. DocTypes are prefixed `SL ` (`SL Patient`, …) so the app can be installed next to other clinical apps without name clashes. Documents are named by series, never by MRN, because the MRN is PHI.
24. The FHIR-lite API uses whitelisted methods (`/api/method/spice_lite.api.fhir.*`) rather than FHIR URLs. The FHIR `$lastn` operation is the method `lastn`.
25. The bench lives outside the repo (`/home/user/frappe-bench` in the build container) and is reproduced by `AI-SDLC-frappe/sample-app/scripts/setup-bench.sh`. The unit tests run with the standard library (`python -m unittest`), so no pytest install is needed.
26. "Hook" is split into "Frappe hook" (`hooks.py`) and "Claude Code hook" (`.claude/settings.json`) throughout the Frappe edition.
