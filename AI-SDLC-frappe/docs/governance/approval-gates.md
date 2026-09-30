# Human approval gates (Frappe edition)

A **human gate** is a point where work stops until a named human approves. In this repo every gate is a mechanism that Claude Code, a Claude Code hook, or GitHub enforces. A sentence in a prompt ("ask me before migrating") is not a gate.

## The gates

| # | Gate | When | Mechanism | Who approves | Evidence left behind |
|---|---|---|---|---|---|
| G1 | Plan approval | Before the developer agent edits `sample-app/` (DocType JSON, controller, patch, tests) | Plan mode: `claude --permission-mode plan`, Shift+Tab, the `/plan` prefix, or `permissionMode: plan` in an agent file. No source edits until the plan is approved. | The engineer who owns the ticket | Approved plan in `.ai-sdlc/runs/<run-id>/` |
| G2 | bench command that changes a site | `migrate`, `console`, `execute`, `install-app`, `uninstall-app`, `run-patch`, `set-config`, `backup`, `export-fixtures`, `reload-doc`, `bench update`, `get-app`, `new-site`; `run-tests` on any site other than `test.localhost` | `permissions.ask` rules in `.claude/settings.json` **and** the `PreToolUse` Claude Code hook `.claude/hooks/guard-bench.mjs` (`permissionDecision: "ask"`), which also catches spellings the rules miss (`bench --verbose --site x migrate`, `bench migrate` on the default site, `./env/bin/bench`, bench inside `su - frappe -c "..."`, `docker compose exec backend bench ...`) and fails closed to `ask` on unknown subcommands | The person at the terminal | Permission prompt answer and the hook's reason text (session transcript) |
| G3 | Risky git and network commands | `git commit`, `git push`, `gh pr create`, `curl`, `wget`, `WebFetch` | `permissions.ask` | The person at the terminal | Transcript |
| G4 | Local edit of AI config or site-wide Frappe behaviour | Edits of `.claude/**`, `.mcp.json`, `CLAUDE.md`, `spice_lite/hooks.py`, `spice_lite/patches.txt`, any `fixtures/**` | `permissions.ask`: `Edit(./.claude/**)`, `Edit(./.mcp.json)`, `Edit(./CLAUDE.md)`, `Edit(./sample-app/spice_lite/spice_lite/hooks.py)`, `Edit(./sample-app/spice_lite/spice_lite/patches.txt)`, `Edit(./sample-app/**/fixtures/**)` | The person at the terminal | Transcript |
| G5 | Outbound MCP write | Jira comment or transition, GitHub issue or review, any Frappe-site MCP tool that inserts, saves or calls a whitelisted method | `PreToolUse` hook `.claude/hooks/guard-outbound.mjs`: `"ask"` for write and unknown verbs, `"deny"` when the input carries a Frappe API token, a site_config value, another secret, or a non-synthetic MRN | The person at the terminal | Transcript; hook reason |
| G6 | Never allowed | `show-config`, DB shells (`mariadb`, `postgres`, `db-console`), `jupyter`, `drop-site`, `reinstall`, `restore`, `set-admin-password`, `set-password`, `add-system-manager`, `--site all`, any command naming `site_config.json`, `execute` of `frappe.get_site_config` or `generate_keys`, force-push, `gh pr merge`, GitHub MCP merge / push / file commits | `permissions.deny` (evaluated before ask and allow) plus `guard-bench.mjs` `"deny"` | Nobody: a human does it outside Claude Code | n/a |
| G7 | Merge of AI config | PR touching `.claude/**`, `.mcp.json`, `CLAUDE.md`, `skills/**`, `company-ai/**`, `agents/*/CONTRACT.md`, `scripts/governance/**`, the gate itself | `CODEOWNERS` (`docs/governance/CODEOWNERS.example`) + branch protection "Require review from Code Owners" + required check `ai-change-gate / require-human-approval` (`docs/governance/ai-change-gate.yml.example`), category `ai-config` | AI governance group | PR approval on the head commit |
| G8 | Merge of a schema change | PR touching `**/doctype/**` (DocType JSON and controllers), `patches.txt`, `patches/**`, `hooks.py`, `fixtures/**`, `modules.txt` | `CODEOWNERS` on those paths + the same required check, category `schema` (its own approver list, `SCHEMA_APPROVERS`) + CI green (`CI=1 bench --site test.localhost run-tests --app spice_lite`: without `CI` set, `bench run-tests` exits 0 even when tests fail, so a CI step that trusts the exit code is not a gate) | Platform schema owners (plus appsec when a DocType `permissions` array changes) | PR approval on the head commit |
| G9 | Migrate a shared site | `bench --site <staging or country site> migrate` | Not done by agents at all: CLAUDE.md rule 9, G2 on the developer machine, and the deploy pipeline's own environment approval | Release manager | Deploy log |
| G10 | Org floor | Always | Managed settings (`docs/governance/managed-settings.example.json`): `disableBypassPermissionsMode: "disable"`, org deny rules for site secrets, and the `guard-bench` and `guard-outbound` Claude Code hooks installed under `/etc/claude-code/hooks/` | Platform / security team | MDM or server-managed policy history |

## Why several layers

