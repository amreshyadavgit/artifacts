# Skill library: index and policy (Frappe edition)

Skills are engineering assets. Each one has an owner, a version, a changelog, golden test cases and documentation, exactly like a shared Frappe app. This file is the index of the library and the policy every skill follows. It is checked by:

```bash
cd AI-SDLC-frappe
node scripts/governance/validate-skill-library.mjs          # report; exit 1 on errors
node scripts/governance/validate-skill-library.mjs --strict # CI: warnings fail too
```

## Layout

```text
AI-SDLC-frappe/
├── .claude/skills/<name>/          # RUNTIME: what Claude Code loads
│   ├── SKILL.md                    #   front matter (name, description, ...) + instructions, < 500 lines
│   ├── *.md                        #   supporting reference files, loaded when SKILL.md links them
│   └── scripts/                    #   executed, not loaded (for example a bench run-tests output parser)
├── skills/<name>/                  # ASSET: what engineers maintain
│   ├── README.md                   #   Owner, Version, purpose, inputs, outputs, consumers, how to test
│   ├── CHANGELOG.md                #   "## [x.y.z] - YYYY-MM-DD" entries, newest first
│   └── tests/cases.json            #   >= 3 golden cases (fixed input, expected findings)
└── company-ai/                     # PACKAGING: the plugin other repos install (see company-ai/README.md)
```

The runtime/asset split and the reason for it are taught in module 03-skills-architecture-code-test. This file is the governance side: who owns what, how versions move, and what the validator enforces.

## Index

| Skill | Purpose | Owner | Preloaded by | Invoked from | Library entry |
|---|---|---|---|---|---|
| `explain-endpoint` | Explain one whitelisted method end to end: `/api/method/...` route, `@frappe.whitelist`, controller and `doc_events`, permission check, SQL | @example-org/spice-core | none | `/explain-endpoint` | `skills/explain-endpoint/` |
| `run-tests` | Run `bench --site test.localhost run-tests` and summarise failures | @example-org/spice-core | developer, tester | `/run-tests` | `skills/run-tests/` |
| `architecture-review` | Core change vs country app vs integration app; `doc_events` vs controller; sync vs `frappe.enqueue`; ADR | @example-org/architecture | architect | `/feature` workflow | `skills/architecture-review/` |
| `code-review` | Diff review against Frappe standards (`get_list` vs `get_all`, `ignore_permissions`, SQL params, whitelist rules, patches, fixtures) | @example-org/spice-core | reviewer | `/code-review` (replaces the bundled one here) | `skills/code-review/` |
| `test-strategy` | Test plan mapped to `FrappeTestCase`, `run-tests` flags, test records, `frappe.set_user`, pure mapper tests | @example-org/qa | tester | `/feature`, `/bug-fix` | `skills/test-strategy/` |
| `security-review` | Whitelist and `allow_guest`, permission hooks, `ignore_permissions`, SQL injection, site_config secrets, API keys, PHI in Error Log | @example-org/appsec | security | `/security-review` (replaces the bundled one here) | `skills/security-review/` |
| `performance-review` | N+1 (the real one in `lastn`), `search_index`, `frappe.cache`, report queries, queue timeouts | @example-org/sre | sre | `/incident`, `/feature` | `skills/performance-review/` |
| `production-rca` | RCA from gunicorn/worker logs, RQ backlog, `RQ Job`/`Error Log` excerpts, Postgres slow log | @example-org/sre | sre | `/incident` | `skills/production-rca/` |
| `ticket-intake` | Jira ticket to a PHI-free requirements handoff, ticket text quoted as untrusted | @example-org/spice-core | none | `/ticket-intake` | `skills/ticket-intake/` |
| `feature` | Feature-delivery workflow entry point (DocType JSON + controller + patch + tests + fixtures) | @example-org/ai-governance | none | `/feature` | `skills/feature/` |
| `bug-fix` | Bug-fix workflow entry point | @example-org/ai-governance | none | `/bug-fix` | `skills/bug-fix/` |
| `incident` | Incident-response workflow entry point | @example-org/ai-governance | none | `/incident` | `skills/incident/` |
| `requirements` | Requirements handoff from a request | @example-org/ai-governance | none | `/requirements` | `skills/requirements/` |
| `implementation-plan` | Implementation plan for the developer agent | @example-org/ai-governance | none | `/implementation-plan` | `skills/implementation-plan/` |
| `skill-library-check` | Run this policy's validator | @example-org/ai-governance | none | `/company-ai:skill-library-check` | plugin-native (`company-ai/skills/`) |

