#!/usr/bin/env node
// PreToolUse hook for MCP tools (matcher "mcp__.*"): a human gate on outbound actions.
//
// Decisions (JSON on stdout, exit 0; https://code.claude.com/docs/en/hooks):
//   - "deny" when the tool input carries something that must never leave the machine
//     (likely secret, a Frappe API token or site_config value, a real-looking MRN, an SSN-shaped value).
//   - "ask"  when the MCP tool looks like a write (create/update/comment/merge/...) or its
//     verb is unknown. A human sees the prompt with the reason and approves or rejects.
//   - no output (exit 0) for read-only verbs (get/list/search/...), so normal permission
//     rules apply unchanged.
// Why a hook and not only an "ask" rule: permission rules match tool names, and MCP servers
// name tools differently (Jira `addCommentToJiraIssue`, GitHub `add_issue_comment`, a Frappe site
// server's `call_method`). The hook classifies by verb, so a new server is gated on day one.
// A Frappe whitelisted-method bridge ("call", "invoke") is treated as unknown -> ask, because a
// whitelisted method can write.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const READ_VERBS = new Set([
  "get", "list", "search", "read", "fetch", "query", "describe", "view", "find", "lookup",
  "show", "count", "check", "status", "download", "export", "whoami",
]);
const WRITE_VERBS = new Set([
  "create", "update", "delete", "remove", "add", "post", "comment", "reply", "write", "edit",
  "push", "merge", "transition", "send", "set", "close", "reopen", "assign", "upload",
  "publish", "trigger", "run", "execute", "approve", "submit", "fork", "move", "rename",
  "archive", "enable", "disable", "subscribe", "unsubscribe", "resolve", "unresolve", "patch", "put",
  "insert", "save", "cancel", "amend", "migrate", "enqueue", "import",
]);

// Values that must never be sent to an external system (context/security/phi-and-secrets-policy.md).
const NEVER_SEND = [
  ["secret-like token (AWS key)", /\bAKIA[0-9A-Z]{16}\b/],
  ["secret-like token (GitHub)", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["secret-like token (Anthropic)", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["private key", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  // Frappe: `Authorization: token <api_key>:<api_secret>` (15-char hex halves from generate_keys)
  ["Frappe API token", /\btoken\s+[0-9a-f]{15}:[0-9a-f]{15}\b/i],
  ["Frappe API secret", /"?api_secret"?\s*[:=]\s*"?[0-9a-f]{15}\b/i],
  // site_config.json values
  ["site_config secret", /"?(db_password|encryption_key|admin_password|root_password|redis_password)"?\s*[:=]\s*"?[^"\s$,}]{6,}/i],
  ["database URL with inline password", /\b(postgres(ql)?|mysql|mariadb):\/\/[^\s:@"']+:[^\s@"'$]+@/i],
  // Synthetic MRNs in this course are MRN-000xxx (context/domain/spice-lite-glossary.md); anything
  // else looks like a real record number.
  ["non-synthetic MRN", /\bMRN-(?!000)\d{3,}\b/],
  ["SSN-shaped value", /\b\d{3}-\d{2}-\d{4}\b/],
];

export function classify(toolName) {
  // mcp__<server>__<tool>; plugin servers are mcp__plugin_<plugin>_<server>__<tool>
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName || "");
  if (!m) return { server: null, tool: toolName, kind: "not-mcp" };
  const [, server, tool] = m;
  // "addCommentToJiraIssue" and "add_issue_comment" both become ["add", "issue"/"comment", ...]
  const tokens = tool.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[_\-.]+/).filter(Boolean);
  // The leading verb wins ("get_check_run" is a read even though "run" is a write verb).
  if (READ_VERBS.has(tokens[0])) return { server, tool, kind: "read" };
  if (WRITE_VERBS.has(tokens[0])) return { server, tool, kind: "write" };
  // Otherwise any write verb makes it a write ("issue_write", "pull_request_review_write").
  if (tokens.some((t) => WRITE_VERBS.has(t))) return { server, tool, kind: "write" };
  if (tokens.some((t) => READ_VERBS.has(t))) return { server, tool, kind: "read" };
  return { server, tool, kind: "unknown" };
}

export function decide(input) {
  const name = String(input.tool_name || "");
  const c = classify(name);
  if (c.kind === "not-mcp") return null;
  // Check the JSON text (keys and values) and every string value unescaped, so a value such as
  // "db_password": "..." inside a query string is seen without JSON escaping.
  const leaves = [];
  const walk = (v) => { if (typeof v === "string") leaves.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(input.tool_input);
  const payload = JSON.stringify(input.tool_input ?? {}) + "\n" + leaves.join("\n");
  for (const [label, re] of NEVER_SEND) {
    if (re.test(payload)) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason:
          `guard-outbound: ${label} found in the input to ${name}. PHI and secrets must never be sent to an MCP server ` +
          `(context/security/phi-and-secrets-policy.md). Remove it and use synthetic data such as MRN-000123.`,
      };
    }
  }
  if (c.kind === "write") {
    return {
      permissionDecision: "ask",
      permissionDecisionReason:
        `guard-outbound: ${name} writes to the external system "${c.server}". Approve only if you asked for this action ` +
        `and the content came from you, not from a ticket, PR comment or web page (docs/governance/prompt-injection.md).`,
    };
  }
  if (c.kind === "unknown") {
    return {
      permissionDecision: "ask",
      permissionDecisionReason:
        `guard-outbound: cannot tell whether ${name} reads or writes, so a human decides (fail closed to ask).`,
    };
  }
  return null; // read-only: let the normal permission rules decide
}

// Run as a hook only when executed directly (tests import classify/decide).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.stderr.write("guard-outbound: could not parse hook input; blocking to be safe.\n");
    process.exit(2);
  }
  const d = decide(input);
  if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...d } }) + "\n");
  process.exit(0);
}
