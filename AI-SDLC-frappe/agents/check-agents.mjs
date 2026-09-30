#!/usr/bin/env node
// check-agents.mjs: contract-conformance check for the roster subagents (course tooling, Frappe edition).
// Zero dependencies, Node 22. Run from anywhere:
//   node agents/check-agents.mjs                  check AI-SDLC-frappe/.claude/agents/*.md
//   node agents/check-agents.mjs --root DIR       check another project root (used by the tests)
//   node agents/check-agents.mjs --json           machine-readable report
//   node agents/check-agents.mjs --contracts-json print the agentContracts array built from agents/*/CONTRACT.md
// Exit codes: 0 all agents conform, 1 at least one FAIL, 2 usage or I/O error.
//
// What it checks, per .claude/agents/<file>.md:
//   frontmatter   only documented subagent keys (build/CLAUDE_CODE_FACTS.md section 1), name = file name
//                 and in the roster, valid enum values, known tool names, no Agent for roster agents,
//                 no permission-rule specifiers in disallowedTools (they remove the whole tool),
//                 no memory on agents without Write (memory auto-enables Read/Write/Edit),
//                 Claude Code hooks use real events and any agents/tool-guard.mjs reference exists
//   bench scope   (Frappe) every tool-guard bash-allow entry is parsed: no entry may grant bench console,
//                 execute, DB shells, show-config or site-destroying commands, or name site_config.json;
//                 bench migrate appears only as an ask entry ("?..."); bench entries target --site
//                 test.localhost; write-scope specs never cover sites/ or site config files
//   skills        each preloaded skill exists (or is a canonical course skill not yet written) and
//                 is not disable-model-invocation: true (those cannot be preloaded)
//   contract      agents/<name>/CONTRACT.md exists, has the eleven sections, lists exactly the same
//                 tools as the frontmatter, names the permissionMode the agent file sets and each
//                 tool-guard mode it uses, and has a "Frappe surfaces:" header line
//   body          non-empty system prompt that names the run folder and the handoff status field
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALWAYS_DENY, parseEntry, tokenize } from './tool-guard.mjs';

export const ROSTER = ['architect', 'developer', 'reviewer', 'tester', 'security', 'sre', 'orchestrator'];
export const REQUIRED = ['architect', 'developer', 'reviewer', 'tester', 'security', 'sre'];
export const DOCUMENTED_KEYS = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills',
  'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color',
  'initialPrompt', 'experimental',
]);
// Common mistakes: skill-style hyphenated keys, invented keys.
const KEY_HINTS = {
  'allowed-tools': 'subagents use `tools` (allowed-tools is SKILL.md syntax)',
  allowedTools: 'subagents use `tools`',
  'disallowed-tools': 'subagents use camelCase `disallowedTools`',
  'permission-mode': 'use camelCase `permissionMode`',
  'max-turns': 'use camelCase `maxTurns`',
  'mcp-servers': 'use camelCase `mcpServers`',
  prompt: 'the file body is the prompt; `prompt` is only a key in --agents JSON',
  system_prompt: 'the file body is the system prompt',
  temperature: 'not a subagent field', max_tokens: 'not a subagent field', thinking: 'no per-subagent thinking setting',
  version: 'not a subagent field; version the file in git or evaluations/agent-versions/',
};
const BUILTIN_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LSP', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'WebFetch',
  'WebSearch', 'TodoWrite', 'Skill', 'ToolSearch', 'EnterWorktree', 'ExitWorktree', 'Monitor',
  'TaskStop', 'SendMessage', 'Artifact', 'Agent', 'Task',
]);
const MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'fable', 'inherit']);
const PERMISSION_MODES = new Set(['default', 'manual', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']);
const MEMORY = new Set(['user', 'project', 'local']);
const HOOK_EVENTS = new Set([
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PermissionRequest',
  'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle',
  'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate',
  'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'Elicitation',
  'ElicitationResult', 'SessionEnd',
]);
export const CANONICAL_SKILLS = new Set([
  'explain-endpoint', 'run-tests', 'architecture-review', 'code-review', 'test-strategy', 'security-review',
  'performance-review', 'production-rca', 'ticket-intake', 'feature', 'bug-fix', 'incident', 'requirements',
  'implementation-plan',
]);
export const CONTRACT_SECTIONS = [
  'purpose', 'inputs', 'outputs', 'tools', 'permissions', 'must', 'mustNot', 'failureConditions',
  'validation', 'handoffFormat', 'humanGate',
];

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

// Minimal YAML frontmatter reader: top-level scalars, inline [a, b] lists, block "- x" lists,
// folded/literal scalars, and nested maps kept as raw text (enough for agent files).
export function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return { error: 'file does not start with a --- frontmatter line' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { error: 'frontmatter is not closed with ---' };
  const fm = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n');
  const data = {};
  const order = [];
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) return { error: `unexpected indented line ${i + 2}: "${line.trim()}"` };
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) return { error: `cannot parse frontmatter line ${i + 2}: "${line}"` };
    const [, key, rawVal] = m;
    order.push(key);
    const block = [];
    while (i + 1 < fm.length && (/^\s/.test(fm[i + 1]) || !fm[i + 1].trim())) block.push(fm[++i]);
    const val = rawVal.replace(/\s+#.*$/, '').trim();
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      data[key] = block.map((l) => l.trim()).join(val.startsWith('>') ? ' ' : '\n').trim();
    } else if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = splitTopLevel(val.slice(1, -1)).map(unquote);
    } else if (val !== '') {
      data[key] = unquote(val);
    } else {
      const nonEmpty = block.filter((l) => l.trim());
      const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)[0].length));
      const top = nonEmpty.filter((l) => l.match(/^\s*/)[0].length === minIndent);
      if (top.length && top.every((l) => /^\s*- /.test(l)) && top.every((l) => !/^\s*- [\w-]+:\s/.test(l))) {
        data[key] = top.map((l) => unquote(l.replace(/^\s*- /, '')));
      } else {
        data[key] = { raw: block.join('\n'), topKeys: top.map((l) => (l.match(/^\s*([\w-]+):/) || [])[1]).filter(Boolean) };
      }
    }
  }
  return { data, order, body };
}

