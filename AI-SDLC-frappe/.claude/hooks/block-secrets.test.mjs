#!/usr/bin/env node
// Runs block-secrets.mjs against sample hook payloads. Usage: node .claude/hooks/block-secrets.test.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hook = join(dirname(fileURLToPath(import.meta.url)), "block-secrets.mjs");
const cases = [
  { name: "clean Python edit is allowed", tool: "Edit", input: { file_path: "sample-app/spice_lite/spice_lite/api/fhir.py", old_string: "a", new_string: "rows = frappe.get_list(\"SL Patient\", filters=filters, pluck=\"name\")" }, expect: 0 },
  { name: "site_config db_password is blocked", tool: "Write", input: { file_path: "sites/test.localhost/site_config.json", content: "{\n \"db_name\": \"_abc\",\n \"db_password\": \"Wq9xLmP2vR\"\n}" }, expect: 2 },
  { name: "Frappe API token is blocked", tool: "Write", input: { file_path: "scripts/call-api.sh", content: "curl -H 'Authorization: token 1a2b3c4d5e6f7a8:9f8e7d6c5b4a3f2' http://test.localhost:8000/api/method/ping" }, expect: 2 },
  { name: "env placeholder is allowed", tool: "Write", input: { file_path: "scripts/call-api.sh", content: "curl -H \"Authorization: token ${SPICE_API_KEY}:${SPICE_API_SECRET}\" http://test.localhost:8000/api/method/ping" }, expect: 0 },
  { name: "Postgres URL with password is blocked", tool: "Write", input: { file_path: "docker/.env.example", content: "DATABASE_URL=postgresql://postgres:s3cretPass@db:5432/spice" }, expect: 2 },
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