Current versions come from each `CHANGELOG.md`; the validator prints them. They are not repeated here so this index never goes stale. A runtime skill without a `skills/<name>/` entry is reported as a warning (and fails `--strict`) until its library folder exists.

## Policy

### 1. Ownership
- Every library skill names one **Owner** (a team handle) in its README. The owner reviews every change, keeps the golden cases passing and answers consumers.
- `skills/**`, `.claude/skills/**` and `company-ai/**` are code-owned by the AI governance group plus the skill owner (`docs/governance/CODEOWNERS.example`). The `ai-change-gate` check requires a non-author human approval on the head commit.

### 2. Semantic versioning for skills

The contract of a skill is its **output** (finding format, handoff fields, verdict line) and its **invocation** (name, arguments). Version against that contract:

| Bump | When | Example in this repo |
|---|---|---|
| MAJOR | A consumer (agent, workflow, eval, CI parser) breaks without changes | rename `code-review` to `review`; change the finding fields; change the `run-tests` summary line that the tester parses; remove an argument |
| MINOR | New capability, backwards compatible | `code-review` gains a check for `frappe.get_all` in whitelisted methods; `run-tests` accepts an optional `--module`; a new supporting file |
| PATCH | Behaviour fix without contract change | fewer false positives on `ignore_permissions=True` inside a patch module (where it is expected); clearer wording |

Changing `model`, `effort`, `allowed-tools` or `context: fork` is at least MINOR: it changes cost and what the skill may do. Widening `allowed-tools` to a new `bench` subcommand (for example `Bash(bench --site * migrate)`) is a governance change: it needs the AI governance group, not only the owner. Removing a tool the skill needs is MAJOR.

### 3. CHANGELOG
- Keep a Changelog style, newest first, one `## [x.y.z] - YYYY-MM-DD` heading per release, sections `Added`, `Changed`, `Fixed`, `Removed`.
- An optional `## [Unreleased]` section may sit on top. The README `Version` must equal the newest released heading.
- Every entry says what a consumer must do, if anything ("reviewer agent: no change needed").

### 4. Testing
- `skills/<name>/tests/cases.json` holds at least 3 golden cases: a fixed input (a patch against `spice_lite`, a file path, a ticket JSON, a saved `bench run-tests` output) and the expected findings or output.
- Golden cases run through the eval harness (module 09-agent-evaluation). A MINOR or MAJOR release needs a green eval run attached to the PR; a PATCH needs the cases that cover the fix.
- Scripts inside a skill (`.claude/skills/<name>/scripts/*`) have their own tests, run in CI.

### 5. Documentation (README fields)
`Owner`, `Version`, purpose (one paragraph), inputs and arguments, output contract (link to the output-format file), consumers (agents that preload it, workflows that invoke it), bench assumptions (site, bench path, which `bench` subcommands it runs), cost notes (model, effort, typical tokens), how to run the golden cases, known limitations.

### 6. SKILL.md rules
- Front matter must have `name` (kebab-case, equal to the folder) and `description` (what it does and when to use it, under 1,536 characters together with `when_to_use`).
- Only documented skill keys; they are hyphenated (`allowed-tools`, `disallowed-tools`, `argument-hint`, `disable-model-invocation`, `user-invocable`) plus `when_to_use`. Unknown keys are silently ignored by Claude Code, so the validator reports them.
- `allowed-tools` pre-approves tools; it does not restrict them. Use `disallowed-tools` to remove tools (for example `Edit Write` in review skills). Never pre-approve `bench ... console`, `execute` or `migrate` in `allowed-tools`: those stay behind the human gate (`docs/governance/approval-gates.md`, G2).
- Paths to the skill's own files use `${CLAUDE_SKILL_DIR}` so the skill still works when packaged in a plugin.
- Portability: claude.ai uploads and the Skills API accept only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. The validator's `portable` column shows which skills qualify.

### 7. Reuse and promotion
1. A skill starts in one repository as a project skill (`.claude/skills/<name>/`).
2. When a second team (another country app, `spice_next_core`) wants it, add `skills/<name>/` (README, CHANGELOG `1.0.0`, golden cases) and remove repository-specific paths, site names and bench paths.
3. Package it: `node scripts/governance/package-plugin.mjs --out <dir>`, then `claude plugin validate <dir>`.
4. Consumers install `company-ai` and call `/company-ai:<name>`. They pin a plugin version; upgrades follow the plugin CHANGELOG.
5. Do not fork a library skill silently. Propose the change to the owner, or create a differently named project skill.

### 8. Deprecation
Mark the skill deprecated in its README and in the first line of its `description`, ship a MINOR release that points to the replacement, and remove it in the next MAJOR release of the plugin.
