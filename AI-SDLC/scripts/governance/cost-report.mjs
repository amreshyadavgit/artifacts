#!/usr/bin/env node
// Aggregate the cost of a workflow run from saved `claude -p --output-format json` results and
// enforce a run-level budget.
//
// Each step of a headless run saves its result JSON (fields used: total_cost_usd, num_turns,
// subtype, is_error, duration_ms, session_id, modelUsage) as <run-dir>/costs/NN-<agent>.json:
//   claude -p "$PROMPT" --agent reviewer --max-turns 25 --max-budget-usd 2.00 \
//     --output-format json > .ai-sdlc/runs/$RUN_ID/costs/03-reviewer.json
//
// Usage: node scripts/governance/cost-report.mjs <run-dir>/costs [--budget-usd 10] [--json]
// Exit 0 = within budget and no step hit a limit, 1 = over budget or a step stopped on a limit,
// 2 = usage error. total_cost_usd is a client-side estimate; reconcile monthly with billing.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.argv[2];
if (!dir || dir.startsWith("--")) {
  console.error("usage: cost-report.mjs <costs-dir> [--budget-usd N] [--json]");
  process.exit(2);
}
const i = process.argv.indexOf("--budget-usd");
const budget = i > 0 ? Number(process.argv[i + 1]) : null;
const LIMIT_SUBTYPES = new Set(["error_max_turns", "error_max_budget_usd"]);

const steps = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  let r;
  try { r = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (e) { steps.push({ file: f, agent: "?", error: `invalid JSON: ${e.message}` }); continue; }
  const m = /^(\d+)-(.+)\.json$/.exec(basename(f));
  steps.push({
    file: f,
    step: m ? m[1] : "",
    agent: m ? m[2] : basename(f, ".json"),
    cost: Number(r.total_cost_usd ?? 0),
    turns: Number(r.num_turns ?? 0),
    subtype: String(r.subtype ?? "unknown"),
    isError: Boolean(r.is_error),
    seconds: r.duration_ms != null ? Math.round(Number(r.duration_ms) / 1000) : null,
    models: r.modelUsage && typeof r.modelUsage === "object" ? Object.keys(r.modelUsage) : [],
  });
}

const total = steps.reduce((s, x) => s + (x.cost || 0), 0);
const problems = [];
for (const s of steps) {
  if (s.error) problems.push(`${s.file}: ${s.error}`);
  else if (LIMIT_SUBTYPES.has(s.subtype)) problems.push(`${s.file}: stopped on a limit (${s.subtype}); output is partial, a human must decide whether to resume or re-plan`);
  else if (s.isError) problems.push(`${s.file}: is_error=true (subtype ${s.subtype})`);
}
if (budget != null && total > budget) problems.push(`run total $${total.toFixed(2)} exceeds budget $${budget.toFixed(2)}`);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total_cost_usd: Number(total.toFixed(4)), budget_usd: budget, steps, problems }, null, 2));
} else {
  const rows = steps.map((s) => [s.step, s.agent, s.error ? "-" : `$${s.cost.toFixed(2)}`, String(s.turns ?? "-"), s.subtype ?? "-", s.models.join(",") || "-"]);
  const head = ["step", "agent", "cost", "turns", "subtype", "models"];
  const w = head.map((h, k) => Math.max(h.length, ...rows.map((r) => r[k].length)));
  const fmt = (r) => r.map((c, k) => c.padEnd(w[k])).join("  ");
  console.log(fmt(head));
  for (const r of rows) console.log(fmt(r));
  const share = steps.filter((s) => s.cost).sort((a, b) => b.cost - a.cost)[0];
  console.log(`\nTotal: $${total.toFixed(2)}${budget != null ? ` of $${budget.toFixed(2)} budget (${Math.round((total / budget) * 100)}%)` : ""}`);
  if (share && total > 0) console.log(`Largest step: ${share.step}-${share.agent} ($${share.cost.toFixed(2)}, ${Math.round((share.cost / total) * 100)}% of run)`);
  for (const p of problems) console.log(`PROBLEM  ${p}`);
}
process.exit(problems.length ? 1 : 0);
