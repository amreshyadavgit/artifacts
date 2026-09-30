#!/usr/bin/env node
// Runs check-agent-policy.mjs against fixture agent folders. Usage: node scripts/governance/check-agent-policy.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-agent-policy.mjs");
const agent = (fm) => `---\n${fm}\n---\n\nYou are a test agent.\n`;
const good = {
  "reviewer.md": agent("name: reviewer\ndescription: Reviews diffs\ntools: Read, Grep, Glob, Bash\nmodel: sonnet\neffort: high\nmaxTurns: 25\npermissionMode: dontAsk"),
  "security.md": agent("name: security\ndescription: Security review\ntools: Read, Grep, Glob\nmodel: claude-opus-5-5\neffort: high\nmaxTurns: 30"),
};
const cases = [
  { name: "compliant agents pass", files: good, expect: 0, grep: /0 violation\(s\)/ },
  { name: "reviewer with Edit is a violation", files: { ...good, "reviewer.md": good["reviewer.md"].replace("tools: Read,", "tools: Read, Edit,") }, expect: 1, grep: /tool "Edit" is forbidden for reviewer/ },
  { name: "omitted tools is a violation", files: { ...good, "security.md": good["security.md"].replace("tools: Read, Grep, Glob\n", "") }, expect: 1, grep: /missing required field "tools"/ },
  { name: "model inherit is a violation", files: { ...good, "reviewer.md": good["reviewer.md"].replace("model: sonnet", "model: inherit") }, expect: 1, grep: /model "inherit" is not allowed/ },
  { name: "maxTurns above ceiling is a violation", files: { ...good, "reviewer.md": good["reviewer.md"].replace("maxTurns: 25", "maxTurns: 200") }, expect: 1, grep: /maxTurns 200 exceeds policy ceiling 25/ },
  { name: "bypassPermissions is a violation", files: { ...good, "security.md": good["security.md"].replace("maxTurns: 30", "maxTurns: 30\npermissionMode: bypassPermissions") }, expect: 1, grep: /permissionMode "bypassPermissions" is forbidden/ },
  { name: "non-orchestrator with Agent is a violation", files: { ...good, "reviewer.md": good["reviewer.md"].replace("Bash\n", "Bash, Agent\n") }, expect: 1, grep: /"Agent" in tools lets reviewer spawn subagents/ },
  { name: "missing roster file fails only with --strict", files: good, args: ["--strict"], expect: 1, grep: /architect: .*not found/ },
];

let failed = 0;
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), "agent-policy-"));
  mkdirSync(join(dir, "agents"));
  for (const [f, body] of Object.entries(c.files)) writeFileSync(join(dir, "agents", f), body);
  const r = spawnSync(process.execPath, [script, "--agents-dir", join(dir, "agents"), ...(c.args || [])], { encoding: "utf8" });
  const ok = r.status === c.expect && c.grep.test(r.stdout);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})${ok ? "" : "\n" + r.stdout}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
