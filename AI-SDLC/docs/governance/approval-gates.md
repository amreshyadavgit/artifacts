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
| `acceptEdits` | no | still prompt: file edits in working dirs are auto-accepted, but an explicit `ask` rule such as `Edit(./.claude/**)` is never auto-approved | prompt | enforced |
| `dontAsk` | no | denied instead of prompted (docs: dontAsk "denies calls matching your explicit ask rules") | denied (inferred: dontAsk auto-denies every call that would prompt; unverified) | enforced |
| `bypassPermissions` | no | still prompt (docs: explicit ask rules are among the "actions no mode auto-approves") | (unverified) do not rely on it | deny rules still apply |
| `auto` | no | still prompt (docs: "Explicit ask rules still force a prompt") | prompt; the classifier may still deny, but cannot approve silently (v2.1.211+) | enforced |

Source: https://code.claude.com/docs/en/permission-modes ("Actions no mode auto-approves", dontAsk and auto sections) and https://code.claude.com/docs/en/hooks (PreToolUse `permissionDecision`), checked 2026-09-30. Two caveats remain. `bypassPermissions` skips every prompt that is not on the "no mode auto-approves" list, and whether a hook's `"ask"` survives it is not stated, so G4 there is unverified: G8 (`disableBypassPermissionsMode`) is the control that matters. In `dontAsk`, gates G2 to G4 (and the `Agent(developer)` ask rule of the workflows) turn into denials, which stops a headless run at the first gate by design. Verify the rows in your Claude Code version with `node .claude/hooks/guard-outbound.test.mjs` plus one live MCP write attempt before relying on them.

## Setting up G6 on GitHub

1. Copy `docs/governance/CODEOWNERS.example` to `.github/CODEOWNERS`; replace `@example-org/*` with real teams that have write access.
2. Copy `docs/governance/ai-change-gate.yml.example` to `.github/workflows/ai-change-gate.yml`. Set `AI_SDLC_DIR` to `.` if `AI-SDLC/` is the repository root.
3. Optional: set repository variable `AI_GOVERNANCE_APPROVERS` (comma-separated logins).
4. Branch protection on `main`: require PR, 1+ approval, require review from Code Owners, dismiss stale approvals, required status check `require-human-approval`.
5. Prove it: open a PR that changes `.claude/agents/reviewer.md`; the check fails with "Human approval required"; approve as a governance member; the check re-runs on `pull_request_review` and passes.
