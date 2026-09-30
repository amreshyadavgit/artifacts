#!/usr/bin/env node
// Runs cost-report.mjs against fixture result files shaped like `claude -p --output-format json` output.
// Usage: node scripts/governance/cost-report.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "cost-report.mjs");
const result = (o) => JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 61000, num_turns: 9, session_id: "3f0c9b1e-0000-4000-8000-000000000001", result: "done", total_cost_usd: 0.5, usage: {}, modelUsage: { "claude-sonnet-5": {} }, ...o });
function run(files, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "costs-"));
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body);
  return spawnSync(process.execPath, [script, dir, ...args], { encoding: "utf8" });
}
const feature = {
  "02-architect.json": result({ total_cost_usd: 1.84, num_turns: 14, modelUsage: { "claude-opus-5-5": {} } }),
  "04-developer.json": result({ total_cost_usd: 2.31, num_turns: 31 }),
  "05-tester.json": result({ total_cost_usd: 0.92, num_turns: 12 }),
  "06-reviewer.json": result({ total_cost_usd: 0.61, num_turns: 8 }),
  "07-security.json": result({ total_cost_usd: 1.12, num_turns: 10, modelUsage: { "claude-opus-5-5": {} } }),
};
const cases = [
  { name: "feature run within budget passes", files: feature, args: ["--budget-usd", "10"], expect: 0, grep: /Total: \$6\.80 of \$10\.00 budget \(68%\)/ },
  { name: "same run over a $5 budget fails", files: feature, args: ["--budget-usd", "5"], expect: 1, grep: /run total \$6\.80 exceeds budget \$5\.00/ },
  { name: "step that hit --max-turns fails the run", files: { ...feature, "04-developer.json": result({ subtype: "error_max_turns", is_error: true, total_cost_usd: 3.9, num_turns: 60 }) }, args: [], expect: 1, grep: /04-developer\.json: stopped on a limit \(error_max_turns\)/ },
  { name: "step that hit --max-budget-usd fails the run", files: { "06-reviewer.json": result({ subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 2.0 }) }, args: [], expect: 1, grep: /error_max_budget_usd/ },
  { name: "largest step is reported", files: feature, args: [], expect: 0, grep: /Largest step: 04-developer \(\$2\.31, 34% of run\)/ },
  { name: "json output is machine-readable", files: feature, args: ["--json", "--budget-usd", "10"], expect: 0, grep: /"total_cost_usd": 6\.8/ },
];
let failed = 0;
for (const c of cases) {
  const r = run(c.files, c.args);
  const ok = r.status === c.expect && c.grep.test(r.stdout);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})${ok ? "" : "\n" + r.stdout + r.stderr}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
