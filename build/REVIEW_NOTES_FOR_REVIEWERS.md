# Notes collected by the orchestrator from writer reports (input for R1-R3)
- W5: sample-app ObservationService.create does not check that the subject Patient is active (glossary rule 3). A second, real (unplanned) defect used by exercise 05-roster-smoke-test. Must be documented consistently (KNOWN_DEFECTS.md mentions only the n+1; CLAUDE.md/STYLE_GUIDE say "exactly one intentional defect").
- W5: code-review skill rates PHI in logs `high` while context/security/phi-and-secrets-policy.md says PHI exposure is `critical`. Reconcile across skills/agents/evals.
- W5: code-review skill `APPROVE` verdict = "no blocking findings", never merge approval. Check wording consistency with reviewer contract "never approve".
- W6: claims the current MCP spec (2026-07-28) has no `initialize` handshake (server/discover instead). Verify or soften; server supports both.
- W6: permissions fragment `AI-SDLC/mcp/permissions.settings-fragment.json` should be merged into `.claude/settings.json` by W9.
- W2: suggests `Bash(node .claude/skills/run-tests/scripts/summarize-surefire.mjs *)` in permissions.allow.
- W2/W5 unverified: whether frontmatter hooks/preloaded skills apply under `claude --agent`; `permission_denials` subfields.
