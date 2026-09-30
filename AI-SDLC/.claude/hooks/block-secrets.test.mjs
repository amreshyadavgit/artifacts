#!/usr/bin/env node
// Runs block-secrets.mjs against sample hook payloads. Usage: node .claude/hooks/block-secrets.test.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hook = join(dirname(fileURLToPath(import.meta.url)), "block-secrets.mjs");
const cases = [
  { name: "clean Java edit is allowed", tool: "Edit", input: { file_path: "sample-app/src/main/java/org/example/fhir/api/PatientController.java", old_string: "a", new_string: "return ResponseEntity.ok(body);" }, expect: 0 },
  { name: "hard-coded DB password is blocked", tool: "Write", input: { file_path: "sample-app/src/main/resources/application-prod.yml", content: "spring:\n  datasource:\n    password: \"SuperSecret123\"\n" }, expect: 2 },
  { name: "env placeholder is allowed", tool: "Write", input: { file_path: "sample-app/src/main/resources/application-prod.yml", content: "spring:\n  datasource:\n    password: \"${DB_PASSWORD}\"\n" }, expect: 0 },
  { name: "AWS key is blocked", tool: "Write", input: { file_path: "k8s/config.yaml", content: "key: AKIAABCDEFGHIJKLMNOP" }, expect: 2 },
  { name: "private key is blocked", tool: "Write", input: { file_path: "certs/key.pem", content: "-----BEGIN RSA PRIVATE KEY-----\nMIIE" }, expect: 2 },
];
let failed = 0;
for (const c of cases) {
  const payload = JSON.stringify({ session_id: "test", hook_event_name: "PreToolUse", tool_name: c.tool, tool_input: c.input, cwd: process.cwd(), permission_mode: "default" });
  const r = spawnSync(process.execPath, [hook], { input: payload, encoding: "utf8" });
  const ok = r.status === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})${r.stderr ? "  stderr: " + r.stderr.trim() : ""}`);
}
process.exit(failed ? 1 : 0);
