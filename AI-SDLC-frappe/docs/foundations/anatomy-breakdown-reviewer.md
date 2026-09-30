# Anatomy breakdown: the one-off review prompt (Frappe edition)

Reference answer for exercise `01-anatomy-breakdown` (module 01-foundations).
Source prompt: `docs/foundations/one-off-review-prompt.md`.

Each row takes one anatomy element, quotes what the prompt says about it, names the gap, and says
where that element lives once the prompt becomes the `reviewer` agent. The last column starts with
**Mechanism:** when Claude Code enforces or loads it, or **Convention:** when it is a course rule that
only a human, a script or an eval checks.

| # | element | what the prompt says | gap or risk | where it lives in Claude Code |
|---|---|---|---|---|
| 1 | responsibilities | "tell me what's wrong", "Fix anything obvious", "run migrate" | Three jobs in one: reviewing, editing and changing a site's schema. An agent that fixes what it reviews cannot give an independent opinion. | Mechanism: the `description` frontmatter field decides when the main session delegates to `reviewer`; the body states the single job. |
| 2 | boundaries | nothing | No statement of what is out of scope: deep security analysis, performance profiling, approving, touching the site. | Mechanism: `tools` allowlist and `disallowedTools`; Convention: the contract `mustNot` list for boundaries no tool setting can express (no LGTM, no PHI in evidence). |
| 3 | inputs | "my latest changes to the FHIR API and the Patient DocType" | Which base ref? Staged or committed? A subagent has no conversation history, so "latest" means nothing to it. | Mechanism: the Agent tool `prompt` (task message) is the only runtime input besides CLAUDE.md, git status and preloaded skills; Convention: the contract names the required fields (base ref, run id). |
| 4 | outputs | "tell me", "be thorough but concise" | No format, so findings cannot be counted, compared between runs, or checked by a script. | Mechanism: the subagent's final message is what returns to the main session; Convention: the six-field finding table from `context/standards/review-standards.md` and the handoff file. |
| 5 | tools | "open bench console on the site" | Asks for the most dangerous tool on a bench: `bench console` is an IPython shell with full database access, and in the main session every other tool, including Edit and Write, is available too. | Mechanism: `tools: Read, Grep, Glob, Bash` in `.claude/agents/reviewer.md`; omitting `Agent` also stops it delegating; `Bash(bench --site * console)` is an `ask` rule in `.claude/settings.json`. |
| 6 | context | "Use our standards" | Which standards? The model will invent generic Django or Python advice, and it will not look at `patches.txt` or the `permissions` array unless told they matter. | Mechanism: the CLAUDE.md hierarchy loads automatically, `.claude/rules/doctype-json.md` loads when DocType JSON is read, and `skills: [code-review]` preloads the review procedure; Convention: the body names `context/standards/frappe-coding-standards.md` and `review-standards.md` to Read. |
| 7 | instructions | "You are a senior Frappe developer" | A persona, not a procedure. No steps, no order, no definition of done. | Mechanism: the agent file body becomes the subagent's system prompt (it does not get the Claude Code system prompt). |
| 8 | memory/state | nothing | Nothing carries over between reviews, which is fine; but the prompt also relies on "my latest changes" living in chat history. | Mechanism: optional `memory: project` gives `.claude/agent-memory/reviewer/MEMORY.md`; Convention: run state lives in handoff files under `.ai-sdlc/runs/<run-id>/`. |
| 9 | permissions | "Fix anything obvious", "run migrate if the DocType changed" | Grants write authority and site authority implicitly. In `acceptEdits` mode the edits land without a prompt; `migrate` on a shared site changes the schema for everyone on it. | Mechanism: `permissionMode` in frontmatter plus project `permissions` allow/ask/deny in `.claude/settings.json` (`migrate`, `console`, `execute` are `ask`; `drop-site` is denied); the Claude Code hook `block-secrets.mjs` still runs inside subagents. |
| 10 | verification | nothing | No way to tell a good review from a plausible one. | Convention: golden tasks in `evaluations/` (module 09) and `validate-contract.mjs` for the contract; Mechanism: a `SubagentStop` Claude Code hook can reject output that lacks the required structure (module 08). |
| 11 | failure handling | "If everything looks fine, reply LGTM" | The only exit is success. No instruction for an empty diff, a huge regenerated DocType JSON, a missing standard, or an edited line in `patches.txt`, so the model guesses. | Mechanism: `maxTurns` caps the loop and marks the output partial; Convention: `status: blocked` or `needs-human` in the handoff front matter with the reason. |
| 12 | handoffs | "reply LGTM" | "LGTM" reads as approval, which review-standards forbids, and it carries nothing the next step (security, tester) can use. | Convention: handoff file `.ai-sdlc/runs/<run-id>/NN-reviewer.md` with front matter `run_id, step, agent, status, inputs, next`; Mechanism once module 08 adds it: the Claude Code hook `.claude/hooks/check-handoff.mjs`. |

## Frappe review surfaces the prompt forgot

On a Frappe team the person who reviews a change today looks at more than Python. The prompt names
"the FHIR API and the Patient DocType" and none of the following, so a model following it reviews
`spice_lite/api/fhir.py` and skims the JSON:

| surface | what a human reviewer checks today | where the agent gets that knowledge |
|---|---|---|
| DocType JSON (`sl_patient.json`) | new fields have a patch if data must change; `search_index` on filtered fields; `permissions` array unchanged or security-reviewed; `autoname` never by PHI | `.claude/rules/doctype-json.md` (loaded by `paths`), frappe-coding-standards rules 6 and 11 |
| `patches.txt` | new patch in the right section (`[pre_model_sync]` or `[post_model_sync]`); no existing line edited, because Patch Log keys on the exact line text | `.claude/rules/doctype-json.md`, review-standards Frappe clause |
| `hooks.py` | a new `doc_events`, `scheduler_events`, `permission_query_conditions` or `has_permission` key has an ADR | `.claude/rules/doctype-json.md` |
| fixtures | Custom Field and Property Setter fixtures belong in the country app, not in `spice_lite` | frappe-coding-standards rule 12 |
| whitelisted methods | `methods=[...]`, no `allow_guest`, `frappe.get_list` not `frappe.get_all` | `.claude/rules/spice-lite-python.md`, frappe-coding-standards rules 2 and 3 |

## Rewritten as a contract (summary)

- purpose: review one diff (Python, DocType JSON, `patches.txt`, `hooks.py`, fixtures) against the Frappe standards and return findings; never edit, never run `bench`, never give merge approval (an `APPROVE` verdict only means no blocking findings).
- inputs: base ref and run id in the task message; optional upstream handoff path.
- outputs: handoff with six-field findings table, a "Frappe surfaces in this diff" line, and explicit "no findings" per category.
- tools: Read, Grep, Glob, Bash (git diff, git log, git status only).
- humanGate: PR approval by a human; critical or high findings block merge; `bench --site * migrate` stays a human action behind an `ask` rule.

Full draft: `docs/foundations/reviewer-contract-draft.md`.
