#!/usr/bin/env node
// Policy as code for the roster agents: model, effort, turn budget, tools and permission mode.
// Reads .claude/agents/*.md front matter and compares it with scripts/governance/agent-policy.json.
// Bench command scope (no console, migrate only via a human prompt) is enforced at runtime by
// .claude/hooks/guard-bench.mjs and the permission rules, not here: this checks the static contract.
//
// Usage: node scripts/governance/check-agent-policy.mjs [--agents-dir .claude/agents] [--policy <file>] [--strict]
// Exit 0 = no violations (missing roster files are warnings unless --strict), 1 = violations.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter, toolList } from "./lib/frontmatter.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const agentsDir = resolve(arg("agents-dir", join(ROOT, ".claude/agents")));
const policy = JSON.parse(readFileSync(resolve(arg("policy", join(ROOT, "scripts/governance/agent-policy.json"))), "utf8"));
const STRICT = process.argv.includes("--strict");

// "claude-opus-5-5" -> "opus"; aliases pass through.
const family = (m) => (/opus/i.test(m) ? "opus" : /sonnet/i.test(m) ? "sonnet" : /haiku/i.test(m) ? "haiku" : /fable/i.test(m) ? "fable" : String(m));
const toolName = (t) => t.replace(/\(.*$/, "");

const errors = [];
const warnings = [];
const rows = [];
const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
const byName = new Map();
for (const f of files) {
  const { frontmatter } = splitFrontmatter(readFileSync(join(agentsDir, f), "utf8"));
  if (!frontmatter) { errors.push(`${f}: no YAML front matter`); continue; }
  byName.set(frontmatter.name || f.replace(/\.md$/, ""), { file: f, fm: frontmatter });
}

for (const [name, rule] of Object.entries(policy.agents)) {
  const entry = byName.get(name);
  if (!entry) { (STRICT ? errors : warnings).push(`${name}: .claude/agents/${name}.md not found (not written yet?)`); continue; }
  const { file, fm } = entry;
  const tag = `${file}`;
  for (const k of rule.requireFields || policy.global.requireFields) if (fm[k] === undefined || fm[k] === "") errors.push(`${tag}: missing required field "${k}"${k === "tools" ? " (omitted tools = inherits every tool, including MCP write tools)" : ""}`);
  const model = fm.model === undefined ? "" : String(fm.model);
  if (policy.global.forbiddenModels.includes(model)) errors.push(`${tag}: model "${model}" is not allowed (cost and behaviour must not depend on the caller's model)`);
  else if (model && !rule.models.includes(family(model))) errors.push(`${tag}: model "${model}" not in policy [${rule.models.join(", ")}]`);
  if (fm.effort !== undefined && !rule.effort.includes(String(fm.effort))) errors.push(`${tag}: effort "${fm.effort}" not in policy [${rule.effort.join(", ")}]`);
  if (fm.maxTurns !== undefined && !(Number(fm.maxTurns) > 0 && Number(fm.maxTurns) <= rule.maxTurns)) errors.push(`${tag}: maxTurns ${fm.maxTurns} exceeds policy ceiling ${rule.maxTurns}`);
  if (policy.global.forbiddenPermissionModes.includes(fm.permissionMode)) errors.push(`${tag}: permissionMode "${fm.permissionMode}" is forbidden`);
  const tools = toolList(fm.tools) || [];
  const names = tools.map(toolName);
  for (const t of rule.forbiddenTools) if (names.includes(t)) errors.push(`${tag}: tool "${t}" is forbidden for ${name}`);
  if (names.includes(policy.global.delegationTool) && !policy.global.delegationAllowedFor.includes(name)) {
    errors.push(`${tag}: "${policy.global.delegationTool}" in tools lets ${name} spawn subagents; the roster is flat (only ${policy.global.delegationAllowedFor.join(", ")} delegates)`);
  }
  rows.push([name, model || "-", String(fm.effort ?? "-"), String(fm.maxTurns ?? "-"), String(fm.permissionMode ?? "-"), names.join(" ") || "-"]);
}
for (const [name, { file }] of byName) if (!policy.agents[name]) warnings.push(`${file}: agent "${name}" has no policy entry (add it to agent-policy.json)`);

if (rows.length) {
  const head = ["agent", "model", "effort", "maxTurns", "permissionMode", "tools"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => c.padEnd(w[i])).join("  ");
  console.log(fmt(head));
  for (const r of rows) console.log(fmt(r));
  console.log("");
}
for (const w of warnings) console.log(`WARN   ${w}`);
for (const e of errors) console.log(`ERROR  ${e}`);
console.log(`\n${rows.length}/${Object.keys(policy.agents).length} roster agents checked, ${errors.length} violation(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
