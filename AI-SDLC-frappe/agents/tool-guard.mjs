#!/usr/bin/env node
// PreToolUse Claude Code hook for the roster subagents (a course pattern, not a built-in feature).
// Referenced from the `hooks:` frontmatter of .claude/agents/<agent>.md, so it runs only inside
// that agent. Zero dependencies, Node 22. Frappe edition.
//
// Usage (Claude Code hook command):
//   node agents/tool-guard.mjs write-scope <spec>... [!protectedSpec]...
//   node agents/tool-guard.mjs bash-allow <entry>...
//
// write-scope specs: a directory prefix ending in "/" (`sample-app/spice_lite/spice_lite/`), an exact
//   file, or a glob (`*` = one path segment, `**` = any depth), all relative to the project root.
// bash-allow entries (one allowed command shape each):
//   plain       `git diff`                       the command, optionally followed by any arguments
//   ask         `?bench --site test.localhost migrate`   never auto-allowed: the guard returns
//                                                permissionDecision "ask", so a human must approve
//   patterned   `tail {bench}/logs/**`           literal words, then path tokens that must stay inside
//               `grep ARG {bench}/logs/**`       the directory (`ARG` = one free argument, e.g. a
//               `node .claude/skills/x/scripts/** ...`   pattern; a trailing `...` = free arguments)
//   `{bench}` expands to $SPICE_BENCH_DIR or /home/user/frappe-bench.
//
// Reads the hook input JSON on stdin (tool_name, tool_input, cwd, agent_type, ...).
// Exit 0            = no objection (normal permission rules still apply afterwards).
// Exit 0 + JSON ask = permissionDecision "ask" (documented PreToolUse output).
// Exit 2            = block the tool call; stderr is shown to the agent.
// Fails closed: unreadable input or an unknown mode blocks.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BENCH = '/home/user/frappe-bench';
export const benchDir = () => process.env.SPICE_BENCH_DIR || DEFAULT_BENCH;

// bench/site commands that are arbitrary code as Administrator, print secrets, open a DB shell,
// or destroy or rewrite a site. No roster agent may run them, whatever its allowlist says.
const BENCH_NEVER = [
  'console', 'execute', 'jupyter', 'db-console', 'mariadb', 'postgres', 'request', 'show-config',
  'drop-site', 'reinstall', 'restore', 'partial-restore', 'set-admin-password', 'set-password',
  'set-config', 'add-system-manager', 'add-user', 'browse', 'run-patch', 'destroy-all-sessions',
  'trim-database', 'trim-tables', 'clear-log-table', 'purge-jobs', 'trigger-scheduler-event',
  'uninstall-app', 'remove-from-installed-apps', 'new-site', 'install-app', 'import-doc', 'data-import',
  'bulk-rename', 'set-maintenance-mode', 'enable-scheduler', 'disable-scheduler', 'update', 'restart',
  'setup', 'remove-app', 'get-app', 'backup',
];
const benchNeverRe = new RegExp(`\\bbench\\b(\\s+--?[\\w-]+(\\s+(?!-)\\S+)?)*\\s+(${BENCH_NEVER.join('|')})(\\s|$)`);

// Commands no roster agent may run (CLAUDE.md rules 2 and 9), checked before any allowlist.
export const ALWAYS_DENY = [
  [benchNeverRe, 'bench console/execute/db shells, show-config, site-destroying or site-changing commands'],
  [/site_config\.json/, 'reading site_config.json or common_site_config.json (database password, encryption_key)'],
  [/\bgit\s+push\b/, 'git push'],
  [/\bgit\s+commit\b/, 'git commit'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\b/, 'git clean'],
  [/\bgit\s+(checkout|restore|stash|apply|am|rebase|merge|cherry-pick)\b/, 'git commands that change the working tree'],
  [/(^|&&|\|)\s*(sudo|su|doas)(\s|$)/, 'privilege change (sudo/su)'],
  [/(^|&&|\|)\s*(psql|mysql|mariadb|redis-cli)(\s|$)/, 'direct database or Redis client'],
  [/\brm\s+-[a-z]*r/i, 'recursive rm'],
  [/\b(curl|wget|nc|ssh|scp)\b/, 'network access'],
  // flags that turn an allowed read-only command into a writer or an arbitrary reader:
  [/\s--output(=|\s|$)/, 'git --output (writes a file)'],
  [/\s--no-index\b/, 'git diff --no-index (reads arbitrary paths, e.g. site_config.json)'],
  [/\s--ext-diff\b/, 'git --ext-diff (runs an external program)'],
  [/\s--junit-xml-output\b/, 'run-tests --junit-xml-output (writes a file anywhere)'],
];

