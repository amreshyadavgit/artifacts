#!/usr/bin/env node
// verify-system.mjs: checks that the whole AI-SDLC system in this repo (Frappe edition) is wired together.
// Zero dependencies, Node 22. Course tooling (module 11-capstone), not a Claude Code feature.
//
//   node scripts/capstone/verify-system.mjs                        check the AI-SDLC-frappe/ this file lives in
//   node scripts/capstone/verify-system.mjs --bench /home/user/frappe-bench   also check the bench-facing pieces
//   node scripts/capstone/verify-system.mjs --root DIR             check another project root (used by the tests)
//   node scripts/capstone/verify-system.mjs --json                 machine-readable report
//   node scripts/capstone/verify-system.mjs --no-spawn             skip checks that run other scripts
//   node scripts/capstone/verify-system.mjs --with-tests           also run every *.test.mjs and the app's unit tests
// Bench options (only with --bench):
//   --site S          site to ask (default test.localhost)
//   --bench-user U    run bench as U through `su - U -c` (default: run `bench` directly; as root that works
//                     when common_site_config.json sets frappe_user, which setup-bench.sh does)
//   --bench-bin PATH  bench executable (default `bench` on PATH; the tests use a fake)
//   --lock FILE       hold `flock FILE` around the bench call (default /tmp/spice-bench.lock when that file
//                     and flock exist, i.e. in the shared course container); --no-lock disables it
// Other: --app-dir DIR (default sample-app/spice_lite): the Frappe app the agents work on.
// Exit codes: 0 no FAIL (WARN and SKIP allowed), 1 at least one FAIL, 2 usage error.
//
// Checks (one PASS/WARN/FAIL/SKIP row each):
//   roster          .claude/agents/<name>.md with matching `name:` and agents/<name>/CONTRACT.md, for all 7 roles
//   delegation      orchestrator tools list Agent(...) with exactly the six specialists; no specialist can spawn
//   agent-skills    every `skills:` entry of every agent is a .claude/skills/<name>/SKILL.md that can be preloaded
//   settings        .claude/settings.json parses, uses documented hook events, every hook command's script exists
//   bench-rules     (Frappe) site_config reads denied, migrate asked, drop-site/reinstall denied, no allow rule
//                   that grants console/execute
//   hook-paths      hook script paths and hook events in agent and skill frontmatter exist / are documented
//   gate-settings   workflows/gates.settings.json asks before Agent(developer); Agent(...) rules name real agents
//   mcp             .mcp.json parses, valid transports, stdio scripts exist, mcp__ rules name known servers
//   workflows       step tables in workflows/*.md and the entry-point skills name only roster agents and real skills
//   claude-md       CLAUDE.md @imports resolve (max 4 hops); backticked repo paths exist
//   guard-reach     every skill script a preloaded skill tells an agent to run passes that agent's tool-guard
//                   (the real agents/tool-guard.mjs checkBash is imported); skill allowed-tools the guard blocks: WARN
//   app-layout      (Frappe) pyproject.toml, <app>/__init__.py, hooks.py (app_name), modules.txt, patches.txt
//   hooks-py        (Frappe) every "<app>.x.y" dotted path in hooks.py resolves to a module and a def
//   modules         (Frappe) every modules.txt line is a package; every package with doctype/ is listed
//   patches         (Frappe) every patches.txt entry resolves to a module with `def execute`
//   doctypes        (Frappe) every DocType folder has __init__.py, <x>.json, <x>.py (class), test_<x>.py
//   handoffs        every committed example run folder passes .claude/hooks/check-handoff.mjs
//   eval-replay     evaluations/harness/run-evals.mjs --mode replay passes its gates (offline, no API key)
//   sub-checkers    the module checkers that exist (agents, topology, policy, skill library, MCP, patches, DocType lint)
//   bench           (--bench) bench dir, apps/<app> is this repo's app, sites/apps.txt, `bench --site S list-apps`
//                   includes the app and its required_apps; CLAUDE.md names the same bench
//   eval-traps      (--bench) run-evals.mjs --verify-traps against <bench>/apps/frappe
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { join, resolve, dirname, relative, sep, basename, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const STEP_ACTORS = new Set([...ROSTER, "human", "you", "none"]);
export const DEFAULT_LOCK = "/tmp/spice-bench.lock";

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
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]) && !/^[\w-]+:\s/.test(lines[i + 1].replace(/^\s+-\s+/, ""))) {
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

/** Frappe's scrub(): "SL Patient" -> "sl_patient", "Clinical" -> "clinical". */
export const scrub = (s) => String(s).trim().replace(/ /g, "_").replace(/-/g, "_").toLowerCase();
/** Controller class name Frappe expects for a DocType: "SL Patient" -> "SLPatient". */
export const controllerClass = (name) => String(name).replace(/[ \-]/g, "");

/** patches.txt entries: [{ line, section, text, dotted }] (dotted = null for execute: lines). */
export function patchEntries(text) {
  const out = [];
  let section = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1]; return; }
    const body = line.replace(/^finally:/, "");
    out.push({ line: i + 1, section, text: line, dotted: body.startsWith("execute:") ? null : body.split(/\s+/)[0] });
  });
  return out;
}

