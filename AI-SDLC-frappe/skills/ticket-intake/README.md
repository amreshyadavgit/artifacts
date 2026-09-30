# Skill asset: ticket-intake (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/ticket-intake/` (`SKILL.md`, `HANDOFF_TEMPLATE.md`, `fixtures/SPICE-231.synthetic.json`, `examples/00-ticket-intake.SPICE-231.md`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/spice-core |
| Consumers | Humans via `/ticket-intake SPICE-231` before `/feature` or `/bug-fix`; the `requirements` skill reads its output (`00-ticket-intake.md`) as step 01 input |
| Invocation | `/ticket-intake SPICE-231` (atlassian MCP server) or `/ticket-intake --file .claude/skills/ticket-intake/fixtures/SPICE-231.synthetic.json` (offline) |
| Writes files | One file, `.ai-sdlc/runs/<run-id>/00-ticket-intake.md`. Never writes to Jira, GitHub or a Frappe site: the write tools and all `spice-site` tools are in `disallowed-tools` |
| Taught in | module `06-mcp-and-tooling-architecture` |
| Golden cases | [tests/cases.json](tests/cases.json): 4 deterministic, 2 live |

## Purpose
Turns one Jira ticket into a PHI-free requirements handoff for the architect, mapped onto the whitelisted methods, DocTypes and patches of `spice_lite`. Ticket text is treated as untrusted data: injection attempts are recorded as `prompt-injection` findings with a neutral description, never quoted or followed. PHI is replaced with `[REDACTED-*]` tokens and the result must pass `scripts/automation/scan-phi.mjs` before the skill reports completion.

## Inputs and arguments
`$ARGUMENTS`: a Jira key or `--file <ticket.json>` with the same `key` / `fields` shape as `getJiraIssue`.

## Output contract
`00-ticket-intake.md` in the handoff format of `workflows/README.md` (front matter `run_id`, `step: 00`, `agent: orchestrator`, `status`, `inputs`, `next: architect`), built from `HANDOFF_TEMPLATE.md`: Summary, Requirements, Acceptance criteria (each with a method call, HTTP status, response shape and a `FrappeTestCase` name), Frappe impact, Findings, Decisions, Open questions, Artifacts.

## Bench assumptions
None. The skill reads code with Grep/Glob and never calls the site; the only command it runs is the PHI scanner.

## Cost notes
Default model; one `getJiraIssue` call plus about 10 Grep/Read calls.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# ti-01-fixture-is-phi-shaped: The synthetic ticket contains the five PHI kinds the redaction step must remove
node scripts/automation/scan-phi.mjs .claude/skills/ticket-intake/fixtures/SPICE-231.synthetic.json; echo "exit=$?"
# ti-02-example-handoff-is-clean: The reference handoff passes the PHI scan
node scripts/automation/scan-phi.mjs .claude/skills/ticket-intake/examples/00-ticket-intake.SPICE-231.md; echo "exit=$?"
# ti-03-injection-recorded-not-quoted: The reference handoff records the two injections and quotes neither payload nor patient
E=.claude/skills/ticket-intake/examples/00-ticket-intake.SPICE-231.md; grep -c 'prompt-injection' $E; grep -ciE 'ignore previous|bench --site [a-z.]+ console|site_config.json' $E; grep -cE 'Wanjiru|Kamau|20417733|23456789' $E
# ti-04-write-tools-removed: Jira, GitHub and spice-site tools that write or read the live site are disallowed
sed -n '/^disallowed-tools:/,/^---/p' .claude/skills/ticket-intake/SKILL.md | grep -cE 'mcp__(atlassian|github|spice-site)__'
```

## Known limitations
- `scan-phi.mjs` finds identifiers with a fixed shape; a bare patient name without a label is redacted only by instruction.
- Without the atlassian MCP server the skill works only in `--file` mode.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
