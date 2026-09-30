# PHI and secrets policy (agents and humans)

This policy applies to code, logs, prompts, eval datasets, commit messages, and anything an agent sends to an MCP server.

## PHI
- Never log PHI. Log resource ids, request ids, and outcome codes only (see `sample-app` `AuditLogger`).
- Never paste real patient data into a prompt, a skill, an eval case, or a Jira/GitHub comment. Use synthetic data (`MRN-000123`, "Test Patient").
- Error responses (`OperationOutcome.diagnostics`) must not echo request bodies containing PHI.
- Agents must not read files under `sample-app/data/real/` or any path matching `**/*.phi.*` (enforced by `permissions.deny` in `.claude/settings.json`).

## Secrets
- No secrets in the repo. Database passwords come from environment variables locally and from a Kubernetes `Secret` in the cluster.
- `.env`, `.env.*`, `**/secrets/**` are denied to agents via `permissions.deny`.
- MCP server credentials are passed with `${VAR}` expansion in `.mcp.json`, never inline.
- A `PreToolUse` hook blocks writes that contain likely secrets (see `.claude/hooks/`).

## Authentication and authorization (sample app)
- All `/fhir/**` endpoints require authentication. `/actuator/health/**` is public.
- Roles: `CLINICIAN` (read/write Patient and Observation), `ADMIN` (everything, including DELETE).
- Authorization is enforced server-side per endpoint; never trust client-supplied role claims.

## Review severities
`critical` (exploitable now, PHI exposure, auth bypass) · `high` (exploitable with effort, missing authZ on a write path) · `medium` (defence-in-depth gap) · `low` (hardening) · `info`.
