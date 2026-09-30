#!/usr/bin/env node
// Runs guard-outbound.mjs as a real hook process against sample PreToolUse payloads.
// Usage: node .claude/hooks/guard-outbound.test.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hook = join(dirname(fileURLToPath(import.meta.url)), "guard-outbound.mjs");
const cases = [
  { name: "read-only Frappe site lookup passes through", tool: "mcp__frappe-site__get_list", input: { doctype: "SL Observation", fields: ["name", "code", "status"] }, expect: null },
  { name: "Jira search passes through", tool: "mcp__Atlassian_Rovo__searchJiraIssuesUsingJql", input: { jql: "project = SPICE AND labels = lastn" }, expect: null },
  { name: "GitHub get_check_run is a read (leading verb wins)", tool: "mcp__github__get_check_run", input: { check_run_id: 7 }, expect: null },
  { name: "Jira comment asks a human", tool: "mcp__Atlassian_Rovo__addCommentToJiraIssue", input: { issueIdOrKey: "SPICE-212", commentBody: "Fixed in PR 88" }, expect: "ask" },
  { name: "GitHub merge asks a human", tool: "mcp__github__merge_pull_request", input: { pullNumber: 88 }, expect: "ask" },
  { name: "GitHub issue_write asks (write verb not first)", tool: "mcp__github__issue_write", input: { title: "x" }, expect: "ask" },
  { name: "Frappe insert_doc asks", tool: "mcp__frappe-site__insert_doc", input: { doc: { doctype: "SL Observation", patient: "SLP-00001" } }, expect: "ask" },
  { name: "Frappe whitelisted-method bridge fails closed to ask", tool: "mcp__frappe-site__call_method", input: { method: "spice_lite.api.fhir.create_observation" }, expect: "ask" },
  { name: "real-looking MRN in a comment is denied", tool: "mcp__github__add_issue_comment", input: { body: "Repro with patient MRN-482913" }, expect: "deny" },
  { name: "synthetic MRN is allowed through to the ask gate", tool: "mcp__github__add_issue_comment", input: { body: "Repro with MRN-000123" }, expect: "ask" },
  { name: "Frappe API token in a Jira comment is denied", tool: "mcp__Atlassian_Rovo__addCommentToJiraIssue", input: { issueIdOrKey: "SPICE-214", commentBody: "curl -H 'Authorization: token 1a2b3c4d5e6f7a8:9f8e7d6c5b4a3f2' ..." }, expect: "deny" },
  { name: "site_config db_password in a search query is denied", tool: "mcp__github__search_code", input: { query: "\"db_password\": \"Wq9xLmP2vR\"" }, expect: "deny" },
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
