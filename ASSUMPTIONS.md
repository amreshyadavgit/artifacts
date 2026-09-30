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