/** Resolve "app.pkg.mod.fn" (want = "fn") or "app.pkg.mod" (want = null) to a file under appDir. */
export function resolveDotted(appDir, dotted, { fnLast = true } = {}) {
  const parts = dotted.split(".");
  const tryModule = (mod) => {
    const base = join(appDir, ...mod);
    for (const f of [`${base}.py`, join(base, "__init__.py")]) if (existsSync(f)) return f;
    return null;
  };
  if (fnLast && parts.length > 1) {
    const file = tryModule(parts.slice(0, -1));
    const fn = parts[parts.length - 1];
    if (file) {
      const src = readFileSync(file, "utf8");
      if (new RegExp(`^(def|class)\\s+${fn}\\b|^${fn}\\s*=`, "m").test(src)) return { ok: true, file };
      return { ok: false, why: `${relative(appDir, file)} has no def ${fn}` };
    }
  }
  const file = tryModule(parts);
  if (file) return { ok: true, file };
  return { ok: false, why: `no module ${parts.slice(0, fnLast ? -1 : undefined).join("/")}.py` };
}

/** Commands a SKILL.md body tells the agent to run with one of the skill's own scripts. */
export function skillScriptCommands(body) {
  const out = [];
  let fenced = false;
  const isScriptCmd = (s) => /(^|\s|&&|\|)\s*(node|python3?)\s+\S*(\$\{CLAUDE_SKILL_DIR\}|\.claude\/skills\/)\S*scripts\/\S+/.test(s);
  for (const line of String(body).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) {
      const t = line.trim().replace(/\s+#.*$/, "");
      if (t && !t.startsWith("#") && isScriptCmd(t)) out.push(t);
      continue;
    }
    for (const m of line.matchAll(/(!?)`([^`]+)`/g)) {
      if (m[1] === "!") continue; // `!` injection: runs at skill load in the invoking session, not as the agent's Bash
      if (isScriptCmd(m[2])) out.push(m[2].trim());
    }
  }
  return [...new Set(out)];
}

/** Turn a skill command template into a concrete command the guard can judge. */
export function concreteCommand(template, skillDirAbs, root) {
  return template
    .replaceAll("${CLAUDE_SKILL_DIR}", skillDirAbs)
    .replaceAll("${CLAUDE_PROJECT_DIR}", root)
    .replace(/\$ARGUMENTS(\[\d+\])?/g, "arg")
    .replace(/\$(\d|[A-Za-z_]\w*)/g, "arg")
    .replace(/<[^>\s]+>/g, "placeholder")
    .replace(/\s\*(\s|$)/g, " arg$1")
    .trim();
}

// ---------- the checker ----------

export async function verify(root, opts = {}) {
  const rows = [];
  const add = (status, check, detail) => rows.push({ status, check, detail });
  const p = (...parts) => join(root, ...parts);
  const read = (rel) => readFileSync(p(rel), "utf8");
  const exists = (rel) => existsSync(p(rel));
  const isDir = (rel) => exists(rel) && statSync(p(rel)).isDirectory();
  const listDir = (rel) => (isDir(rel) ? readdirSync(p(rel)) : []);
  const skillExists = (name) => exists(join(".claude", "skills", name, "SKILL.md"));
  const node = process.execPath;
  const spawn = (args, extra = {}) => spawnSync(node, args, { cwd: root, encoding: "utf8", timeout: 180000, ...extra });
  const lastLine = (s) => String(s || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "";

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
  const toolsOf = (fm) => splitTools(fm.fields.tools);
  const disallowedOf = (fm) => splitTools(fm.fields.disallowedTools);
  const hasTool = (fm, t) => (fm.fields.tools === undefined || fm.fields.tools === "" || toolsOf(fm).includes(t)) && !disallowedOf(fm).includes(t);

  // delegation
  if (agents.orchestrator) {
    const agentTool = toolsOf(agents.orchestrator).find((t) => /^(Agent|Task)\(/.test(t));
    if (!agentTool) add("FAIL", "delegation", "orchestrator tools have no Agent(...) allowlist (it could spawn any agent, or none)");
    else {
      const listed = agentTool.replace(/^(Agent|Task)\(|\)$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      const missing = SPECIALISTS.filter((a) => !listed.includes(a));
      const extra = listed.filter((a) => !SPECIALISTS.includes(a));
      if (missing.length || extra.length) add("FAIL", "delegation", `orchestrator Agent(...) list: missing [${missing.join(", ")}], not in roster [${extra.join(", ")}]`);
      else add("PASS", "delegation", "orchestrator delegates to exactly the six specialists");
    }
    const unsafe = ["Bash", "Edit"].filter((t) => toolsOf(agents.orchestrator).includes(t));
    if (unsafe.length) add("FAIL", "delegation", `orchestrator lists ${unsafe.join(", ")}: it must never run bench or edit code`);
  }
  const nesting = SPECIALISTS.filter((a) => agents[a]).filter((a) => {
    const f = agents[a].fields;
    if (f.tools === undefined || f.tools === "") return !disallowedOf(agents[a]).some((t) => /^(Agent|Task)$/.test(t));
    return toolsOf(agents[a]).some((t) => /^(Agent|Task)\b/.test(t));
  });
  if (nesting.length) add("FAIL", "delegation", `specialists that can spawn subagents (Agent in tools or tools omitted): ${nesting.join(", ")}`);
  else if (Object.keys(agents).length) add("PASS", "delegation", "no specialist can spawn subagents (roster is flat)");

  // agent-skills
  const skillsOf = (fm) => (Array.isArray(fm.fields.skills) ? fm.fields.skills : splitTools(fm.fields.skills));
  for (const [name, fm] of Object.entries(agents)) {
    const skills = skillsOf(fm);
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
  const rulesOf = (s, k) => (s && s.permissions && Array.isArray(s.permissions[k]) ? s.permissions[k] : []);
  if (settings) {
    const problems = [];
    const hooks = settings.hooks || {};
    let count = 0;
    for (const [event, groups] of Object.entries(hooks)) {
      if (!HOOK_EVENTS.has(event)) problems.push(`unknown hook event "${event}"`);
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of g.hooks || []) {
          if (h.type !== "command") continue;
          const scripts = scriptPathsInCommand(h.command || "");
          if (!scripts.length) problems.push(`${event} hook command has no resolvable script path: ${h.command}`);
          for (const s of scripts) { count++; if (!exists(s)) problems.push(`${event} hook script ${s} does not exist`); }
        }
      }
    }
    for (const key of ["allow", "ask", "deny"]) {
      const v = settings.permissions && settings.permissions[key];
      if (v !== undefined && !Array.isArray(v)) problems.push(`permissions.${key} is not an array`);
    }
    if (problems.length) add("FAIL", "settings", problems.join("; "));
    else add("PASS", "settings", `valid JSON, ${Object.keys(hooks).length} hook event(s), ${count} hook script path(s) exist`);

    // bench-rules (Frappe)
    const deny = rulesOf(settings, "deny"), ask = rulesOf(settings, "ask"), allow = rulesOf(settings, "allow");
    const br = [];
    for (const f of ["site_config.json", "common_site_config.json"]) if (!deny.some((r) => /^Read\(/.test(r) && r.includes(f))) br.push(`no Read(...) deny rule for ${f}`);
    if (!ask.some((r) => /^Bash\(bench .*migrate/.test(r)) && !deny.some((r) => /^Bash\(bench .*migrate/.test(r))) br.push("bench migrate is neither ask nor deny");
    for (const c of ["drop-site", "reinstall"]) if (!deny.some((r) => r.startsWith("Bash(") && r.includes(c))) br.push(`bench ${c} is not denied`);
    const grants = allow.filter((r) => /^Bash\((?!.*run-tests).*\bbench\b.*\b(console|execute|\*)\b/.test(r) || r === "Bash" || r === "Bash(*)");
    if (grants.length) br.push(`allow rules grant console/execute or any bench command: ${grants.join(", ")}`);
    if (br.length) add("FAIL", "bench-rules", br.join("; "));
    else add("PASS", "bench-rules", "site_config reads denied, migrate asks, drop-site and reinstall denied, no allow rule grants console/execute");
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
      if (rulesOf(g, "ask").includes("Agent(developer)")) add("PASS", "gate-settings", `${gateRel} asks before every Agent(developer) launch (G1)`);
      else add("FAIL", "gate-settings", `${gateRel} has no "Agent(developer)" ask rule (G1)`);
      for (const k of ["allow", "ask", "deny"]) agentRuleNames.push(...rulesOf(g, k));
    } catch (e) { add("FAIL", "gate-settings", `${gateRel} is not valid JSON: ${e.message}`); }
  }
  for (const k of ["allow", "ask", "deny"]) agentRuleNames.push(...rulesOf(settings, k));
  const badAgentRules = agentRuleNames
    .map((r) => String(r).match(/^(?:Agent|Task)\(([^:)]+)\)$/)).filter(Boolean).map((m) => m[1].trim())
    .filter((n) => !ROSTER.includes(n) && !BUILTIN_AGENTS.includes(n));
  if (badAgentRules.length) add("FAIL", "gate-settings", `Agent(...) rules name agents that do not exist: ${badAgentRules.join(", ")}`);

  // mcp
  let servers = null;
  if (!exists(".mcp.json")) add("WARN", "mcp", ".mcp.json missing (no project MCP servers)");
  else {
    try {
      const mcp = JSON.parse(read(".mcp.json"));
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
    } catch (e) { add("FAIL", "mcp", `.mcp.json: ${e.message}`); }
  }
  if (settings && servers) {
    const rules = ["allow", "ask", "deny"].flatMap((k) => rulesOf(settings, k));
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

  // app dir (used by claude-md path resolution and the Frappe checks)
  const appRel = opts.appDir ? (isAbsolute(opts.appDir) ? relative(root, opts.appDir) : opts.appDir) : join("sample-app", "spice_lite");
  const app = basename(appRel);
  const appPkg = join(appRel, app);

  // claude-md
  let claudeBench = null;
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
    const text = read("CLAUDE.md");
    const lines = text.split(/\r?\n/).length;
    if (missing.length) add("FAIL", "claude-md", `unresolved @imports: ${missing.join(", ")}`);
    else add("PASS", "claude-md", `${seen.size - 1} @import(s) resolve; ${lines} lines`);
    const named = [...text.matchAll(/`([\w.-]+(?:\/[\w.-]+)+\/?)`/g)].map((m) => m[1]).filter((s) => !s.startsWith(".ai-sdlc"));
    const gone = [...new Set(named)].filter((s) => {
      const t = s.replace(/\/$/, "");
      if (t.startsWith("frappe/")) return opts.bench ? !existsSync(join(opts.bench, "apps", "frappe", t)) : false; // framework path
      return !exists(t) && !exists(join(appRel, t));
    });
    if (gone.length) add("WARN", "claude-md", `paths named in CLAUDE.md that do not exist: ${gone.join(", ")}`);
    if (lines > 200) add("WARN", "claude-md", `CLAUDE.md has ${lines} lines (target under 200)`);
    const bm = text.match(/[Bb]ench[^`\n]*`(\/[^`\s]+)`/);
    claudeBench = bm ? bm[1] : null;
  }

  // guard-reach
  let checkBash = null;
  const guardFile = p("agents", "tool-guard.mjs");
  if (existsSync(guardFile)) {
    try { ({ checkBash } = await import(pathToFileURL(guardFile).href)); } catch { checkBash = null; }
  }
  for (const [name, fm] of Object.entries(agents)) {
    if (!SPECIALISTS.includes(name) || !hasTool(fm, "Bash")) continue;
    const prefixes = guards[name];
    if (!prefixes) { add("WARN", "guard-reach", `${name}: has Bash but no tool-guard bash-allow hook; only settings rules limit its commands`); continue; }
    for (const s of skillsOf(fm)) {
      const rel = join(".claude", "skills", s, "SKILL.md");
      if (!exists(rel)) continue;
      const sf = frontmatter(read(rel));
      const skillDirAbs = p(".claude", "skills", s);
      const judge = (cmd) => {
        if (typeof checkBash === "function") return checkBash(cmd, prefixes, root);
        // fallback without a loadable guard: literal prefix match on the relative form
        const relCmd = cmd.split(root + sep).join("");
        return prefixes.some((pf) => relCmd.startsWith(pf.replace(/\s*(\*\*|\.\.\.).*$/, ""))) ? null : { reason: "no matching bash-allow prefix" };
      };
      const body = sf ? sf.body : read(rel);
      const scriptCmds = skillScriptCommands(body);
      const perScript = new Map();
      for (const tpl of scriptCmds) {
        const script = (tpl.match(/scripts\/[\w.-]+/) || [""])[0];
        const cmd = concreteCommand(tpl, skillDirAbs, root);
        if (!perScript.has(script)) perScript.set(script, { n: 0, bad: null, ask: null });
        const e = perScript.get(script);
        e.n++;
        const res = judge(cmd);
        if (res && res.reason && !e.bad) e.bad = { reason: res.reason, shown: cmd.split(root + sep).join("").slice(0, 110) };
        else if (res && res.ask && !e.ask) e.ask = res.ask;
      }
      for (const [script, e] of perScript) {
        if (e.bad) add("FAIL", "guard-reach", `${name}: preloaded skill ${s} runs ${script} but the agent's Bash guard blocks it (exit 2): ${e.bad.reason.slice(0, 160)} [command: ${e.bad.shown}]`);
        else if (e.ask) add("WARN", "guard-reach", `${name}: ${s} ${script} needs a human prompt under the guard: ${e.ask}`);
        else add("PASS", "guard-reach", `${name}: ${s} ${script} passes the Bash guard (${e.n} command form(s), \${CLAUDE_SKILL_DIR} expanded)`);
      }
      // allowed-tools rules that exist for a `!` injection run at skill load, not as the agent's Bash tool
      const injected = [...body.matchAll(/!`([^`]+)`/g)].map((m) => concreteCommand(m[1], skillDirAbs, root));
      const allowedRaw = sf ? [].concat(sf.fields["allowed-tools"] || []).join(" ") : "";
      for (const m of allowedRaw.matchAll(/Bash\(([^)]*)\)/g)) {
        const cmd = concreteCommand(m[1], skillDirAbs, root);
        const stem = cmd.replace(/ arg$/, "");
        if (scriptCmds.some((t) => concreteCommand(t, skillDirAbs, root).startsWith(stem))) continue;
        if (injected.some((c) => c.split(/\s*&&\s*/).some((part) => part.startsWith(stem)))) continue;
        const res = judge(cmd);
        if (res && res.reason) add("WARN", "guard-reach", `${name}: skill ${s} pre-approves Bash(${m[1]}) but ${name}'s guard blocks "${cmd.split(root + sep).join("")}": that step of the skill cannot run inside ${name}`);
      }
    }
  }

  // Frappe app: app-layout, hooks-py, modules, patches, doctypes
  let requiredApps = [];
  if (!isDir(appRel)) add("FAIL", "app-layout", `${appRel} missing (the Frappe app the agents work on; --app-dir)`);
  else {
    const need = ["pyproject.toml", join(app, "__init__.py"), join(app, "hooks.py"), join(app, "modules.txt"), join(app, "patches.txt")];
    const missing = need.filter((f) => !exists(join(appRel, f)));
    let appName = null;
    if (exists(join(appPkg, "hooks.py"))) {
      const hooks = read(join(appPkg, "hooks.py"));
      appName = (hooks.match(/^app_name\s*=\s*["']([^"']+)["']/m) || [])[1] || null;
      const ra = hooks.match(/^required_apps\s*=\s*\[([^\]]*)\]/m);
      requiredApps = ra ? [...ra[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]) : [];
    }
    if (missing.length) add("FAIL", "app-layout", `${appRel}: missing ${missing.join(", ")}`);
    else if (appName !== app) add("FAIL", "app-layout", `${appPkg}/hooks.py app_name is "${appName}", folder is "${app}"`);
    else add("PASS", "app-layout", `${appRel}: pyproject.toml, ${app}/{__init__,hooks}.py, modules.txt, patches.txt; required_apps [${requiredApps.join(", ")}]`);

    if (exists(join(appPkg, "hooks.py"))) {
      const code = read(join(appPkg, "hooks.py")).split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
      const dotted = [...new Set([...code.matchAll(new RegExp(`["'](${app}(?:\\.\\w+)+)["']`, "g"))].map((m) => m[1]))];
      const bad = dotted.map((d) => [d, resolveDotted(p(appRel), d)]).filter(([, r]) => !r.ok).map(([d, r]) => `${d} (${r.why})`);
      if (bad.length) add("FAIL", "hooks-py", `${appPkg}/hooks.py: ${bad.join("; ")}`);
      else add("PASS", "hooks-py", `${dotted.length} dotted path(s) in hooks.py resolve: ${dotted.join(", ") || "none"}`);
    }

    if (exists(join(appPkg, "modules.txt"))) {
      const mods = read(join(appPkg, "modules.txt")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      const bad = mods.filter((m) => !exists(join(appPkg, scrub(m), "__init__.py"))).map((m) => `"${m}" -> ${join(appPkg, scrub(m))}/__init__.py missing`);
      const listed = new Set(mods.map(scrub));
      const unlisted = listDir(appPkg).filter((d) => isDir(join(appPkg, d, "doctype")) && !listed.has(d));
      if (unlisted.length) bad.push(`packages with doctype/ not in modules.txt: ${unlisted.join(", ")}`);
      if (bad.length) add("FAIL", "modules", bad.join("; "));
      else add("PASS", "modules", `modules.txt: ${mods.join(", ")} (each a package)`);
    }

    if (exists(join(appPkg, "patches.txt"))) {
      const entries = patchEntries(read(join(appPkg, "patches.txt")));
      const bad = [];
      for (const e of entries) {
        if (!e.section) bad.push(`line ${e.line}: "${e.text}" is outside [pre_model_sync]/[post_model_sync]`);
        if (!e.dotted) continue;
        if (!e.dotted.startsWith(`${app}.`)) { bad.push(`line ${e.line}: ${e.dotted} is not in app ${app}`); continue; }
        const r = resolveDotted(p(appRel), e.dotted, { fnLast: false });
        if (!r.ok) { bad.push(`line ${e.line}: ${e.dotted} (${r.why})`); continue; }
        if (!/^def execute\s*\(/m.test(readFileSync(r.file, "utf8"))) bad.push(`line ${e.line}: ${relative(root, r.file)} has no def execute()`);
      }
      if (bad.length) add("FAIL", "patches", `${appPkg}/patches.txt: ${bad.join("; ")}`);
      else add("PASS", "patches", `${entries.length} patches.txt entr${entries.length === 1 ? "y" : "ies"}, each resolving to a module with def execute(): ${entries.map((e) => e.dotted || e.text).join(", ") || "none"}`);
    }

    const dtFolders = [];
    for (const mod of listDir(appPkg)) for (const d of listDir(join(appPkg, mod, "doctype"))) if (isDir(join(appPkg, mod, "doctype", d))) dtFolders.push([mod, d]);
    const dtBad = [];
    const modulesTxt = exists(join(appPkg, "modules.txt")) ? read(join(appPkg, "modules.txt")).split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    for (const [mod, d] of dtFolders) {
      const dir = join(appPkg, mod, "doctype", d);
      const miss = ["__init__.py", `${d}.json`, `${d}.py`, `test_${d}.py`].filter((f) => !exists(join(dir, f)));
      if (miss.length) { dtBad.push(`${d}: missing ${miss.join(", ")}`); continue; }
      let j;
      try { j = JSON.parse(read(join(dir, `${d}.json`))); } catch (e) { dtBad.push(`${d}.json is not JSON (${e.message})`); continue; }
      if (j.doctype !== "DocType") dtBad.push(`${d}.json: doctype is "${j.doctype}"`);
      if (scrub(j.name || "") !== d) dtBad.push(`${d}.json: name "${j.name}" scrubs to "${scrub(j.name || "")}", not the folder`);
      if (!modulesTxt.includes(j.module)) dtBad.push(`${d}.json: module "${j.module}" not in modules.txt`);
      if (!new RegExp(`^class\\s+${controllerClass(j.name || "")}\\s*\\(`, "m").test(read(join(dir, `${d}.py`)))) dtBad.push(`${d}.py: no class ${controllerClass(j.name || "")}(...)`);
    }
    if (!dtFolders.length) add("WARN", "doctypes", `${appPkg}: no DocType folders found`);
    else if (dtBad.length) add("FAIL", "doctypes", dtBad.join("; "));
    else add("PASS", "doctypes", `${dtFolders.length} DocType folder(s), each with __init__.py, json, controller class and test: ${dtFolders.map(([, d]) => d).join(", ")}`);
  }

  // handoffs
  const runFolders = [
    ...listDir(join("workflows", "examples")).map((n) => join("workflows", "examples", n)),
    ...listDir(join("docs", "capstone", "example-runs")).map((n) => join("docs", "capstone", "example-runs", n)),
  ].filter((d) => isDir(d) && readdirSync(p(d)).some((n) => /^\d{2}-.*\.md$/.test(n)));
  const checker = join(".claude", "hooks", "check-handoff.mjs");
  if (opts.spawn === false) add("SKIP", "handoffs", "--no-spawn");
  else if (!exists(checker)) add(runFolders.length ? "FAIL" : "SKIP", "handoffs", `${checker} missing`);
  else if (!runFolders.length) add("SKIP", "handoffs", "no example run folders");
  else for (const d of runFolders) {
    const r = spawn([checker, d]);
    const n = (r.stdout.match(/^PASS /gm) || []).length;
    const bad = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("FAIL")).map((l) => l.replace(/^FAIL\s+/, ""));
    if (r.status === 0) add("PASS", "handoffs", `${d}: ${n} handoff(s) valid`);
    else add("FAIL", "handoffs", `${d}: invalid ${bad.join(", ") || lastLine(r.stderr)}`);
  }

  // eval-replay
  const harness = join("evaluations", "harness", "run-evals.mjs");
  if (opts.spawn === false) add("SKIP", "eval-replay", "--no-spawn");
  else if (!exists(harness)) add("SKIP", "eval-replay", `${harness} not present (module 09)`);
  else {
    const r = spawn([harness, "--mode", "replay", "--no-write"]);
    const summary = r.stdout.split(/\r?\n/).filter((l) => /gates (PASS|FAIL)/.test(l)).map((l) => l.replace(/\s+/g, " ").trim());
    if (r.status === 0) add("PASS", "eval-replay", summary.join(" | ") || "gates pass");
    else add("FAIL", "eval-replay", `exit ${r.status}: ${summary.join(" | ") || lastLine(r.stderr)}`);
  }

  // sub-checkers
  const subs = [
    ["agents/check-agents.mjs", [], "agent contracts and bench scopes (module 05)"],
    ["workflows/composition/check-roster-flat.mjs", [], "delegation topology (module 07)"],
    ["scripts/governance/check-agent-policy.mjs", [], "model/turn policy (module 10)"],
    ["scripts/governance/validate-skill-library.mjs", [], "skill library (module 10)"],
    ["scripts/automation/check-mcp-config.mjs", [], ".mcp.json lint (module 06)"],
    ["scripts/automation/check-patches.mjs", [], "patches.txt gate (module 06)"],
    ["scripts/automation/lint-doctype-json.mjs", [], "DocType JSON lint (module 06)"],
  ];
  for (const [script, args, what] of subs) {
    if (opts.spawn === false) { add("SKIP", "sub-checkers", `${script}: --no-spawn`); continue; }
    if (!exists(script)) { add("SKIP", "sub-checkers", `${script} not present`); continue; }
    const r = spawn([script, ...args]);
    if (r.status === 0) add("PASS", "sub-checkers", `${script}: ${what}`);
    else add("FAIL", "sub-checkers", `${script} exit ${r.status}: ${lastLine(r.stdout) || lastLine(r.stderr)}`);
  }

  // bench (optional)
  if (opts.bench) {
    const b = resolve(opts.bench);
    const site = opts.site || "test.localhost";
    const problems = [], notes = [], warns = [];
    if (!existsSync(join(b, "sites")) || !existsSync(join(b, "apps"))) add("FAIL", "bench", `${b} is not a bench (no sites/ or apps/)`);
    else {
      const appLink = join(b, "apps", app);
      if (!existsSync(appLink)) problems.push(`${appLink} missing (the app is not in this bench: bench get-app, or the setup-bench.sh symlink)`);
      else if (isDir(appRel) && realpathSync(appLink) !== realpathSync(p(appRel))) warns.push(`${appLink} is ${realpathSync(appLink)}, not this repo's ${appRel}: the bench runs a different copy of the code the agents edit`);
      else notes.push(`apps/${app} -> ${appRel}`);
      const appsTxt = existsSync(join(b, "sites", "apps.txt")) ? readFileSync(join(b, "sites", "apps.txt"), "utf8").split(/\r?\n/).map((s) => s.trim()) : [];
      if (!appsTxt.includes(app)) problems.push(`sites/apps.txt does not list ${app}`);
      if (!existsSync(join(b, "sites", site))) problems.push(`site ${site} not found in ${b}/sites`);
      if (opts.spawn !== false && !problems.length) {
        const benchBin = opts.benchBin || "bench";
        const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
        const inner = `cd ${q(b)} && ${q(benchBin)} --site ${q(site)} list-apps`;
        let cmd, args;
        if (opts.benchUser) { cmd = "su"; args = ["-", opts.benchUser, "-c", `[ -f ~/.spice-lite-bench-env ] && . ~/.spice-lite-bench-env; ${inner}`]; }
        else { cmd = "sh"; args = ["-c", inner]; }
        const lock = opts.lock === false ? null : (opts.lock || (existsSync(DEFAULT_LOCK) ? DEFAULT_LOCK : null));
        const hasFlock = lock && spawnSync("sh", ["-c", "command -v flock"], { encoding: "utf8" }).status === 0;
        if (hasFlock) { args = [lock, cmd, ...args]; cmd = "flock"; }
        const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 180000 });
        const installed = String(r.stdout || "").split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
        const shown = `${hasFlock ? `flock ${lock} ` : ""}${opts.benchUser ? `su - ${opts.benchUser} -c "cd ${b} && bench --site ${site} list-apps"` : `(cd ${b} && bench --site ${site} list-apps)`}`;
        if (r.status !== 0) problems.push(`${shown} exit ${r.status}: ${lastLine(r.stderr) || lastLine(r.stdout) || (r.error && r.error.message) || "no output"}`);
        else {
          const want = [app, ...requiredApps];
          const missing = want.filter((a) => !installed.includes(a));
          if (missing.length) problems.push(`${shown} lists [${installed.join(", ")}]: missing ${missing.join(", ")}`);
          else notes.push(`${shown}: ${installed.join(", ")}`);
        }
      } else if (opts.spawn === false) notes.push("list-apps skipped (--no-spawn)");
      if (claudeBench && resolve(claudeBench) !== b && !exists("CLAUDE.local.md")) warns.push(`CLAUDE.md names bench ${claudeBench} but you checked ${b} and there is no CLAUDE.local.md: agents will use the wrong bench path`);
      if (problems.length) add("FAIL", "bench", problems.join("; "));
      else add("PASS", "bench", notes.join("; "));
      for (const w of warns) add("WARN", "bench", w);
    }
    const frappeSrc = join(b, "apps", "frappe");
    if (opts.spawn === false) add("SKIP", "eval-traps", "--no-spawn");
    else if (!exists(harness)) add("SKIP", "eval-traps", `${harness} not present`);
    else if (!existsSync(frappeSrc)) add("SKIP", "eval-traps", `${frappeSrc} not found`);
    else {
      const r = spawn([harness, "--verify-traps"], { env: { ...process.env, FRAPPE_SRC: frappeSrc } });
      const line = r.stdout.split(/\r?\n/).find((l) => /^traps:/.test(l)) || lastLine(r.stdout);
      add(r.status === 0 ? "PASS" : "FAIL", "eval-traps", `${line} (FRAPPE_SRC=${frappeSrc})`);
    }
  }

  // optional: every test file, and the app's pure-Python unit tests
  if (opts.withTests) {
    const tests = [];
    const walk = (rel) => {
      for (const n of listDir(rel)) {
        if (["node_modules", ".git", ".ai-sdlc", "__pycache__"].includes(n)) continue;
        const r = join(rel, n);
        if (isDir(r)) walk(r);
        else if (n.endsWith(".test.mjs")) tests.push(r);
      }
    };
    walk(".");
    for (const t of tests.sort()) {
      if (t.endsWith(join("capstone", "verify-system.test.mjs"))) continue; // avoid recursion
      const usesNodeTest = /from\s+["']node:test["']/.test(read(t));
      const r = spawn(usesNodeTest ? ["--test", t] : [t]);
      add(r.status === 0 ? "PASS" : "FAIL", "tests", `${t}${r.status === 0 ? "" : ` exit ${r.status}: ${lastLine(r.stdout) || lastLine(r.stderr)}`}`);
    }
    const unitDir = join(appPkg, "tests", "unit");
    if (isDir(unitDir)) {
      const r = spawnSync("python3", ["-m", "unittest", "discover", "-s", `${app}/tests/unit`, "-t", "."], { cwd: p(appRel), encoding: "utf8", timeout: 180000 });
      const ran = (String(r.stderr).match(/Ran \d+ tests?/) || ["?"])[0];
      add(r.status === 0 ? "PASS" : "FAIL", "tests", `cd ${appRel} && python3 -m unittest discover -s ${app}/tests/unit -t . : ${ran}, exit ${r.status}`);
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

const USAGE = "usage: verify-system.mjs [--root DIR] [--app-dir DIR] [--json] [--no-spawn] [--with-tests] [--bench DIR [--site S] [--bench-user U] [--bench-bin PATH] [--lock FILE | --no-lock]]";

async function main(argv) {
  const opts = { root: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), json: false, spawn: true, withTests: false };
  const needs = (i, what) => { if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new Error(`${argv[i]} needs ${what}`); return argv[i + 1]; };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--root") opts.root = resolve(needs(i++, "a directory"));
      else if (a === "--app-dir") opts.appDir = needs(i++, "a directory");
      else if (a === "--bench") opts.bench = resolve(needs(i++, "a bench directory"));
      else if (a === "--site") opts.site = needs(i++, "a site name");
      else if (a === "--bench-user") opts.benchUser = needs(i++, "a user name");
      else if (a === "--bench-bin") opts.benchBin = needs(i++, "a path");
      else if (a === "--lock") opts.lock = needs(i++, "a lock file");
      else if (a === "--no-lock") opts.lock = false;
      else if (a === "--json") opts.json = true;
      else if (a === "--no-spawn") opts.spawn = false;
      else if (a === "--with-tests") opts.withTests = true;
      else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
      else throw new Error(`unknown option ${a}`);
    }
  } catch (e) { return usage(e.message); }
  if (!existsSync(opts.root) || !statSync(opts.root).isDirectory()) return usage(`not a directory: ${opts.root}`);
  if (opts.bench && !existsSync(opts.bench)) return usage(`--bench: not a directory: ${opts.bench}`);
  if (!opts.bench && (opts.site || opts.benchUser || opts.benchBin || opts.lock !== undefined)) return usage("--site, --bench-user, --bench-bin and --lock need --bench");
  const rows = await verify(opts.root, opts);
  console.log(opts.json ? JSON.stringify({ root: opts.root, rows }, null, 2) : render(rows));
  return rows.some((r) => r.status === "FAIL") ? 1 : 0;
}

function usage(msg) {
  console.error(`verify-system: ${msg}\n${USAGE}`);
  return 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(await main(process.argv.slice(2)));
