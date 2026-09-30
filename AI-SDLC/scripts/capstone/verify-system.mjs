#!/usr/bin/env node
// verify-system.mjs: checks that the whole AI-SDLC system in this repo is wired together.
// Zero dependencies, Node 22. Course tooling (module 11-capstone), not a Claude Code feature.
//
//   node scripts/capstone/verify-system.mjs                 check the AI-SDLC/ this file lives in
//   node scripts/capstone/verify-system.mjs --root DIR      check another project root (used by the tests)
//   node scripts/capstone/verify-system.mjs --json          machine-readable report
//   node scripts/capstone/verify-system.mjs --no-spawn      skip checks that run other scripts
//   node scripts/capstone/verify-system.mjs --with-tests    also run every *.test.mjs and the harness node:test suite
//   node scripts/capstone/verify-system.mjs --with-maven    also run `mvn -q -B test` in sample-app/
// Exit codes: 0 no FAIL (WARN and SKIP allowed), 1 at least one FAIL, 2 usage error.
//
// Checks (one PASS/WARN/FAIL/SKIP row each):
//   roster          .claude/agents/<name>.md with matching `name:` and agents/<name>/CONTRACT.md, for all 7 roles
//   delegation      orchestrator tools list Agent(...) with exactly the six specialists; no specialist lists Agent
//   agent-skills    every `skills:` entry of every agent is a .claude/skills/<name>/SKILL.md that can be preloaded
//   settings        .claude/settings.json parses, uses known hook events, and every hook script path exists
//   hook-paths      hook script paths in agent and skill frontmatter exist
//   gate-settings   workflows/gates.settings.json parses and asks before Agent(developer); Agent(...) rules name real agents
//   mcp             .mcp.json parses, every server has a valid transport, stdio scripts exist, mcp__ rules name known servers
//   workflows       step tables in workflows/*.md and the entry-point skills name only roster agents and existing skills
//   claude-md       CLAUDE.md @imports resolve (recursively, max 4 hops); backticked repo paths exist
//   guard-reach     scripts a preloaded skill tells the agent to run are allowed by that agent's tool-guard bash-allow list
//   handoffs        every committed example run folder passes .claude/hooks/check-handoff.mjs
//   eval-replay     evaluations/harness/run-evals.mjs --mode replay passes its gates (offline, no API key)
//   sub-checkers    the module checkers that exist (agents, topology, policy, skill library, MCP lint) all exit 0
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SPECIALISTS = ["architect", "developer", "reviewer", "tester", "security", "sre"];
export const ROSTER = [...SPECIALISTS, "orchestrator"];
const BUILTIN_AGENTS = ["Explore", "Plan", "general-purpose", "claude", "statusline-setup", "claude-code-guide", "fork"];
// build/CLAUDE_CODE_FACTS.md section 4: the complete list of hook events.
export const HOOK_EVENTS = new Set([
  "SessionStart", "Setup", "UserPromptSubmit", "UserPromptExpansion", "PreToolUse", "PermissionRequest",
  "PermissionDenied", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Notification", "MessageDisplay",
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle",
  "InstructionsLoaded", "ConfigChange", "CwdChanged", "DirectoryAdded", "FileChanged", "WorktreeCreate",
  "WorktreeRemove", "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch", "Elicitation",
  "ElicitationResult", "SessionEnd",
]);
const MCP_TYPES = new Set(["stdio", "http", "streamable-http", "sse", "ws"]);
// Words a workflow step table may use for "who runs this step" besides the roster.
const STEP_ACTORS = new Set([...ROSTER, "human", "you", "none"]);

// ---------- small parsers ----------

/** Frontmatter of an agent or skill file: flat keys, inline or block lists, raw text for nested blocks. */
export function frontmatter(text) {
  const m = String(text).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return null;
  const raw = m[1];
  const fields = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "") {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]) && !/:\s/.test(lines[i + 1].replace(/^\s+-\s+/, ""))) {
        items.push(lines[++i].replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      }
      value = items.length ? items : "";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    fields[kv[1]] = value;
  }
  return { fields, raw, body: String(text).slice(m[0].length) };
}

