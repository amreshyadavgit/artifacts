#!/usr/bin/env node
// PreToolUse hook for Edit|Write: block file writes that contain likely secrets.
// Exit 2 blocks the tool call; stderr is shown to Claude as the reason.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const ti = input.tool_input || {};
const text = [ti.content, ti.new_string, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join("\n");

const PATTERNS = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Hard-coded password", /(password|passwd|secret)\s*[:=]\s*["'](?!\$\{)[^"'\s]{8,}["']/i],
  ["JDBC URL with inline password", /jdbc:postgresql:\/\/[^\s"']*password=[^&\s"'$]+/i],
];

// Test fixtures for this hook and the documented local-profile demo users are allowed.
const path = String(ti.file_path || "");
if (/block-secrets\.test\.mjs$/.test(path)) process.exit(0);

for (const [label, re] of PATTERNS) {
  const m = text.match(re);
  if (m) {
    process.stderr.write(
      `Blocked by .claude/hooks/block-secrets.mjs: ${label} detected in ${path || "tool input"}. ` +
        `Use an environment variable or a Kubernetes Secret reference instead (see context/security/phi-and-secrets-policy.md).\n`
    );
    process.exit(2);
  }
}
process.exit(0);