// Split "Read, Agent(a, b), Bash" on top-level commas only.
export function splitTopLevel(str) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
export const toList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? splitTopLevel(v) : []);

export function parseContractTools(md) {
  const text = md.replace(/<!--[\s\S]*?-->/g, '');
  const sections = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^## (\S.*?)\s*$/);
    if (h) { cur = h[1]; sections[cur] = []; continue; }
    if (cur) sections[cur].push(line);
  }
  const tools = (sections.tools || []).filter((l) => /^- \S/.test(l)).map((l) => l.slice(2).trim().split(/[\s(:,]/)[0].replace(/`/g, ''));
  return { sections, tools };
}

// Frappe bench scope of one tool-guard invocation (args = everything after the mode).
export function checkGuardArgs(mode, args) {
  const errs = [];
  if (!args.length) errs.push(`tool-guard ${mode} has no entries (it would block every call)`);
  if (mode === 'bash-allow') {
    for (const raw of args) {
      const e = parseEntry(raw);
      const deny = ALWAYS_DENY.find(([re]) => re.test(e.text));
      if (deny) errs.push(`bash-allow entry "${raw}" grants "${deny[1]}"; the guard blocks it anyway, and the entry misleads readers`);
      if (/\bbench\b/.test(e.text)) {
        if (/\bmigrate\b/.test(e.text) && !e.ask) errs.push(`bash-allow entry "${raw}" auto-allows bench migrate; use an ask entry ("?${raw}") so a human decides`);
        if (/^(CI=1 )?bench\b/.test(e.text) && !/^(CI=1 )?bench( --verbose)? --site test\.localhost /.test(e.text + ' ')) errs.push(`bash-allow entry "${raw}" must target --site test.localhost`);
      }
    }
  }
  if (mode === 'write-scope') {
    for (const spec of args.filter((a) => !a.startsWith('!'))) {
      if (/(^|\/)sites(\/|$)|site_config/.test(spec)) errs.push(`write-scope spec "${spec}" covers site folders or site config`);
      if (spec === '' || spec === '.' || spec === './' || spec === '**') errs.push(`write-scope spec "${spec}" allows the whole project`);
    }
  }
  return errs;
}

// agentContracts entries (build/schema.json) from agents/<name>/CONTRACT.md: the same mapping as
// docs/foundations/validate-contract.mjs toAgentContract (list sections -> bullets, others -> one paragraph).
const LIST_FIELDS = new Set(['inputs', 'outputs', 'tools', 'must', 'mustNot', 'failureConditions']);
export function contractToJson(md) {
  const text = md.replace(/<!--[\s\S]*?-->/g, '');
  const title = (text.match(/^# Agent Contract:\s*(.+?)\s*$/m) || [])[1] || null;
  const { sections } = parseContractTools(md);
  const out = { agent: title };
  for (const f of CONTRACT_SECTIONS) {
    const lines = sections[f] || [];
    out[f] = LIST_FIELDS.has(f)
      ? lines.filter((l) => /^- \S/.test(l)).map((l) => l.slice(2).trim())
      : lines.join('\n').trim().replace(/\s*\n\s*/g, ' ');
  }
  return out;
}

export function checkAgentFile(root, file) {
  const errors = [];
  const warnings = [];
  const rel = path.join('.claude/agents', file);
  const base = path.basename(file, '.md');
  const text = readFileSync(path.join(root, rel), 'utf8');
  const fm = parseFrontmatter(text);
  if (fm.error) return { file: rel, name: base, errors: [fm.error], warnings, summary: '' };
  const { data, order, body } = fm;

  for (const k of order) {
    if (!DOCUMENTED_KEYS.has(k)) {
      errors.push(`frontmatter key "${k}" is not a documented subagent field${KEY_HINTS[k] ? ` (${KEY_HINTS[k]})` : ''}; unknown keys are silently ignored`);
    }
  }
  const name = data.name;
  if (!name) errors.push('missing required key "name"');
  else {
    if (name.includes(':')) errors.push('name must not contain ":"');
    if (name !== base) errors.push(`name "${name}" does not match file name "${base}.md" (course convention)`);
    if (!ROSTER.includes(name)) errors.push(`name "${name}" is not in the roster (${ROSTER.join(', ')})`);
  }
  if (!data.description || String(data.description).length < 40) errors.push('description missing or shorter than 40 characters (it drives delegation)');

  const tools = toList(data.tools);
  const disallowed = toList(data.disallowedTools);
  if (!data.tools) errors.push('no "tools" allowlist: the agent would inherit every tool, including Agent and MCP tools');
  for (const t of [...tools, ...disallowed]) {
    const bare = t.replace(/\(.*$/, '');
    if (!BUILTIN_TOOLS.has(bare) && !/^mcp__/.test(bare)) errors.push(`unknown tool "${t}"`);
  }
  const isOrchestrator = name === 'orchestrator';
  if (!isOrchestrator && tools.some((t) => /^(Agent|Task)\b/.test(t))) {
    errors.push('roster agents must not list Agent/Task in tools (flat, auditable, depth 1)');
  }
  if (!isOrchestrator && !disallowed.includes('Agent')) warnings.push('add Agent to disallowedTools so delegation stays off even if tools is later removed');
  for (const t of disallowed) {
    if (t.includes('(')) errors.push(`disallowedTools entry "${t}" removes the WHOLE ${t.replace(/\(.*$/, '')} tool; scope commands with a Claude Code hook (agents/tool-guard.mjs) or permission rules instead`);
  }
  for (const t of tools) {
    if (/^Bash\(|^Edit\(|^Read\(/.test(t)) warnings.push(`tools entry "${t}": specifiers in a subagent tools list are not documented; use a hook or permission rules`);
  }
  if (data.model && !MODEL_ALIASES.has(data.model) && !/^claude-[a-z0-9-]+$/.test(data.model)) errors.push(`model "${data.model}" is not an alias (sonnet, opus, haiku, fable, inherit) or a full claude-* id`);
  if (!data.model) warnings.push('no model: the agent falls back to CLAUDE_CODE_SUBAGENT_MODEL or the main model; choose deliberately');
  if (data.permissionMode && !PERMISSION_MODES.has(data.permissionMode)) errors.push(`permissionMode "${data.permissionMode}" is not a documented mode`);
  if (data.permissionMode === 'bypassPermissions') errors.push('permissionMode bypassPermissions is not allowed for roster agents');
  if (data.effort && !EFFORTS.has(data.effort)) errors.push(`effort "${data.effort}" is not low|medium|high|xhigh|max`);
  if (data.color && !COLORS.has(data.color)) errors.push(`color "${data.color}" is not a documented color`);
  if (data.maxTurns !== undefined && !/^[1-9]\d*$/.test(String(data.maxTurns))) errors.push('maxTurns must be a positive integer');
  if (data.memory !== undefined) {
    if (!MEMORY.has(data.memory)) errors.push(`memory "${data.memory}" is not user|project|local`);
    if (!tools.includes('Write')) errors.push('memory auto-enables Read/Write/Edit, which breaks a read-only agent; remove memory or grant Write deliberately');
  }

  const guardModes = new Set();
  if (data.hooks) {
    if (typeof data.hooks !== 'object' || !data.hooks.raw) errors.push('hooks must be a map of hook events');
    else {
      for (const ev of data.hooks.topKeys) if (!HOOK_EVENTS.has(ev)) errors.push(`hook event "${ev}" does not exist`);
      for (const m of data.hooks.raw.matchAll(/command:\s*(.+)/g)) {
        const cmd = unquote(m[1]).replace(/\\"/g, '"');
        if (cmd.includes('agents/tool-guard.mjs')) {
          if (!existsSync(path.join(root, 'agents/tool-guard.mjs'))) errors.push('hook references agents/tool-guard.mjs, which does not exist');
          const mode = (cmd.match(/tool-guard\.mjs"?\s+(\S+)/) || [])[1];
          if (!['write-scope', 'bash-allow'].includes(mode)) errors.push(`tool-guard mode "${mode}" is not write-scope or bash-allow`);
          if (mode === 'bash-allow' && !tools.includes('Bash')) warnings.push('bash-allow hook on an agent without Bash');
          if (mode === 'write-scope' && !tools.some((t) => t === 'Write' || t === 'Edit')) warnings.push('write-scope hook on an agent without Write/Edit');
          guardModes.add(mode);
          const toks = tokenize(cmd) || [];
          const args = toks.slice(toks.findIndex((t) => t.endsWith('tool-guard.mjs')) + 2);
          errors.push(...checkGuardArgs(mode, args));
        }
      }
    }
  }
  if ((tools.includes('Write') || tools.includes('Edit')) && !isOrchestrator && !(data.hooks && /write-scope/.test(data.hooks.raw || ''))) {
    errors.push('agent can write files but has no write-scope Claude Code hook (Write path rules are never consulted)');
  }
  if (tools.includes('Bash') && !isOrchestrator && !(data.hooks && /bash-allow/.test(data.hooks.raw || ''))) {
    errors.push('agent has Bash but no bash-allow Claude Code hook: unscoped Bash on a bench can run console or read site_config.json, and permissionMode alone is ignored under acceptEdits/auto parents');
  }

  const skills = toList(data.skills);
  for (const s of skills) {
    const p = path.join(root, '.claude/skills', s, 'SKILL.md');
    if (existsSync(p)) {
      if (/^disable-model-invocation:\s*(true|yes|on|1)\s*$/m.test(readFileSync(p, 'utf8'))) {
        errors.push(`skill "${s}" has disable-model-invocation: true and cannot be preloaded`);
      }
    } else if (CANONICAL_SKILLS.has(s)) {
      warnings.push(`skill "${s}" is canonical but .claude/skills/${s}/SKILL.md does not exist yet`);
    } else {
      errors.push(`skill "${s}" does not exist and is not a canonical course skill`);
    }
  }

  if (!body.trim() || body.trim().length < 200) errors.push('body (system prompt) is empty or too short');
  if (!body.includes('.ai-sdlc/runs/')) errors.push('body does not name the handoff run folder .ai-sdlc/runs/');
  if (!/status:/.test(body)) errors.push('body does not define the handoff status field');

  {
    const cpath = path.join(root, 'agents', base, 'CONTRACT.md');
    if (!existsSync(cpath)) errors.push(`missing Agent Contract agents/${base}/CONTRACT.md`);
    else {
      const md = readFileSync(cpath, 'utf8');
      const { sections, tools: ctools } = parseContractTools(md);
      const missing = CONTRACT_SECTIONS.filter((s) => !(s in sections));
      if (missing.length) errors.push(`CONTRACT.md missing sections: ${missing.join(', ')}`);
      const fmTools = tools.map((t) => t.replace(/\(.*$/, ''));
      const onlyAgent = fmTools.filter((t) => !ctools.includes(t));
      const onlyContract = ctools.filter((t) => !fmTools.includes(t));
      if (onlyAgent.length) errors.push(`tools in agent file but not in CONTRACT.md: ${onlyAgent.join(', ')}`);
      if (onlyContract.length) errors.push(`tools in CONTRACT.md but not in agent file: ${onlyContract.join(', ')}`);
      if (data.permissionMode && !(sections.permissions || []).join('\n').includes(`permissionMode: ${data.permissionMode}`)) {
        errors.push(`CONTRACT.md permissions section does not mention "permissionMode: ${data.permissionMode}"`);
      }
      const perms = (sections.permissions || []).join('\n');
      for (const mode of guardModes) {
        if (!perms.includes(mode)) errors.push(`CONTRACT.md permissions section does not mention the tool-guard mode "${mode}" the agent file uses`);
      }
      if (!/^Frappe surfaces:\s*\S/m.test(md.replace(/<!--[\s\S]*?-->/g, ''))) warnings.push('CONTRACT.md has no "Frappe surfaces:" header line (agents/CONTRACT_TEMPLATE.md)');
      if (!body.includes(`agents/${base}/CONTRACT.md`)) warnings.push(`body does not point to agents/${base}/CONTRACT.md`);
    }
  }
  const summary = `model=${data.model ?? '-'} mode=${data.permissionMode ?? 'inherit'} tools=${tools.join(',')} skills=${skills.join(',') || '-'}`;
  return { file: rel, name: name ?? base, errors, warnings, summary };
}

export function checkAll(root) {
  const dir = path.join(root, '.claude/agents');
  if (!existsSync(dir)) return { results: [], missing: REQUIRED.slice(), fatal: `no ${dir}` };
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const results = files.map((f) => checkAgentFile(root, f));
  const names = results.map((r) => r.name);
  const missing = REQUIRED.filter((r) => !names.includes(r));
  return { results, missing };
}

function main(argv) {
  const json = argv.includes('--json');
  const ri = argv.indexOf('--root');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = ri >= 0 ? path.resolve(argv[ri + 1] ?? '') : path.resolve(here, '..');
  if (ri >= 0 && !argv[ri + 1]) { process.stderr.write('usage: check-agents.mjs [--root DIR] [--json | --contracts-json]\n'); return 2; }
  if (argv.includes('--contracts-json')) {
    const out = [];
    for (const n of REQUIRED) {
      const p = path.join(root, 'agents', n, 'CONTRACT.md');
      if (!existsSync(p)) { process.stderr.write(`check-agents: missing ${p}\n`); return 2; }
      out.push(contractToJson(readFileSync(p, 'utf8')));
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }
  const { results, missing, fatal } = checkAll(root);
  if (fatal) { process.stderr.write(`check-agents: ${fatal}\n`); return 2; }
  const failed = results.filter((r) => r.errors.length).length + missing.length;
  if (json) {
    process.stdout.write(JSON.stringify({ root, results, missing, ok: failed === 0 }, null, 2) + '\n');
    return failed ? 1 : 0;
  }
  const out = [`check-agents: ${results.length} agent files in ${path.relative(process.cwd(), path.join(root, '.claude/agents')) || '.claude/agents'}`];
  let warnCount = 0;
  for (const r of results) {
    out.push(`${r.errors.length ? 'FAIL' : 'PASS'}  ${r.name.padEnd(12)} ${r.summary}`);
    for (const e of r.errors) out.push(`      error: ${e}`);
    for (const w of r.warnings) { out.push(`      warn:  ${w}`); warnCount++; }
  }
  for (const m of missing) out.push(`FAIL  ${m.padEnd(12)} missing .claude/agents/${m}.md`);
  out.push(`Summary: ${results.length - results.filter((r) => r.errors.length).length} passed, ${failed} failed, ${warnCount} warnings`);
  process.stdout.write(out.join('\n') + '\n');
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
