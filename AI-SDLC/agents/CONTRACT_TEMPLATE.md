# Agent Contract: <agent-name>

<!--
How to use this template (course convention, not a Claude Code feature):
1. Copy it to agents/<agent-name>/CONTRACT.md. <agent-name> is one of:
   architect, developer, reviewer, tester, security, sre, orchestrator.
2. Replace every <angle-bracket> placeholder. Keep the eleven "## field" headings exactly as
   written, in this order: they are the agentContracts fields of build/schema.json, and
   docs/foundations/validate-contract.mjs checks them.
3. List fields (inputs, outputs, tools, must, mustNot, failureConditions) use "- " bullets.
   Text fields (purpose, permissions, validation, handoffFormat, humanGate) are one paragraph.
4. Every line in must / mustNot ends with how it is enforced, in square brackets:
   [mechanism: <the Claude Code config or hook that enforces it>] or
   [convention: <who or what checks it>]. A rule with no enforcement is a wish.
5. Validate: node docs/foundations/validate-contract.mjs agents/<agent-name>/CONTRACT.md
Block-level HTML comments like this one are ignored by the validator.
-->

Status: <draft | final>
Owner: <team or person accountable for this agent>
Runtime definition: `.claude/agents/<agent-name>.md`
Finalised in: <module id that ships the final version>

## purpose

<One paragraph: the single job this agent does, for whom, and the decision its output supports. Name what it does NOT do if that is a common confusion.>

## inputs

- <Input 1: what it is, where it comes from (task message, handoff file path, repo path), required or optional>
- <Input 2>

## outputs

- <Output 1: the artifact, its path, and its format>
- <Output 2: the final message returned to the main session>

## tools

- <Tool name exactly as Claude Code spells it, e.g. Read, Grep, Glob, Bash, Edit, Write, mcp__server__tool, plus any scope such as "Bash (git diff only)">

## permissions

<One paragraph: the frontmatter and settings that bound this agent: `tools`, `disallowedTools`, `permissionMode`, and the project `permissions` allow/ask/deny rules it relies on. Say what is enforced by config and what is only requested.>

## must

- <Required behaviour> [mechanism: <config or hook>]
- <Required behaviour> [convention: <checked by whom>]

## mustNot

- <Forbidden behaviour> [mechanism: <config or hook>]
- <Forbidden behaviour> [convention: <checked by whom>]

## failureConditions

- <Condition under which the agent must stop and report `status: blocked` or `status: needs-human` instead of guessing>

## validation

<One paragraph: how anyone can check an output is acceptable: a command that exits 0, a golden task in evaluations/, a hook, a checklist a human applies.>

## handoffFormat

<One paragraph: the handoff file path (`.ai-sdlc/runs/<run-id>/NN-<agent-name>.md`), its YAML front matter keys (`run_id`, `step`, `agent`, `status`, `inputs`, `next`), and the required sections.>

## humanGate

<One paragraph: where a human must approve before the work continues, and the real mechanism that stops the work until they do (plan mode, a permission `ask` rule, PR approval, a hook that exits 2).>
