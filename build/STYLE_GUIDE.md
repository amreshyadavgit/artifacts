# STYLE GUIDE — AI-SDLC: Agent & Skill Engineering with Claude Code

Every writer and reviewer follows this file. `build/CLAUDE_CODE_FACTS.md` overrides this guide on any Claude Code format question.

## 1. Audience and tone

- Reader: a **senior backend engineer** (Java 21 / Spring Boot / PostgreSQL / Kubernetes) in **healthcare**, working with **FHIR-style APIs**, new to Claude Code agents.
- Tone: direct, technical, peer-to-peer. No hype, no "revolutionary", no emoji. Short sentences. Assume they know Git, CI, code review, REST, SQL, JUnit, Docker, k8s.
- Explain *why* before *how*. Every concept ends with a concrete consequence ("so in practice you…").
- Prefer one precise example over three vague ones. Always use the sample app (`AI-SDLC/sample-app/`, the FHIR-lite Patient/Observation API) as the example subject.

## 2. Depth rules

- Content depth beats UI polish. A module is judged by its exercises and the real files it adds to `AI-SDLC/`.
- `concepts[].body_md`: 150–500 words each, Markdown. Use lists, short code spans, and bold for key terms. No H1/H2 inside body_md (the SPA renders the heading); H3/H4 are fine.
- Each module: 3–7 concepts, 1–3 mermaid diagrams, at least 1 comparison table when a comparison exists, 2–4 exercises, a checklist of 6–12 verifiable items.
- Exercises are **hands-on**: the learner creates or edits real files, runs a real command, and checks a real output. Every one of the nine exercise fields is concrete. No "TBD", "TODO", "...", "lorem", "your-thing-here" (angle-bracket placeholders are allowed only inside a *template file* whose whole purpose is to be filled in, and must then be named e.g. `CONTRACT_TEMPLATE.md`).
- `exampleInput` = the exact prompt / command / file the learner feeds in. `expectedOutput` = a realistic, specific output excerpt (e.g. an actual finding list against the sample app), not a description of output.
- `testCases`: at least 3 per exercise, each with a concrete input and an observable expected result (a file exists, a grep matches, a finding is present, a command exits 0, a hook blocks with exit code 2, etc.).

## 3. Accuracy and tagging

- Never invent Claude Code config keys, frontmatter fields, CLI flags, hook events, or permission modes. Only use what is in `build/CLAUDE_CODE_FACTS.md`.
- Every `implementation[]` entry has `tag`:
  - `"verified-format"` — the file's *format* matches the docs exactly (subagent file, SKILL.md, settings.json, .mcp.json, CLAUDE.md, a `claude -p` invocation using documented flags). Content can be ours; the structure must be real.
  - `"illustrative"` — a pattern or convention of this course (Agent Contract markdown, workflow spec, eval dataset JSON, a Node script, a Java class, ADR template). Anything that is not a Claude Code config file is illustrative unless it is plain runnable code whose correctness we tested (then still tag it illustrative — the tag is about Claude Code format claims).
- When prose describes a behaviour you cannot confirm in FACTS, say so inline: *"(pattern, not a built-in feature)"*.
- Subagent nesting: follow FACTS exactly. Orchestration lessons must be built on the real answer (see FACTS §Subagents).

## 4. Canonical terminology (use exactly these words)

| Term | Meaning | Do not say |
|---|---|---|
| **agent** / **subagent** | A Claude Code subagent defined in `.claude/agents/<name>.md` | "bot", "AI worker" |
| **main session** | The top-level Claude Code conversation the human is typing into | "master agent", "parent AI" |
| **orchestrator** | The role that sequences agents. Implemented in the *main session* (via a skill / slash command, or the main session running with the orchestrator agent definition) — see FACTS | "manager bot" |
| **skill** | `.claude/skills/<name>/SKILL.md` + supporting files | "plugin" (unless literally a plugin) |
| **slash command** | A user-invoked `/name` entry point (skill or `.claude/commands/*.md`, per FACTS) | "macro" |
| **hook** | A deterministic command configured in `settings.json` that runs on a hook event | "trigger" |
| **MCP server** | An external tool provider configured in `.mcp.json` | "connector" (except when quoting a product) |
| **workflow** | A documented, ordered composition of agents + skills + gates, stored in `AI-SDLC/workflows/` | "pipeline" (ok for CI only) |
| **Agent Contract** | The course's spec for an agent: purpose, inputs, outputs, tools, permissions, must, mustNot, failureConditions, validation, handoffFormat, humanGate | "persona" |
| **handoff** | The structured artifact one agent produces for the next (a file under `.ai-sdlc/runs/<run-id>/`) | "message passing" |
| **human gate** | A point where a human must approve before work continues, implemented with a real mechanism (plan mode, permission `ask`, PR approval, a hook) | "checkpoint" alone |
| **golden task** | An eval case with fixed input and expected findings | "benchmark" |
| **finding** | One structured review result: `id, severity, category, location, evidence, recommendation` | "issue" (ambiguous with Jira) |

Severity scale everywhere: `critical | high | medium | low | info`.

## 5. Canonical agent roster (use everywhere, no others)

