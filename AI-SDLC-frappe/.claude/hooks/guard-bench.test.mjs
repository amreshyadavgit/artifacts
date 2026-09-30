#!/usr/bin/env node
// Runs guard-bench.mjs as a real hook process against sample PreToolUse payloads for Bash.
// Usage: node .claude/hooks/guard-bench.test.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hook = join(dirname(fileURLToPath(import.meta.url)), "guard-bench.mjs");
const cases = [
  { name: "run-tests on the test site passes through", cmd: "bench --site test.localhost run-tests --app spice_lite", expect: null },
  { name: "run-tests module inside su -c passes through", cmd: "su - frappe -c \"source ~/.spice-lite-bench-env && cd /home/user/frappe-bench && bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api\"", expect: null },
  { name: "list-apps passes through", cmd: "cd /home/user/frappe-bench && bench --site test.localhost list-apps", expect: null },
  { name: "non-bench command is ignored", cmd: "git diff --stat", expect: null },
  { name: "the word bench as an argument is ignored", cmd: "grep -rn 'bench migrate' docs/", expect: null },
  { name: "docker compose exec bench migrate asks", cmd: "docker compose exec backend bench --site frontend migrate", expect: "ask" },
  { name: "env-prefixed bench execute asks", cmd: "FRAPPE_SITE=test.localhost bench execute spice_lite.install.after_migrate", expect: "ask" },
  { name: "migrate asks", cmd: "bench --site test.localhost migrate", expect: "ask" },
  { name: "migrate with a global flag first still asks", cmd: "bench --verbose --site test.localhost migrate", expect: "ask" },
  { name: "migrate on the default site still asks", cmd: "bench migrate", expect: "ask" },
  { name: "--site= form and a path to bench still ask", cmd: "./env/bin/bench --site=test.localhost migrate --skip-failing", expect: "ask" },
  { name: "migrate hidden in su -c asks", cmd: "su - frappe -c \"cd /home/user/frappe-bench && bench --site test.localhost migrate\"", expect: "ask" },
  { name: "sudo -u frappe bench console asks", cmd: "sudo -u frappe bench --site test.localhost console", expect: "ask" },
  { name: "execute asks", cmd: "bench --site test.localhost execute spice_lite.demo.seed_demo", expect: "ask" },
  { name: "install-app asks", cmd: "bench --site test.localhost install-app spice_ke", expect: "ask" },
  { name: "run-tests on another site asks", cmd: "bench --site ke.spice.example run-tests --app spice_lite", expect: "ask" },
  { name: "unknown subcommand fails closed to ask", cmd: "bench --site test.localhost frobnicate", expect: "ask" },
  { name: "show-config is denied", cmd: "bench --site test.localhost show-config", expect: "deny" },
  { name: "DB shell is denied", cmd: "bench --site test.localhost postgres", expect: "deny" },
  { name: "reading site_config.json through the shell is denied", cmd: "cat /home/user/frappe-bench/sites/test.localhost/site_config.json | jq .db_name", expect: "deny" },
  { name: "execute of get_site_config is denied", cmd: "bench --site test.localhost execute frappe.get_site_config", expect: "deny" },
  { name: "execute of generate_keys is denied", cmd: "bench --site test.localhost execute frappe.core.doctype.user.user.generate_keys --args \"['integration.erpnext@spice.example']\"", expect: "deny" },
  { name: "drop-site is denied", cmd: "bench drop-site test.localhost --force", expect: "deny" },
  { name: "--site all with migrate is denied", cmd: "bench --site all migrate", expect: "deny" },
  { name: "deny wins over ask in a compound command", cmd: "bench --site test.localhost migrate && bench --site test.localhost set-admin-password x", expect: "deny" },
  { name: "non-Bash tool is ignored", tool: "Read", cmd: "bench --site test.localhost show-config", expect: null },
];

let failed = 0;
for (const c of cases) {
  const payload = JSON.stringify({ session_id: "test", hook_event_name: "PreToolUse", tool_name: c.tool || "Bash", tool_input: { command: c.cmd, description: "test" }, tool_use_id: "toolu_test", cwd: process.cwd(), permission_mode: "default" });
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (decision ${decision ?? "none"}, expected ${c.expect ?? "none"})${!ok && reason ? "  reason: " + reason : ""}`);
}
const bad = spawnSync(process.execPath, [hook], { input: "not json", encoding: "utf8" });
const badOk = bad.status === 2;
if (!badOk) failed++;
console.log(`${badOk ? "PASS" : "FAIL"}  unparseable input blocks with exit 2 (exit ${bad.status})`);
console.log(`\n${cases.length + 1 - failed}/${cases.length + 1} passed`);
process.exit(failed ? 1 : 0);
