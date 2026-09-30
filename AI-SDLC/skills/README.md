# Skill library: index and policy

Skills are engineering assets. Each one has an owner, a version, a changelog, golden test cases and documentation, exactly like a shared Java library. This file is the index of the library and the policy every skill follows. It is checked by:

```bash
cd AI-SDLC
node scripts/governance/validate-skill-library.mjs          # report; exit 1 on errors
node scripts/governance/validate-skill-library.mjs --strict # CI: warnings fail too
```

## Layout

```text
AI-SDLC/
├── .claude/skills/<name>/          # RUNTIME: what Claude Code loads
│   ├── SKILL.md                    #   front matter (name, description, ...) + instructions, < 500 lines
│   ├── *.md                        #   supporting reference files, loaded when SKILL.md links them
│   └── scripts/                    #   executed, not loaded
├── skills/<name>/                  # ASSET: what engineers maintain
│   ├── README.md                   #   Owner, Version, purpose, inputs, outputs, consumers, how to test
│   ├── CHANGELOG.md                #   "## [x.y.z] - YYYY-MM-DD" entries, newest first
│   └── tests/cases.json            #   >= 3 golden cases (fixed input, expected findings)
└── company-ai/                     # PACKAGING: the plugin other repos install (see company-ai/README.md)
```

Why two folders: `.claude/skills/<name>/` is loaded into context, so everything in it costs tokens and can steer the model. Ownership metadata, release notes and test fixtures do not belong there. They live in `skills/<name>/`, which Claude Code never loads on its own.

## Index

| Skill | Purpose | Owner | Preloaded by | Invoked from | Library entry |
|---|---|---|---|---|---|
| `explain-endpoint` | Explain one endpoint end to end with file:line citations | @example-org/fhir-platform | none | `/explain-endpoint` | runtime only |
| `run-tests` | Run `mvn -q -B test` and summarise failures | @example-org/fhir-platform | developer, tester | `/run-tests` | runtime only |
| `architecture-review` | Requirement vs architecture: options, trade-offs, risks, ADR | @example-org/architecture | architect | `/feature` workflow | `skills/architecture-review/` |
| `code-review` | Diff review against `context/standards/` with canonical findings | @example-org/fhir-platform | reviewer | `/code-review` (replaces the bundled one here) | `skills/code-review/` |
| `test-strategy` | Test plan and missing-test analysis for a change | @example-org/qa | tester | `/feature`, `/bug-fix` | `skills/test-strategy/` |
| `security-review` | AuthN/Z, PHI, secrets, injection, dependencies, logging | @example-org/appsec | security | `/security-review` (replaces the bundled one here) | `skills/security-review/` |
| `performance-review` | N+1, unbounded queries, pagination, resource limits | @example-org/sre | sre | `/incident`, `/feature` | `skills/performance-review/` |
| `production-rca` | Root-cause analysis from logs, metrics and code | @example-org/sre | sre | `/incident` | `skills/production-rca/` |
| `ticket-intake` | Jira ticket to a PHI-free requirements handoff | @example-org/fhir-platform | none | `/ticket-intake` | runtime only |
| `feature` | Feature-delivery workflow entry point | @example-org/ai-governance | none | `/feature` | runtime only |
| `bug-fix` | Bug-fix workflow entry point | @example-org/ai-governance | none | `/bug-fix` | runtime only |
| `incident` | Incident-response workflow entry point | @example-org/ai-governance | none | `/incident` | runtime only |
| `requirements` | Requirements handoff from a request | @example-org/ai-governance | none | `/requirements` | runtime only |
| `implementation-plan` | Implementation plan for the developer agent | @example-org/ai-governance | none | `/implementation-plan` | runtime only |
| `skill-library-check` | Run this policy's validator | @example-org/ai-governance | none | `/company-ai:skill-library-check` | plugin-native (`company-ai/skills/`) |

Current versions come from each `CHANGELOG.md`; the validator prints them. They are not repeated here so this index never goes stale. "runtime only" skills get a library entry before they are promoted into the `company-ai` plugin; the validator lists them as warnings.

