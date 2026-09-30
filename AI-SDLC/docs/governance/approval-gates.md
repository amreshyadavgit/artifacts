# Human approval gates

A **human gate** is a point where work stops until a named human approves. In this repo every gate is a real mechanism that Claude Code or GitHub enforces. An instruction in a prompt ("ask me before pushing") is not a gate.

## The gates

| # | Gate | When | Mechanism | Who approves | Evidence left behind |
|---|---|---|---|---|---|
| G1 | Plan approval | Before the developer agent edits `sample-app/` | Plan mode: `claude --permission-mode plan`, Shift+Tab in the terminal, `/plan` prefix for one prompt, or `permissionMode: plan` in an agent file. No source edits until the plan is approved. | The engineer who owns the ticket | Approved plan in `.ai-sdlc/runs/<run-id>/` |
| G2 | Risky command | `git commit`, `git push`, `gh pr create`, `kubectl apply`, `curl`, `wget`, `WebFetch` | `permissions.ask` in `.claude/settings.json` | The person at the terminal | Permission prompt answer (session transcript) |
| G3 | Agent config change (local) | Any edit of `.claude/**`, `.mcp.json`, `CLAUDE.md` | `permissions.ask`: `Edit(./.claude/**)`, `Edit(./.mcp.json)`, `Edit(./CLAUDE.md)` | The person at the terminal | Transcript |
| G4 | Outbound MCP write | Jira comment, GitHub issue or review, any MCP tool with a write or unknown verb | `PreToolUse` hook `.claude/hooks/guard-outbound.mjs` returning `permissionDecision: "ask"`; `"deny"` when the input carries secrets or non-synthetic MRNs | The person at the terminal | Transcript; the hook's reason text |
| G5 | Never allowed | Force-push, `gh pr merge`, MCP merge / push / direct file commits, `kubectl delete`, `rm -rf` | `permissions.deny` (evaluated before ask and allow) | Nobody: a human does it outside Claude Code | n/a |
| G6 | Merge of AI config | PR touching `.claude/**`, `.mcp.json`, `CLAUDE.md`, `skills/**`, `company-ai/**`, `agents/*/CONTRACT.md`, `scripts/governance/**` | CODEOWNERS (`docs/governance/CODEOWNERS.example`) + branch protection "Require review from Code Owners" + required check `ai-change-gate` (`docs/governance/ai-change-gate.yml.example`) | AI governance group | PR approval on the head commit |
| G7 | Merge of any code | Every PR to `main` | Branch protection: 1+ approval, stale approvals dismissed, CI green (`mvn -q -B test`) | Code owner of the touched path | PR approval |
| G8 | Org floor | Always | Managed settings (`docs/governance/managed-settings.example.json`): `disableBypassPermissionsMode: "disable"`, org deny rules, the outbound guard hook. Managed settings sit above project and user settings. | Platform / security team | MDM or server-managed policy history |

## Why several layers

- G2 to G4 run on the developer's machine. They stop an agent in the moment, but a developer can answer "yes" too quickly, and a developer can edit project settings. That is why G3 exists, and why G6 makes config changes reviewable by someone else.
- G5 removes the most dangerous actions from the agent entirely. An injected instruction cannot talk its way past a deny rule.
- G8 is the only layer a project cannot switch off. `disableBypassPermissionsMode: "disable"` means nobody can start `--dangerously-skip-permissions` on a managed machine and silently skip G2 to G4.

## Permission modes and the gates

| Mode | G1 plan | G2/G3 `ask` rules | G4 hook `ask` | G5 `deny` |
|---|---|---|---|---|
| `default` | if entered | prompt | prompt | enforced |
| `plan` | yes: read-only until approved | prompt | prompt | enforced |
| `acceptEdits` | no | file edits in working dirs auto-accepted; other asks prompt | prompt | enforced |
| `dontAsk` | no | anything that would prompt is auto-denied | expected auto-denied (verify) | enforced |
| `bypassPermissions` | no | skipped | do not rely on it (verify) | deny rules still apply |
| `auto` | no | classifier reviews actions (verify) | do not rely on it (verify) | enforced |

Treat the `acceptEdits` row with care: the docs say it auto-accepts file edits in working directories, so do not rely on the `Edit(./.claude/**)` ask rule alone in that mode; G6 (PR review) is the backstop. Cells marked (verify) are inferred from the mode descriptions in the permission-modes docs; verify them in your Claude Code version with `node .claude/hooks/guard-outbound.test.mjs` plus one live MCP write attempt before relying on them.

## Setting up G6 on GitHub

1. Copy `docs/governance/CODEOWNERS.example` to `.github/CODEOWNERS`; replace `@example-org/*` with real teams that have write access.
2. Copy `docs/governance/ai-change-gate.yml.example` to `.github/workflows/ai-change-gate.yml`. Set `AI_SDLC_DIR` to `.` if `AI-SDLC/` is the repository root.
3. Optional: set repository variable `AI_GOVERNANCE_APPROVERS` (comma-separated logins).
4. Branch protection on `main`: require PR, 1+ approval, require review from Code Owners, dismiss stale approvals, required status check `require-human-approval`.
5. Prove it: open a PR that changes `.claude/agents/reviewer.md`; the check fails with "Human approval required"; approve as a governance member; the check re-runs on `pull_request_review` and passes.
