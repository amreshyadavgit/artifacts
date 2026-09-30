# company-ai: the shared skill plugin (Frappe edition)

`company-ai` is how skills built in this repository reach other Frappe repositories, for example the real `spice_next_core` bench and its country and integration apps. It is a Claude Code **plugin**: a folder with a `.claude-plugin/plugin.json` manifest and components (`skills/`, `agents/`, ...) at the plugin root, never inside `.claude-plugin/`.

## What is in this folder (source)

```text
company-ai/
├── .claude-plugin/
│   └── plugin.json               # manifest: name, version, description, author, license, keywords
├── CHANGELOG.md                  # plugin release notes (semver)
├── README.md                     # this file (plugin-root README/CLAUDE.md are not loaded by Claude Code)
└── skills/
    └── skill-library-check/
        └── SKILL.md              # plugin-native skill: /company-ai:skill-library-check
```

Library skills are **not** copied here by hand. Their source of truth is `.claude/skills/<name>/` (runtime) plus `skills/<name>/` (README, CHANGELOG, golden cases). A build step assembles the installable plugin outside the source tree:

```bash
cd AI-SDLC-frappe
node scripts/governance/package-plugin.mjs --out /tmp/company-ai-build --version 0.1.0
claude plugin validate /tmp/company-ai-build
claude --plugin-dir /tmp/company-ai-build plugin details company-ai
```

Built layout:

```text
/tmp/company-ai-build/
├── .claude-plugin/plugin.json
├── skills/
│   ├── skill-library-check/SKILL.md
│   ├── code-review/{SKILL.md, ..., LIBRARY-README.md, LIBRARY-CHANGELOG.md}
│   └── ...                       # every skill with skills/<name>/CHANGELOG.md, or those passed with --skills
├── agents/                       # only with --agents (see rule 3)
└── scripts/validate-skill-library.mjs   # bundled so skill-library-check works in any repo
```

## How consumers see it

- Skills are namespaced: `/company-ai:code-review`, `/company-ai:skill-library-check`. They never collide with a repository's own `/code-review`.
- Agents are namespaced `company-ai:<agent>` (for example `@agent-company-ai:reviewer`), so they sit beside a project's own `reviewer` instead of replacing it.
- Try it without installing: `claude --plugin-dir /tmp/company-ai-build`. Distribute it through a plugin marketplace (`/plugin`).

## Governance rules for the plugin

1. **Only released skills ship.** A skill is released when `skills/<name>/CHANGELOG.md` has a semver heading and `node scripts/governance/validate-skill-library.mjs` reports no errors for it.
2. **Plugin version = highest-impact change inside it.** Any skill MAJOR bump makes a plugin MAJOR bump; new skills are MINOR; fixes are PATCH. Record it in `company-ai/CHANGELOG.md`.
3. **Agents ship only with care.** Plugin agents ignore `permissionMode`, `hooks` and `mcpServers`. The roster agents rely on frontmatter Claude Code hooks (the tool guard of module 05-agent-roster: write scope and the bench/Bash allow-list) and on `permissionMode`. Shipped in a plugin they lose those controls, so `package-plugin.mjs` warns, and the consumer must re-impose the limits in its own `.claude/settings.json`: copy `guard-bench.mjs` and the bench `ask`/`deny` rules at least.
4. **Paths must be plugin-relative.** A skill that says `node .claude/skills/run-tests/scripts/...` works in this repo and breaks in a plugin: use `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_ROOT}`. The packager warns on project-relative paths and on skills that name this repo's app layout (`sample-app/...`), because a consumer bench has its own apps and site names.
5. **Bench specifics come from the consumer.** A packaged skill must not hard-code `test.localhost` or `/home/user/frappe-bench`; it reads the bench path and test site from the consumer's `CLAUDE.md` / `CLAUDE.local.md`.
6. **Changes go through the AI change gate.** `company-ai/**` is owned by the AI governance group in `docs/governance/CODEOWNERS.example`.