| Agent | One-line purpose | Default tools | Writes code? |
|---|---|---|---|
| `architect` | Analyses requirements against existing architecture; produces trade-offs, risks, and an ADR | Read, Grep, Glob, (WebFetch optional) | No — writes only ADR/docs under `AI-SDLC/docs/adr/` or the run folder |
| `developer` | Implements an approved plan in the sample app with tests | Read, Grep, Glob, Edit, Write, Bash (scoped) | Yes |
| `reviewer` | Reviews a diff for correctness, design, readability, and standards; produces findings | Read, Grep, Glob, Bash (`git diff` only) | No |
| `tester` | Designs the test strategy and writes/runs tests | Read, Grep, Glob, Edit, Write, Bash (`mvn test`) | Tests only |
| `security` | Security review (authN/Z, input validation, secrets, PII/PHI, injection, deps, logging) | Read, Grep, Glob | No |
| `sre` | Production RCA, performance, deployability, observability, k8s manifests | Read, Grep, Glob, Bash (read-only kubectl/log commands) | No (proposes patches) |
| `orchestrator` | Sequences the others, enforces gates, assembles the run report | Delegation (per FACTS), Read, Write (run folder only) | No |

Agent file names: `AI-SDLC/.claude/agents/<agent>.md` using exactly these names.

## 6. Repository layout (single source of truth)

The Claude Code project root is `AI-SDLC/`. Paths in content are written relative to the repo root starting with `AI-SDLC/`.

```
AI-SDLC/
├── CLAUDE.md                         # project memory (verified-format)
├── .claude/
│   ├── settings.json                 # permissions + hooks (verified-format)
│   ├── agents/<agent>.md             # runtime subagent definitions (verified-format)
│   ├── skills/<skill>/SKILL.md       # runtime skills (+ supporting files) (verified-format)
│   ├── commands/<cmd>.md             # only if FACTS says commands are still the right form
│   └── hooks/*.sh|*.mjs              # hook scripts referenced from settings.json
├── .mcp.json                         # MCP servers (verified-format)
├── agents/<agent>/CONTRACT.md        # Agent Contract (illustrative), one per roster agent
├── agents/CONTRACT_TEMPLATE.md       # reusable template
├── skills/<skill>/README.md          # skill as engineering asset: owner, version, CHANGELOG, tests
├── skills/<skill>/CHANGELOG.md
├── skills/<skill>/tests/*.json       # skill golden cases
├── workflows/<workflow>.md           # feature-delivery, bug-fix, incident-response specs
├── context/architecture/*.md         # architecture overview, C4, ADR index
├── context/standards/*.md            # coding, testing, API, review standards
├── context/security/*.md             # threat model, PHI handling, secrets policy
├── context/domain/*.md               # FHIR-lite glossary, Patient/Observation rules
├── evaluations/                      # datasets, harness, rubrics, reports
├── docs/                             # ADRs, runbooks, guides
└── sample-app/                       # Java 21 Spring Boot FHIR-lite API (real, tested)
```

Run artifacts (handoffs) go to `AI-SDLC/.ai-sdlc/runs/<run-id>/NN-<agent>.md` (or `NN-<skill>.md` for a step the orchestrator runs itself with a skill; see `AI-SDLC/workflows/README.md`) (git-ignored).

**File ownership (prevents collisions between parallel writers):** each writer only creates files listed in its brief. If you need a file owned by another writer, reference it by path; do not write it. Shared files (`CLAUDE.md`, `.claude/settings.json`, `.mcp.json`) are owned by the orchestrator (Phase 0) and specific writers named in their briefs; others may *reference* them and propose additions in their module text.

## 7. Handoff format (canonical)

Every agent ends its work with a Markdown handoff file with YAML front matter:

```markdown
---
run_id: 2026-09-30-feat-observation-search
step: 03
agent: architect
status: complete        # complete | blocked | needs-human
inputs: [01-requirements.md]
next: developer
---
## Summary
## Findings            # table: id | severity | category | location | evidence | recommendation
## Decisions
## Open questions
## Artifacts           # paths written
```

## 8. Code sample conventions

- Java: Java 21, Spring Boot 3, package `org.example.fhir`. Matches `sample-app`.
- Scripts: Node 22 ESM (`.mjs`) with zero dependencies, or POSIX `bash` with `set -euo pipefail`. `jq` may be assumed for hook scripts, but prefer Node when parsing JSON is non-trivial.
- JSON in content strings must be valid JSON when it claims to be JSON.
- `implementation[].content` must be byte-identical to the file you wrote into `AI-SDLC/` at `implementation[].path`.
- `implementation[].path` and `startingFiles[].path` start with `AI-SDLC/`.
- Mermaid: `flowchart`, `sequenceDiagram`, `stateDiagram-v2` only. Quote labels containing punctuation: `A["POST /fhir/Patient"]`. No HTML in labels. No ASCII-art diagrams anywhere.

## 9. Domain facts (FHIR-lite)

- Resources: `Patient` (identifier MRN, name family/given, gender, birthDate, active) and `Observation` (status, code LOINC, subject `Patient/{id}`, effectiveDateTime, valueQuantity).
- Errors are FHIR `OperationOutcome`.
- PHI = anything identifying a patient. PHI must never appear in logs, prompts sent to external tools, eval datasets, or commit messages. Use synthetic data only (e.g. MRN `MRN-000123`, patient "Test Patient").
- The sample app contains exactly one planted teaching defect (`perf-n+1`) and four real, discovered defects D-01..D-04, all listed in `AI-SDLC/sample-app/docs/KNOWN_DEFECTS.md`. Any other defect used in an exercise must be introduced by the exercise itself via a starting file or patch, and clearly labelled.
