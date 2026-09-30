#!/usr/bin/env node
// Runs guard-outbound.mjs as a real hook process against sample PreToolUse payloads.
// Usage: node .claude/hooks/guard-outbound.test.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hook = join(dirname(fileURLToPath(import.meta.url)), "guard-outbound.mjs");
const cases = [
  { name: "read-only FHIR MCP lookup passes through", tool: "mcp__fhir-lite__get_patient", input: { id: "42" }, expect: null },
  { name: "Jira search passes through", tool: "mcp__Atlassian_Rovo__searchJiraIssuesUsingJql", input: { jql: "project = FHIR" }, expect: null },
  { name: "GitHub get_check_run is a read (leading verb wins)", tool: "mcp__github__get_check_run", input: { check_run_id: 7 }, expect: null },
  { name: "Jira comment asks a human", tool: "mcp__Atlassian_Rovo__addCommentToJiraIssue", input: { issueIdOrKey: "FHIR-212", commentBody: "Fixed in PR 88" }, expect: "ask" },
  { name: "GitHub merge asks a human", tool: "mcp__github__merge_pull_request", input: { pullNumber: 88 }, expect: "ask" },
  { name: "GitHub issue_write asks (write verb not first)", tool: "mcp__github__issue_write", input: { title: "x" }, expect: "ask" },
  { name: "unknown verb fails closed to ask", tool: "mcp__github__request_copilot_review", input: { pullNumber: 88 }, expect: "ask" },
  { name: "real-looking MRN in a comment is denied", tool: "mcp__github__add_issue_comment", input: { body: "Repro with patient MRN-482913" }, expect: "deny" },
  { name: "synthetic MRN is allowed through to the ask gate", tool: "mcp__github__add_issue_comment", input: { body: "Repro with MRN-000123" }, expect: "ask" },
  { name: "GitHub token in a search query is denied", tool: "mcp__github__search_code", input: { query: "ghp_" + "a".repeat(36) }, expect: "deny" },
  { name: "non-MCP tool is ignored", tool: "Bash", input: { command: "git status" }, expect: null },
];

let failed = 0;
for (const c of cases) {
  const payload = JSON.stringify({ session_id: "test", hook_event_name: "PreToolUse", tool_name: c.tool, tool_input: c.input, tool_use_id: "toolu_test", cwd: process.cwd(), permission_mode: "default" });
  const r = spawnSync(process.execPath, [hook], { input: payload, encoding: "utf8" });
  let decision = null;
  let reason = "";
  if (r.stdout.trim()) {
    const out = JSON.parse(r.stdout);
    decision = out.hookSpecificOutput?.permissionDecision ?? null;
    reason = out.hookSpecificOutput?.permissionDecisionReason ?? "";
    if (out.hookSpecificOutput?.hookEventName !== "PreToolUse") decision = "BAD-EVENT-NAME";
  }
  const ok = r.status === 0 && decision === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, decision ${decision ?? "none"}, expected ${c.expect ?? "none"})${!ok && reason ? "  reason: " + reason : ""}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