// Shell metacharacters that could chain, substitute or redirect. `&&`, a single `|` between allowed
// commands, and the exact token `2>&1` are handled separately.
const FORBIDDEN_SHELL = [
  [/\n/, 'newline'], [/;/, ';'], [/`/, 'backtick'], [/\$\(/, '$( )'], [/\$\{/, '${ }'],
  [/\|\|/, '||'], [/>/, 'redirect >'], [/</, 'redirect <'], [/(?<!&)&(?!&)/, 'background &'],
];
// Options never allowed in a patterned (path-scoped) entry: follow forever, or read paths from a file.
const UNSAFE_OPTIONS = /^(-f|-F|--follow(=.*)?|--files0-from(=.*)?|-r|-R|--recursive|--dereference-recursive)$/;

// Quote-aware split on spaces (no escapes). Quotes are removed from the returned tokens.
export function tokenize(str) {
  const out = [];
  let cur = '', q = null, has = false;
  for (const ch of String(str)) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (ch === ' ' || ch === '\t') { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
  }
  if (q) return null; // unbalanced quote
  if (has || cur) out.push(cur);
  return out;
}

// A skill that runs `node ${CLAUDE_SKILL_DIR}/scripts/x.mjs` reaches Bash with the variable already
// substituted by Claude Code (normally an absolute path). Absolute paths INSIDE the project are
// rewritten to project-relative form, so one relative entry such as
// `python3 .claude/skills/run-tests/scripts/** ...` matches both. Paths outside the project are kept.
export function normalizeToken(tok, projectDir) {
  if (!projectDir || !path.isAbsolute(tok)) return tok;
  const rel = path.relative(path.resolve(projectDir), path.resolve(tok)).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return tok;
  return rel + (tok.endsWith('/') && !rel.endsWith('/') ? '/' : '');
}

export function parseEntry(raw) {
  let s = String(raw).trim();
  const ask = s.startsWith('?');
  if (ask) s = s.slice(1).trim();
  s = s.replaceAll('{bench}', benchDir());
  const toks = tokenize(s) || [];
  const patterned = toks.some((t) => t === 'ARG' || t === '...' || t.endsWith('/**'));
  return { raw, ask, text: toks.join(' '), toks, patterned };
}

const isUnder = (p, dir, projectDir) => {
  if (p.split('/').includes('..') || p.startsWith('~')) return false;
  const absDir = path.resolve(projectDir, dir);
  const abs = path.resolve(projectDir, p.replace(/\*.*$/, '') || '.');
  const rel = path.relative(absDir, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function matchPatterned(entry, toks, projectDir) {
  const pat = entry.toks;
  const special = (t) => t === 'ARG' || t === '...' || t.endsWith('/**');
  let j = 0;
  while (j < pat.length && !special(pat[j])) {
    if (toks[j] !== pat[j]) return false; // literal command words, in order
    j++;
  }
  const want = pat.slice(j);
  const used = new Array(want.length).fill(false);
  let w = 0;
  for (const t of toks.slice(j)) {
    if (want[w] === '...') return used.slice(0, w).every(Boolean);
    if (t.startsWith('-')) { if (UNSAFE_OPTIONS.test(t)) return false; continue; }
    if (/^\d+$/.test(t)) continue; // option values such as -n 200
    if (w >= want.length) return false; // an extra positional argument
    if (want[w] === 'ARG') { used[w] = true; w++; continue; }
    if (!isUnder(t, want[w].slice(0, -3), projectDir)) return false;
    used[w] = true;
    if (w + 1 < want.length) w++; // the last path spec may repeat (several log files)
  }
  return want.every((spec, k) => spec === '...' || used[k]);
}

export function checkBash(command, entries, projectDir) {
  const cmd = String(command ?? '').trim();
  if (!cmd) return { reason: 'empty command' };
  for (const [re, label] of ALWAYS_DENY) {
    if (re.test(cmd)) return { reason: `"${label}" is never allowed for any roster agent (CLAUDE.md rules 2 and 9: secrets stay unread; a human migrates shared sites, pushes and deploys)` };
  }
  const merged = cmd.replace(/(^|\s)2>&1(?=\s|$)/g, ' ');
  for (const [re, label] of FORBIDDEN_SHELL) {
    if (re.test(merged)) return { reason: `shell metacharacter ${label} is not allowed; run allowed commands joined only by && or |` };
  }
  const parsed = entries.map(parseEntry);
  let ask = null;
  const segments = merged.split(/&&|\|/).map((s) => s.trim());
  for (const seg of segments) {
    if (!seg) return { reason: 'empty command segment' };
    const raw = tokenize(seg);
    if (!raw) return { reason: `unbalanced quote in "${seg}"` };
    const toks = raw.map((t) => normalizeToken(t, projectDir));
    const text = toks.join(' ');
    const hit = parsed.find((e) => (e.patterned ? matchPatterned(e, toks, projectDir) : text === e.text || text.startsWith(e.text + ' ')));
    if (!hit) return { reason: `"${text}" is outside this agent's Bash allowlist: ${entries.map((p) => `"${p}"`).join(', ')}` };
    if (hit.ask) ask = hit.text;
  }
  return ask ? { ask: `"${ask}" needs a human decision (it changes the test site); approve or reject the prompt` } : null;
}

const globRe = (g) => new RegExp('^' + g.split('**').map((part) => part.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');

export function checkWrite(filePath, specs, projectDir, cwd) {
  if (!filePath) return 'no file_path in tool input';
  const allowed = specs.filter((s) => !s.startsWith('!'));
  const denied = specs.filter((s) => s.startsWith('!')).map((s) => s.slice(1));
  const abs = path.resolve(cwd || projectDir, filePath);
  const rel = path.relative(projectDir, abs).split(path.sep).join('/');
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return `${filePath} is outside the project directory`;
  if (/(^|\/)(common_)?site_config\.json$/.test(rel)) return `${rel} is a site config file (secrets)`;
  const matches = (p) => (p.includes('*') ? globRe(p).test(rel) : rel === p.replace(/\/$/, '') || rel.startsWith(p.endsWith('/') ? p : p + '/'));
  const hit = denied.find(matches);
  if (hit) return `${rel} is explicitly protected for this agent (${hit})`;
  if (!allowed.some(matches)) return `${rel} is outside this agent's write scope: ${allowed.join(', ')}`;
  return null;
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('tool-guard: could not parse hook input JSON; blocking (fail closed)\n');
    process.exit(2);
  }
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const who = input.agent_type ? `[${input.agent_type}] ` : '';
  let reason = null;
  if (mode === 'bash-allow') {
    if (tool !== 'Bash') process.exit(0);
    const r = checkBash(ti.command, args, projectDir);
    if (r?.ask) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `tool-guard ${who}${r.ask}` } }) + '\n');
      process.exit(0);
    }
    reason = r?.reason ?? null;
  } else if (mode === 'write-scope') {
    if (!['Write', 'Edit', 'NotebookEdit'].includes(tool)) process.exit(0);
    reason = checkWrite(ti.file_path ?? ti.notebook_path, args, projectDir, input.cwd);
  } else {
    reason = `unknown mode "${mode}"; expected write-scope or bash-allow`;
  }
  if (reason) {
    process.stderr.write(`tool-guard ${who}blocked ${tool}: ${reason}. If the task needs this, stop and hand off with status: blocked.\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