- G2 to G5 run on the developer's machine. They stop an agent in the moment, but a developer can answer "yes" too quickly and can edit project settings. That is why G4 exists, and why G7 and G8 make config and schema changes reviewable by someone else.
- G2 uses both a rule and a Claude Code hook. The rule is simple and visible in `/permissions`; the hook covers the spellings a prefix rule cannot. `node .claude/hooks/guard-bench.test.mjs` shows each spelling.
- G6 removes the most dangerous actions from the agent entirely. An injected instruction in a Jira ticket cannot talk its way past a deny rule.
- G8 exists because a Frappe schema change is not "just code": `bench migrate` re-imports a DocType JSON whenever its hash changes, runs every new `patches.txt` line once (keyed by the exact line text), and overwrites fixture records. A reviewer who knows Frappe must see those files. It also means checking what migrate actually did: on Postgres, `search_index: 1` did not create the indexes for `SL Patient.country` and `SL Encounter.patient` (D-6 in `sample-app/docs/KNOWN_DEFECTS.md`), so a schema reviewer verifies indexes on the migrated test site rather than trusting the JSON.
- G10 is the only layer a project cannot switch off.

## Permission modes and the gates

| Mode | G1 plan | G2 to G4 `ask` rules | G2/G5 hook `ask` | G6 `deny` |
|---|---|---|---|---|
| `default` | if entered | prompt | prompt | enforced |
| `plan` | yes: read-only until approved | prompt | prompt | enforced |
| `acceptEdits` | no | **still prompt**: file edits in working dirs are auto-accepted, but an explicit `ask` rule such as `Edit(./.claude/**)` or `Bash(bench --site * migrate)` is never auto-approved | prompt | enforced |
| `auto` | no | **still prompt** ("Explicit ask rules still force a prompt") | prompt; the classifier may deny but cannot approve silently (v2.1.211+) | enforced |
| `bypassPermissions` | no | **still prompt** (explicit ask rules are among the "actions no mode auto-approves") | unverified: do not rely on it; G10 `disableBypassPermissionsMode` is the control | deny rules still apply |
| `dontAsk` | no | **denied** instead of prompted | denied (inferred: dontAsk auto-denies everything that would prompt; unverified) | enforced |

Source: https://code.claude.com/docs/en/permission-modes ("Actions no mode auto-approves", the dontAsk and auto sections) and https://code.claude.com/docs/en/hooks (PreToolUse `permissionDecision`), checked 2026-09-30 by the R1 accuracy review. Consequence for headless runs: under `dontAsk`, a workflow step that reaches `bench migrate` stops there with a denial, which is the intended behaviour.

## Two bench details the gates depend on

- **Exit codes.** `bench run-tests` exits 0 even when tests fail unless the `CI` environment variable is set (`frappe/commands/utils.py`: `if os.environ.get("CI"): sys.exit(ret)`). Every gate that decides on the exit code (a CI job, a workflow step, a Stop Claude Code hook) must run `CI=1 bench --site test.localhost run-tests ...` and also read the final `OK` / `FAILED` line; a wrong `--test` name prints `Ran 0 tests` and `OK`, so check the count too. `permissions.allow` has both forms, and `guard-bench.mjs` treats `CI=1 bench ...` like `bench ...`.
- **`cd` into the bench.** Commands run from the bench directory, usually as `cd /home/user/frappe-bench && bench --site test.localhost run-tests ...`. Compound commands are checked per subcommand, so the `cd` part needs its own match or the whole command prompts. `Bash(cd /home/user/frappe-bench)` is allowed for that exact path only: `cd` changes no state, and the bench subcommand after it is still judged by its own rule and by `guard-bench.mjs`.

## Workspace trust and headless runs

- Settings-file Claude Code hooks (`block-secrets`, `guard-bench`, `guard-outbound`, `flag-injection`) and the `env` block run even in a `claude -p` session in a folder that was never trusted.
- `permissions.allow` from the project `.claude/settings.json` does **not** apply in a never-trusted folder (stderr warns "this workspace has not been trusted"). So `bench --site test.localhost run-tests` prompts (or is denied under `dontAsk`) until you open the folder interactively once and accept the trust dialog. `ask` and `deny` still protect you; only convenience is lost.
- Frontmatter hooks in a project agent (`.claude/agents/*.md`, for example the tool guard of module 05-agent-roster) run when the agent is spawned as a subagent **and** when it runs as the main session via `claude --agent <name>`, but only after the trust dialog for that exact folder was accepted. In a never-trusted `claude -p` run they are skipped. Trust the folder interactively before relying on them headlessly.

## Setting up G7 and G8 on GitHub

1. Copy `docs/governance/CODEOWNERS.example` to `.github/CODEOWNERS`; replace `@example-org/*` with real teams that have write access.
2. Copy `docs/governance/ai-change-gate.yml.example` to `.github/workflows/ai-change-gate.yml`. Set `AI_SDLC_DIR` to `.` if `AI-SDLC-frappe/` is the repository root.
3. Set repository variables `AI_GOVERNANCE_APPROVERS` and `SCHEMA_APPROVERS` (comma-separated logins). Leave one empty to accept any non-author human for that category.
4. Branch protection on `main`: require a PR, 1+ approval, require review from Code Owners, dismiss stale approvals, required status check `require-human-approval`.
5. Prove it: open a PR that adds a field to `sl_patient.json` and a line to `patches.txt`; the check fails with `[missing] Frappe schema / hooks.py / patches / fixtures`; approve as a schema owner; the `pull_request_review` event re-runs the check and it passes.
