#!/usr/bin/env node
// check-roster-flat.mjs: lint .claude/agents/*.md for the course's delegation topology.
//   - roster agents (architect, developer, reviewer, tester, security, sre) must not be able to
//     spawn subagents: `tools` must be present and must not contain Agent/Task, unless
//     `disallowedTools` removes Agent. An omitted `tools` inherits every tool, including Agent.
//   - a parenthesised Agent(...) list in a non-orchestrator agent is flagged: Claude Code ignores
//     the list in subagent definitions, so it restricts nothing.
//   - the orchestrator must list Agent(...) with roster agents only, and no Edit/Bash.
// Usage: node workflows/composition/check-roster-flat.mjs [agents-dir]   (default .claude/agents)
// Exit 0 = topology OK, 1 = at least one error.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const ROSTER = ["architect", "developer", "reviewer", "tester", "security", "sre"];

/** Minimal frontmatter reader for `name`, `tools`, `disallowedTools` (string or YAML list). */
export function readAgent(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z]+):\s*(.*)$/);
    if (!kv || !["name", "tools", "disallowedTools"].includes(kv[1])) continue;
    if (kv[2].trim()) { out[kv[1]] = kv[2].trim(); continue; }
    const items = [];
    while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) items.push(lines[++i].replace(/^\s+-\s+/, "").trim());
    out[kv[1]] = items.join(", ");
  }
  return out;
}

/** Split "Agent(a, b), Read, Bash(git diff *)" on top-level commas. */
export function splitTools(s) {
  if (s == null) return null;
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of String(s).replace(/^["']|["']$/g, "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const isAgentTool = (t) => /^(Agent|Task)(\(|$)/.test(t);

export function lint(agents) {
  const errors = [], warnings = [];
  for (const { file, fm } of agents) {
    if (!fm || !fm.name) { errors.push(`${file}: no frontmatter name`); continue; }
    const tools = splitTools(fm.tools);
    const denied = splitTools(fm.disallowedTools) || [];
    const agentDenied = denied.some((t) => /^(Agent|Task)$/.test(t));
    if (fm.name === "orchestrator") {
      const a = (tools || []).find(isAgentTool);
      if (!a || !a.includes("(")) errors.push(`${file}: orchestrator must list Agent(<roster types>) in tools`);
      else {
        const types = a.slice(a.indexOf("(") + 1, a.lastIndexOf(")")).split(",").map((x) => x.trim()).filter(Boolean);
        const bad = types.filter((t) => !ROSTER.includes(t));
        if (bad.length) errors.push(`${file}: orchestrator may only delegate to roster agents, found ${bad.join(", ")}`);
      }
      for (const t of tools || []) if (/^(Edit|Bash|NotebookEdit)(\(|$)/.test(t)) errors.push(`${file}: orchestrator must not have ${t}`);
      continue;
    }
    if (tools === null && !agentDenied) {
      errors.push(`${file}: "${fm.name}" omits tools, so it inherits every tool including Agent; list tools explicitly or add disallowedTools: Agent`);
      continue;
    }
    const agentTool = (tools || []).find(isAgentTool);
    if (agentTool && agentTool.includes("(")) warnings.push(`${file}: "${agentTool}" in a subagent definition: the type list is ignored (only claude --agent main threads honour it)`);
    if (agentTool && !agentDenied) {
      const msg = `${file}: "${fm.name}" can spawn subagents (${agentTool})`;
      if (ROSTER.includes(fm.name)) errors.push(`${msg}; roster agents stay at depth 1, remove Agent from tools`);
      else warnings.push(`${msg}; nested delegation, check CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`);
    }
  }
  return { errors, warnings };
}

export function loadAgents(dir) {
  return readdirSync(dir).filter((n) => n.endsWith(".md")).sort()
    .map((n) => ({ file: join(dir, n), fm: readAgent(readFileSync(join(dir, n), "utf8")) }));
}

if (process.argv[1] && new URL(import.meta.url).pathname === (await import("node:path")).resolve(process.argv[1])) {
  const dir = process.argv[2] || ".claude/agents";
  if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); process.exit(1); }
  const agents = loadAgents(dir);
  const { errors, warnings } = lint(agents);
  for (const a of agents) {
    const t = splitTools(a.fm && a.fm.tools);
    console.log(`${(a.fm && a.fm.name) || a.file}`.padEnd(14) + (t ? t.join(", ") : "(tools omitted: inherits all)"));
  }
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(errors.length ? `\n${errors.length} error(s)` : `\nOK  roster is flat: only the orchestrator delegates (${agents.length} agent files)`);
  process.exit(errors.length ? 1 : 0);
}