## Policy

### 1. Ownership
- Every library skill names one **Owner** (a team handle) in its README. The owner reviews every change, keeps the golden cases passing and answers questions from consumers.
- `skills/**`, `.claude/skills/**` and `company-ai/**` are code-owned by the AI governance group plus the skill owner (`docs/governance/CODEOWNERS.example`). The `ai-change-gate` check requires a human approval on the head commit.

### 2. Semantic versioning for skills

The contract of a skill is its **output** (finding format, handoff fields, verdict line) and its **invocation** (name, arguments). Version against that contract:

| Bump | When | Example |
|---|---|---|
| MAJOR | A consumer (agent, workflow, eval, CI parser) breaks without changes | rename `code-review` to `review`; change the finding fields; remove an argument; change the verdict line format |
| MINOR | New capability, backwards compatible | a new check (flag missing 403 tests); a new optional argument; a new supporting file |
| PATCH | Behaviour fix without contract change | fewer false positives on `@PreAuthorize`; clearer wording; typo in the checklist |

Changing `model`, `effort`, `allowed-tools` or `context: fork` is at least MINOR: it changes cost and what the skill may do. Removing a tool from `allowed-tools` that the skill needs is MAJOR.

### 3. CHANGELOG
- [Keep a Changelog](https://keepachangelog.com/) style, newest first, one `## [x.y.z] - YYYY-MM-DD` heading per release, sections `Added`, `Changed`, `Fixed`, `Removed`.
- An optional `## [Unreleased]` section may sit on top. The README `Version` must equal the newest released heading.
- Every entry says what a consumer must do, if anything ("reviewer agent: no change needed").

### 4. Testing
- `skills/<name>/tests/cases.json` holds at least 3 golden cases: a fixed input (a patch under `tests/patches/`, a file path, a ticket JSON) and the expected findings or output.
- Golden cases run through the eval harness (module 09-agent-evaluation). A MINOR or MAJOR release needs a green eval run attached to the PR; a PATCH needs the cases that cover the fix.
- Scripts inside a skill (`.claude/skills/<name>/scripts/*.mjs`) have their own `*.test.mjs`, run in CI.

### 5. Documentation (README fields)
`Owner`, `Version`, purpose (one paragraph), inputs and arguments, output contract (link to the output-format file), consumers (agents that preload it, workflows that invoke it), cost notes (model, effort, typical tokens), how to run the golden cases, known limitations.

### 6. SKILL.md rules
- Front matter must have `name` (kebab-case, equal to the folder) and `description` (what it does and when to use it, under 1,536 characters together with `when_to_use`).
- Only documented skill keys; they are hyphenated (`allowed-tools`, `disallowed-tools`, `argument-hint`, `disable-model-invocation`, `user-invocable`) plus `when_to_use`. Unknown keys are silently ignored by Claude Code, so the validator reports them.
- `allowed-tools` pre-approves tools; it does not restrict them. Use `disallowed-tools` to remove tools (for example `Edit Write` in review skills).
- Paths to the skill's own files use `${CLAUDE_SKILL_DIR}` so the skill still works when packaged in a plugin.
- Portability: claude.ai uploads and the Skills API accept only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. The validator's `portable` column shows which skills qualify.

### 7. Reuse and promotion
1. A skill starts in one repository as a project skill (`.claude/skills/<name>/`).
2. When a second team wants it, add `skills/<name>/` (README, CHANGELOG `1.0.0`, golden cases) and remove repository-specific paths.
3. Package it: `node scripts/governance/package-plugin.mjs --out <dir>`, then `claude plugin validate <dir>`.
4. Consumers install `company-ai` and call `/company-ai:<name>`. They pin a plugin version; upgrades follow the plugin CHANGELOG.
5. Do not fork a library skill silently. Propose the change to the owner, or create a differently named project skill.

### 8. Deprecation
Mark the skill deprecated in its README and in the first line of its `description`, ship a MINOR release that points to the replacement, and remove it in the next MAJOR release of the plugin.
