# Anatomy breakdown: the one-off review prompt

Reference answer for exercise `01-anatomy-breakdown` (module 01-foundations).
Source prompt: `docs/foundations/one-off-review-prompt.md`.

Each row takes one anatomy element, quotes what the prompt says about it, names the gap, and says
where that element lives once the prompt becomes the `reviewer` agent. The last column starts with
**Mechanism:** when Claude Code enforces or loads it, or **Convention:** when it is a course rule that
only a human, a script or an eval checks.

| # | element | what the prompt says | gap or risk | where it lives in Claude Code |
|---|---|---|---|---|
| 1 | responsibilities | "tell me what's wrong", "Fix anything obvious" | Two jobs in one: reviewing and editing. An agent that fixes what it reviews cannot give an independent opinion. | Mechanism: the `description` frontmatter field decides when the main session delegates to `reviewer`; the body states the single job. |
| 2 | boundaries | nothing | No statement of what is out of scope (deep security analysis, performance profiling, approving). | Mechanism: `tools` allowlist and `disallowedTools`; Convention: the contract `mustNot` list for boundaries no tool setting can express. |
| 3 | inputs | "my latest changes to the Observation API" | Which base ref? Staged or committed? A subagent has no conversation history, so "latest" means nothing to it. | Mechanism: the Agent tool `prompt` (task message) is the only runtime input besides CLAUDE.md, git status and preloaded skills; Convention: the contract names the required fields (base ref, run id). |
| 4 | outputs | "tell me", "be thorough but concise" | No format, so findings cannot be counted, compared between runs, or checked by a script. | Mechanism: the subagent's final message is what returns to the main session; Convention: the six-field finding table from `context/standards/review-standards.md` and the handoff file. |
| 5 | tools | nothing | In the main session the prompt runs with every tool the session has, including Edit and Write. | Mechanism: `tools: Read, Grep, Glob, Bash` in `.claude/agents/reviewer.md`; omitting `Agent` also stops it delegating. |
| 6 | context | "Use our standards" | Which standards? The model will invent generic Java advice. | Mechanism: the CLAUDE.md hierarchy loads automatically and `skills: [code-review]` preloads the review procedure; Convention: the body names `context/standards/review-standards.md` and `coding-standards.md` to Read. |
| 7 | instructions | "You are a senior Java reviewer" | A persona, not a procedure. No steps, no order, no definition of done. | Mechanism: the agent file body becomes the subagent's system prompt (it does not get the Claude Code system prompt). |
| 8 | memory/state | nothing | Nothing carries over between reviews, which is fine; but the prompt also relies on "my latest changes" living in chat history. | Mechanism: optional `memory: project` gives `.claude/agent-memory/reviewer/MEMORY.md`; Convention: run state lives in handoff files under `.ai-sdlc/runs/<run-id>/`. |
| 9 | permissions | "Fix anything obvious" | Grants write authority implicitly. In `acceptEdits` mode those edits would land without a prompt. | Mechanism: `permissionMode` in frontmatter plus project `permissions` allow/ask/deny in `.claude/settings.json`; the `PreToolUse` hook `block-secrets.mjs` still runs inside subagents. |
| 10 | verification | nothing | No way to tell a good review from a plausible one. | Convention: golden tasks in `evaluations/` (module 09) and `validate-contract.mjs` for the contract; Mechanism: a `SubagentStop` hook can reject output that lacks the required structure (module 08). |
| 11 | failure handling | "If everything looks fine, reply LGTM" | The only exit is success. No instruction for an empty diff, a huge diff, or a missing standard, so the model guesses. | Mechanism: `maxTurns` caps the loop and marks the output partial; Convention: `status: blocked` or `needs-human` in the handoff front matter with the reason. |
| 12 | handoffs | "reply LGTM" | "LGTM" reads as approval, which review-standards forbids, and it carries nothing the next step can use. | Convention: handoff file `.ai-sdlc/runs/<run-id>/NN-reviewer.md` with front matter `run_id, step, agent, status, inputs, next`; Mechanism once module 08 adds it: `.claude/hooks/check-handoff.mjs`. |

## Rewritten as a contract (summary)

- purpose: review one diff against the standards and return findings; never edit, never approve.
- inputs: base ref and run id in the task message; optional upstream handoff path.
- outputs: handoff with six-field findings table and explicit "no findings" per category.
- tools: Read, Grep, Glob, Bash (git diff, git log, git status only).
- humanGate: PR approval by a human; critical or high findings block merge.

Full draft: `docs/foundations/reviewer-contract-draft.md`.