/** Split a tools string on commas that are not inside parentheses: "Agent(a, b), Read" -> ["Agent(a, b)", "Read"]. */
export function splitTools(value) {
  if (Array.isArray(value)) return value;
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(value || "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Script paths a hook command runs, relative to the project root. */
export function scriptPathsInCommand(command) {
  const paths = new Set();
  const cmd = String(command);
  for (const m of cmd.matchAll(/\$\{?CLAUDE_PROJECT_DIR(?::-[^}]*)?\}?\/([^"'\s]+)/g)) paths.add(m[1]);
  if (!/CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT/.test(cmd)) {
    for (const m of cmd.matchAll(/(?:^|[\s"'])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)+\.(?:mjs|cjs|js|sh|py))\b/g)) paths.add(m[1].replace(/^\.\//, ""));
  }
  return [...paths];
}

/** Every `command:` value in a frontmatter block (agent or skill hooks). */
function frontmatterHookCommands(raw) {
  const out = [];
  for (const m of String(raw).matchAll(/^\s*command:\s*(.+)$/gm)) {
    let v = m[1].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    out.push(v);
  }
  return out;
}

/** Hook events named in a frontmatter hooks block (keys indented two spaces under `hooks:`). */
function frontmatterHookEvents(raw) {
  const m = String(raw).match(/^hooks:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m);
  if (!m) return [];
  return [...m[1].matchAll(/^ {2}([A-Za-z]+):\s*$/gm)].map((x) => x[1]);
}

/** Single-quoted arguments after `bash-allow` in a tool-guard hook command. */
export function bashAllowPrefixes(command) {
  const i = command.indexOf("bash-allow");
  if (i < 0) return null;
  return [...command.slice(i).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function cells(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Markdown tables whose header starts with `step | file` (workflow step tables). */
export function stepTables(text) {
  const tables = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*step\s*\|\s*file\s*\|/i.test(lines[i])) continue;
    const header = cells(lines[i]).map((c) => c.toLowerCase());
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) rows.push({ line: j + 1, cells: cells(lines[j]) });
    tables.push({ header, rows });
  }
  return tables;
}

/** Actors named in a "who / agent" cell: "sre and security **in parallel**" -> ["sre", "security"]. */
export function actorsInCell(cell) {
  const plain = cell.replace(/\([^)]*\)/g, " ").replace(/[*`]/g, " ");
  return plain.split(/\band\b|,|\+|\//).map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).map((s) => s.toLowerCase());
}

/** Backticked skill-like names in a cell: "`test-strategy`, `run-tests`" -> [...]; "none" -> []. */
function skillNamesInCell(cell) {
  return [...cell.matchAll(/`([a-z][a-z0-9-]+)`/g)].map((m) => m[1]);
}

/** @imports in a CLAUDE.md-style file, ignoring code spans and fenced blocks. */
export function importsIn(text) {
  const out = [];
  let fenced = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const noSpans = line.replace(/`[^`]*`/g, "");
    for (const m of noSpans.matchAll(/(?:^|\s)@((?:~\/|\/|\.{0,2}\/)?[\w.\-/]+(?:\\ [\w.\-/]+)*)/g)) {
      if (/^[\w.-]+$/.test(m[1]) && !m[1].includes(".")) continue; // @mention, not a path
      out.push(m[1].replace(/\\ /g, " "));
    }
  }
  return out;
}

// ---------- the checker ----------

export function verify(root, opts = {}) {
  const rows = [];
  const add = (status, check, detail) => rows.push({ status, check, detail });
  const p = (...parts) => join(root, ...parts);
  const read = (rel) => readFileSync(p(rel), "utf8");
  const exists = (rel) => existsSync(p(rel));
  const listDir = (rel) => (exists(rel) && statSync(p(rel)).isDirectory() ? readdirSync(p(rel)) : []);
  const skillExists = (name) => exists(join(".claude", "skills", name, "SKILL.md"));
  const node = process.execPath;
  const spawn = (args, extra = {}) => spawnSync(node, args, { cwd: root, encoding: "utf8", timeout: 120000, ...extra });
  const firstLine = (s) => String(s || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "";

  // roster
  const agents = {};
  for (const name of ROSTER) {
    const rel = join(".claude", "agents", `${name}.md`);
    const contract = join("agents", name, "CONTRACT.md");
    if (!exists(rel)) { add("FAIL", "roster", `${name}: ${rel} missing`); continue; }
    const fm = frontmatter(read(rel));
    if (!fm) { add("FAIL", "roster", `${name}: ${rel} has no YAML frontmatter`); continue; }
    agents[name] = fm;
    const problems = [];
    if (fm.fields.name !== name) problems.push(`name is "${fm.fields.name}"`);
    if (!fm.fields.description) problems.push("no description");
    if (!exists(contract)) problems.push(`${contract} missing`);
    if (problems.length) add("FAIL", "roster", `${name}: ${problems.join("; ")}`);
    else add("PASS", "roster", `${name}: agent file + ${contract}`);
  }
  const extraAgents = listDir(join(".claude", "agents")).filter((n) => n.endsWith(".md") && !ROSTER.includes(n.slice(0, -3)));
  if (extraAgents.length) add("WARN", "roster", `agent files outside the roster: ${extraAgents.join(", ")}`);

  // delegation
  if (agents.orchestrator) {
    const tools = splitTools(agents.orchestrator.fields.tools);
    const agentTool = tools.find((t) => /^(Agent|Task)\(/.test(t));
    if (!agentTool) add("FAIL", "delegation", "orchestrator tools have no Agent(...) allowlist (it could spawn any agent, or none)");
    else {
      const listed = agentTool.replace(/^(Agent|Task)\(|\)$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      const missing = SPECIALISTS.filter((a) => !listed.includes(a));
      const extra = listed.filter((a) => !SPECIALISTS.includes(a));
      if (missing.length || extra.length) add("FAIL", "delegation", `orchestrator Agent(...) list: missing [${missing.join(", ")}], not in roster [${extra.join(", ")}]`);
      else add("PASS", "delegation", "orchestrator delegates to exactly the six specialists");
    }
  }
  const nesting = SPECIALISTS.filter((a) => agents[a]).filter((a) => {
    const f = agents[a].fields;
    if (f.tools === undefined || f.tools === "") return !splitTools(f.disallowedTools).some((t) => /^(Agent|Task)$/.test(t));
    return splitTools(f.tools).some((t) => /^(Agent|Task)\b/.test(t));
  });
  if (nesting.length) add("FAIL", "delegation", `specialists that can spawn subagents (Agent in tools or tools omitted): ${nesting.join(", ")}`);
  else if (Object.keys(agents).length) add("PASS", "delegation", "no specialist can spawn subagents (roster is flat)");

  // agent-skills
  for (const [name, fm] of Object.entries(agents)) {
    const skills = Array.isArray(fm.fields.skills) ? fm.fields.skills : splitTools(fm.fields.skills);
    if (!skills.length) continue;
    const bad = [];
    for (const s of skills) {
      const rel = join(".claude", "skills", s, "SKILL.md");
      if (!exists(rel)) { bad.push(`${s} (no ${rel})`); continue; }
      const sf = frontmatter(read(rel));
      const dmi = sf && String(sf.fields["disable-model-invocation"] || "").toLowerCase();
      if (["true", "yes", "on", "1"].includes(dmi)) bad.push(`${s} (disable-model-invocation: true cannot be preloaded)`);
    }
    if (bad.length) add("FAIL", "agent-skills", `${name}: ${bad.join("; ")}`);
    else add("PASS", "agent-skills", `${name}: ${skills.join(", ")}`);
  }

  // settings
  const settingsRel = join(".claude", "settings.json");
  let settings = null;
  if (!exists(settingsRel)) add("FAIL", "settings", `${settingsRel} missing`);
  else {
    try { settings = JSON.parse(read(settingsRel)); } catch (e) { add("FAIL", "settings", `${settingsRel} is not valid JSON: ${e.message}`); }
  }
  if (settings) {
    const problems = [];
    const hooks = settings.hooks || {};
    let count = 0;
    for (const [event, groups] of Object.entries(hooks)) {
      if (!HOOK_EVENTS.has(event)) problems.push(`unknown hook event "${event}"`);
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of g.hooks || []) {
          if (h.type !== "command") continue;
          for (const s of scriptPathsInCommand(h.command || "")) {
            count++;
            if (!exists(s)) problems.push(`${event} hook script ${s} does not exist`);
          }
        }
      }
    }
    for (const key of ["allow", "ask", "deny"]) {
      const v = settings.permissions && settings.permissions[key];
      if (v !== undefined && !Array.isArray(v)) problems.push(`permissions.${key} is not an array`);
    }
    if (problems.length) add("FAIL", "settings", problems.join("; "));
    else add("PASS", "settings", `valid JSON, ${Object.keys(hooks).length} hook event(s), ${count} hook script path(s) exist`);
  }

  // hook-paths (frontmatter hooks in agents and skills)
  const fmFiles = [
    ...Object.keys(agents).map((n) => join(".claude", "agents", `${n}.md`)),
    ...listDir(join(".claude", "skills")).map((n) => join(".claude", "skills", n, "SKILL.md")).filter(exists),
  ];
  let hookScripts = 0;
  const hookProblems = [];
  const guards = {};
  for (const rel of fmFiles) {
    const fm = frontmatter(read(rel));
    if (!fm) continue;
    for (const ev of frontmatterHookEvents(fm.raw)) if (!HOOK_EVENTS.has(ev)) hookProblems.push(`${rel}: unknown hook event "${ev}"`);
    for (const c of frontmatterHookCommands(fm.raw)) {
      for (const s of scriptPathsInCommand(c)) { hookScripts++; if (!exists(s)) hookProblems.push(`${rel}: hook script ${s} does not exist`); }
      const prefixes = bashAllowPrefixes(c);
      if (prefixes && rel.includes(`${sep}agents${sep}`)) guards[fm.fields.name] = prefixes;
    }
  }
  if (hookProblems.length) add("FAIL", "hook-paths", hookProblems.join("; "));
  else add("PASS", "hook-paths", `${hookScripts} frontmatter hook script reference(s) in ${fmFiles.length} agent/skill files exist`);

  // gate-settings
  const gateRel = join("workflows", "gates.settings.json");
  const agentRuleNames = [];
  if (!exists(gateRel)) add("FAIL", "gate-settings", `${gateRel} missing (gate G1 has no mechanism)`);
  else {
    try {
      const g = JSON.parse(read(gateRel));
      const ask = (g.permissions && g.permissions.ask) || [];
      if (ask.includes("Agent(developer)")) add("PASS", "gate-settings", `${gateRel} asks before every Agent(developer) launch (G1)`);
      else add("FAIL", "gate-settings", `${gateRel} has no "Agent(developer)" ask rule (G1)`);
      for (const k of ["allow", "ask", "deny"]) agentRuleNames.push(...((g.permissions && g.permissions[k]) || []));
    } catch (e) { add("FAIL", "gate-settings", `${gateRel} is not valid JSON: ${e.message}`); }
  }
  if (settings && settings.permissions) for (const k of ["allow", "ask", "deny"]) agentRuleNames.push(...(settings.permissions[k] || []));
  const badAgentRules = agentRuleNames
    .map((r) => String(r).match(/^(?:Agent|Task)\(([^:)]+)\)$/)).filter(Boolean).map((m) => m[1].trim())
    .filter((n) => !ROSTER.includes(n) && !BUILTIN_AGENTS.includes(n));
  if (badAgentRules.length) add("FAIL", "gate-settings", `Agent(...) rules name agents that do not exist: ${badAgentRules.join(", ")}`);

  // mcp
  const mcpRel = ".mcp.json";
  let servers = null;
  if (!exists(mcpRel)) add("WARN", "mcp", ".mcp.json missing (no project MCP servers)");
  else {
    try {
      const mcp = JSON.parse(read(mcpRel));
      servers = mcp.mcpServers;
      if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error('no "mcpServers" object');
      const problems = [];
      for (const [name, s] of Object.entries(servers)) {
        const type = s.type || (s.url ? null : "stdio");
        if (!type) problems.push(`${name}: has url but no type`);
        else if (!MCP_TYPES.has(type)) problems.push(`${name}: unknown type "${type}"`);
        if (type === "stdio") {
          if (!s.command) problems.push(`${name}: stdio server without command`);
          for (const a of s.args || []) {
            const m = String(a).match(/^\$\{CLAUDE_PROJECT_DIR(?::-[^}]*)?\}\/(.+)$/);
            if (m && !exists(m[1])) problems.push(`${name}: ${m[1]} does not exist`);
          }
        }
      }
      if (problems.length) add("FAIL", "mcp", problems.join("; "));
      else add("PASS", "mcp", `valid JSON, servers: ${Object.keys(servers).join(", ")}`);
    } catch (e) { add("FAIL", "mcp", `${mcpRel}: ${e.message}`); }
  }
  if (settings && servers) {
    const rules = ["allow", "ask", "deny"].flatMap((k) => (settings.permissions && settings.permissions[k]) || []);
    const unknown = [...new Set(rules.map((r) => String(r).match(/^mcp__([A-Za-z0-9_-]+?)(?:__|$)/)).filter(Boolean).map((m) => m[1]))]
      .filter((n) => !(n in servers) && n !== "*" && !n.startsWith("plugin_"));
    if (unknown.length) add("WARN", "mcp", `permission rules name MCP servers not in .mcp.json: ${unknown.join(", ")} (fine only if they come from user scope or a connector)`);
  }

  // workflows
  const wfFiles = [
    ...listDir("workflows").filter((n) => n.endsWith(".md") && n !== "README.md").map((n) => join("workflows", n)),
    ...["feature", "bug-fix", "incident"].map((n) => join(".claude", "skills", n, "SKILL.md")).filter(exists),
  ];
  if (!wfFiles.length) add("FAIL", "workflows", "no workflow specs in workflows/");
  for (const rel of wfFiles) {
    const problems = [];
    let steps = 0;
    for (const t of stepTables(read(rel))) {
      const who = t.header.findIndex((h) => h === "agent" || h === "who");
      const sk = t.header.indexOf("skill");
      for (const r of t.rows) {
        steps++;
        if (who >= 0) {
          const cell = r.cells[who] || "";
          for (const a of actorsInCell(cell)) if (!STEP_ACTORS.has(a)) problems.push(`line ${r.line}: "${a}" is not a roster agent`);
          for (const s of skillNamesInCell((cell.match(/\(([^)]*)\)/) || [])[1] || "")) if (!skillExists(s)) problems.push(`line ${r.line}: skill ${s} not in .claude/skills/`);
        }
        if (sk >= 0) for (const s of skillNamesInCell(r.cells[sk] || "")) if (!skillExists(s)) problems.push(`line ${r.line}: skill ${s} not in .claude/skills/`);
      }
    }
    if (problems.length) add("FAIL", "workflows", `${rel}: ${problems.join("; ")}`);
    else if (steps) add("PASS", "workflows", `${rel}: ${steps} step row(s), roster agents and existing skills only`);
  }
  if (agents.orchestrator) {
    const specs = [...agents.orchestrator.body.matchAll(/`(workflows\/[\w./-]+\.md)`/g)].map((m) => m[1]);
    const missing = [...new Set(specs)].filter((s) => !exists(s));
    if (missing.length) add("FAIL", "workflows", `orchestrator names specs that do not exist: ${missing.join(", ")}`);
  }

  // claude-md
  if (!exists("CLAUDE.md")) add("FAIL", "claude-md", "CLAUDE.md missing");
  else {
    const seen = new Set();
    const missing = [];
    const walk = (rel, depth) => {
      if (depth > 4 || seen.has(rel)) return;
      seen.add(rel);
      for (const imp of importsIn(read(rel))) {
        if (imp.startsWith("~/") || imp.startsWith("/")) continue; // user/absolute imports are machine-specific
        const target = relative(root, resolve(dirname(p(rel)), imp));
        if (!existsSync(p(target))) missing.push(`${rel} -> @${imp}`);
        else if (depth < 4 && statSync(p(target)).isFile()) walk(target, depth + 1);
      }
    };
    walk("CLAUDE.md", 0);
    const lines = read("CLAUDE.md").split(/\r?\n/).length;
    if (missing.length) add("FAIL", "claude-md", `unresolved @imports: ${missing.join(", ")}`);
    else add("PASS", "claude-md", `${seen.size - 1} @import(s) resolve; ${lines} lines`);
    const named = [...read("CLAUDE.md").matchAll(/`([\w.-]+(?:\/[\w.-]+)*\/?)`/g)].map((m) => m[1])
      .filter((s) => s.includes("/") && !s.startsWith(".ai-sdlc") && !/^https?:/.test(s));
    const gone = [...new Set(named)].filter((s) => !exists(s.replace(/\/$/, "")));
    if (gone.length) add("WARN", "claude-md", `paths named in CLAUDE.md that do not exist: ${gone.join(", ")}`);
    if (lines > 200) add("WARN", "claude-md", `CLAUDE.md has ${lines} lines (target under 200)`);
  }

  // guard-reach
  // agents/tool-guard.mjs rewrites absolute paths inside the project to relative form before
  // matching, so a relative prefix also covers the ${CLAUDE_SKILL_DIR}-expanded absolute call.
  const guardNormalizes = exists(join("agents", "tool-guard.mjs")) &&
    /export function normalizeSegment\b/.test(read(join("agents", "tool-guard.mjs")));
  for (const [name, prefixes] of Object.entries(guards)) {
    const fm = agents[name];
    const skills = fm ? (Array.isArray(fm.fields.skills) ? fm.fields.skills : splitTools(fm.fields.skills)) : [];
    for (const s of skills) {
      const rel = join(".claude", "skills", s, "SKILL.md");
      if (!exists(rel)) continue;
      const text = read(rel);
      const scripts = new Set();
      const viaSkillDir = new Set();
      for (const line of text.split(/\r?\n/)) {
        if (!/\bnode\s/.test(line)) continue;
        for (const m of line.matchAll(/(?:\$\{CLAUDE_SKILL_DIR\}|[\w.*/-]*?\/?(?:\.claude\/skills\/)?[\w-]*)\/?(scripts\/[\w.-]+\.mjs)/g)) {
          scripts.add(m[1]);
          if (m[0].startsWith("${CLAUDE_SKILL_DIR}")) viaSkillDir.add(m[1]);
        }
      }
      for (const script of scripts) {
        const want = `${s}/${script}`;
        const hit = prefixes.find((pfx) => pfx.startsWith("node ") && pfx.includes(want));
        if (!hit) add("FAIL", "guard-reach", `${name}: preloaded skill ${s} runs ${want}, but ${name}'s tool-guard bash-allow list has no "node .claude/skills/${want}" prefix, so the PreToolUse hook blocks it (exit 2)`);
        else if (viaSkillDir.has(script) && !guardNormalizes && !hit.includes("CLAUDE_SKILL_DIR") && !hit.startsWith("node /"))
          add("WARN", "guard-reach", `${name}: ${s} invokes ${script} as \${CLAUDE_SKILL_DIR}/${script}; the guard prefix "${hit}" is relative and matched literally, so the call passes only if the agent runs the relative form`);
        else add("PASS", "guard-reach", `${name}: ${want} allowed by its Bash guard${viaSkillDir.has(script) ? " (relative and ${CLAUDE_SKILL_DIR} forms)" : ""}`);
      }
    }
  }

  // handoffs
  const runFolders = [
    ...listDir(join("workflows", "examples")).map((n) => join("workflows", "examples", n)),
    ...listDir(join("docs", "capstone", "example-runs")).map((n) => join("docs", "capstone", "example-runs", n)),
  ].filter((d) => statSync(p(d)).isDirectory() && readdirSync(p(d)).some((n) => /^\d{2}-.*\.md$/.test(n)));
  const checker = join(".claude", "hooks", "check-handoff.mjs");
  if (opts.spawn === false) add("SKIP", "handoffs", "--no-spawn");
  else if (!exists(checker)) add(runFolders.length ? "FAIL" : "SKIP", "handoffs", `${checker} missing`);
  else if (!runFolders.length) add("SKIP", "handoffs", "no example run folders");
  else for (const d of runFolders) {
    const r = spawn([checker, d]);
    const n = (r.stdout.match(/^PASS /gm) || []).length;
    const bad = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("FAIL")).map((l) => l.replace(/^FAIL\s+/, ""));
    if (r.status === 0) add("PASS", "handoffs", `${d}: ${n} handoff(s) valid`);
    else add("FAIL", "handoffs", `${d}: invalid ${bad.join(", ") || firstLine(r.stderr)}`);
  }

  // eval-replay
  const harness = join("evaluations", "harness", "run-evals.mjs");
  if (opts.spawn === false) add("SKIP", "eval-replay", "--no-spawn");
  else if (!exists(harness)) add("SKIP", "eval-replay", `${harness} not present (module 09)`);
  else {
    const r = spawn([harness, "--mode", "replay", "--no-write"]);
    const summary = r.stdout.split(/\r?\n/).filter((l) => /gates (PASS|FAIL)/.test(l)).map((l) => l.replace(/\s+/g, " ").trim());
    if (r.status === 0) add("PASS", "eval-replay", summary.join(" | ") || "gates pass");
    else add("FAIL", "eval-replay", `exit ${r.status}: ${summary.join(" | ") || firstLine(r.stderr)}`);
  }

  // sub-checkers
  const subs = [
    ["agents/check-agents.mjs", [], "agent contracts (module 05)"],
    ["workflows/composition/check-roster-flat.mjs", [], "delegation topology (module 07)"],
    ["scripts/governance/check-agent-policy.mjs", [], "model/turn policy (module 10)"],
    ["scripts/governance/validate-skill-library.mjs", [], "skill library (module 10)"],
    ["scripts/automation/check-mcp-config.mjs", [], ".mcp.json lint (module 06)"],
  ];
  for (const [script, args, what] of subs) {
    if (opts.spawn === false) { add("SKIP", "sub-checkers", `${script}: --no-spawn`); continue; }
    if (!exists(script)) { add("SKIP", "sub-checkers", `${script} not present`); continue; }
    const r = spawn([script, ...args]);
    if (r.status === 0) add("PASS", "sub-checkers", `${script}: ${what}`);
    else add("FAIL", "sub-checkers", `${script} exit ${r.status}: ${firstLine(r.stdout) || firstLine(r.stderr)}`);
  }

  // optional: every test file, and Maven
  if (opts.withTests) {
    const tests = [];
    const walk = (rel) => {
      for (const n of listDir(rel)) {
        if (["node_modules", ".git", "target", ".ai-sdlc"].includes(n)) continue;
        const r = join(rel, n);
        if (statSync(p(r)).isDirectory()) walk(r);
        else if (n.endsWith(".test.mjs")) tests.push(r);
      }
    };
    walk(".");
    for (const t of tests.sort()) {
      if (t.endsWith(join("capstone", "verify-system.test.mjs"))) continue; // avoid recursion
      const r = t.includes(`${sep}test${sep}`) || t.includes("harness") ? spawn(["--test", t]) : spawn([t]);
      add(r.status === 0 ? "PASS" : "FAIL", "tests", `${t}${r.status === 0 ? "" : ` exit ${r.status}: ${firstLine(r.stdout) || firstLine(r.stderr)}`}`);
    }
  }
  if (opts.withMaven) {
    if (!exists(join("sample-app", "pom.xml"))) add("SKIP", "maven", "no sample-app/pom.xml");
    else {
      const r = spawnSync("mvn", ["-q", "-B", "test"], { cwd: p("sample-app"), encoding: "utf8", timeout: 600000 });
      add(r.status === 0 ? "PASS" : "FAIL", "maven", `cd sample-app && mvn -q -B test exit ${r.status}`);
    }
  }
  return rows;
}

export function render(rows) {
  const w = Math.max(...rows.map((r) => r.check.length), 5);
  const out = [`${"STATUS".padEnd(6)}  ${"CHECK".padEnd(w)}  DETAIL`];
  for (const r of rows) out.push(`${r.status.padEnd(6)}  ${r.check.padEnd(w)}  ${r.detail}`);
  const c = (s) => rows.filter((r) => r.status === s).length;
  out.push("", `verify-system: ${c("PASS")} pass, ${c("WARN")} warn, ${c("FAIL")} fail, ${c("SKIP")} skip -> ${c("FAIL") ? "NOT WIRED" : "WIRED"}`);
  return out.join("\n");
}

function main(argv) {
  const opts = { root: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), json: false, spawn: true, withTests: false, withMaven: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") { if (!argv[i + 1]) return usage("--root needs a directory"); opts.root = resolve(argv[++i]); }
    else if (a === "--json") opts.json = true;
    else if (a === "--no-spawn") opts.spawn = false;
    else if (a === "--with-tests") opts.withTests = true;
    else if (a === "--with-maven") opts.withMaven = true;
    else if (a === "-h" || a === "--help") { console.log("usage: verify-system.mjs [--root DIR] [--json] [--no-spawn] [--with-tests] [--with-maven]"); return 0; }
    else return usage(`unknown option ${a}`);
  }
  if (!existsSync(opts.root) || !statSync(opts.root).isDirectory()) return usage(`not a directory: ${opts.root}`);
  const rows = verify(opts.root, opts);
  console.log(opts.json ? JSON.stringify({ root: opts.root, rows }, null, 2) : render(rows));
  return rows.some((r) => r.status === "FAIL") ? 1 : 0;
}

function usage(msg) {
  console.error(`verify-system: ${msg}\nusage: verify-system.mjs [--root DIR] [--json] [--no-spawn] [--with-tests] [--with-maven]`);
  return 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));
