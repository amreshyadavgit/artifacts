#!/usr/bin/env node
// PreToolUse guard for the roster subagents (a course pattern, not a built-in feature).
// Referenced from the `hooks:` frontmatter of .claude/agents/<agent>.md, so it runs only
// inside that agent. Zero dependencies, Node 22.
//
// Usage (hook command):
//   node agents/tool-guard.mjs write-scope <allowedPrefix>... [!deniedPath]...
//   node agents/tool-guard.mjs bash-allow <allowedCommandPrefix>...
//
// Reads the hook input JSON on stdin (tool_name, tool_input, cwd, ...).
// Exit 0  = no objection (normal permission rules still apply afterwards).
// Exit 2  = block the tool call; stderr is shown to the agent (documented PreToolUse behaviour).
// Fails closed: unreadable input or an unknown mode blocks.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Commands no roster agent may run, whatever its allowlist says (CLAUDE.md rule 7).
export const ALWAYS_DENY = [
  [/\bgit\s+push\b/, 'git push'],
  [/\bgit\s+commit\b/, 'git commit'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\b/, 'git clean'],
  [/\bkubectl\s+(apply|create|delete|edit|patch|replace|scale|exec|cp|port-forward|drain|cordon)\b/, 'mutating or interactive kubectl'],
  [/\bkubectl\s+rollout\s+(restart|undo|pause|resume)\b/, 'kubectl rollout change'],
  [/\brm\s+-[a-z]*r/, 'recursive rm'],
  [/\b(curl|wget)\b/, 'network download'],
  // git diff can write files or read outside the repo, which would sidestep Read deny rules:
  [/\s--output(=|\s|$)/, 'git --output (writes a file)'],
  [/\s--no-index\b/, 'git diff --no-index (reads arbitrary paths, e.g. .env)'],
  [/\s--ext-diff\b/, 'git --ext-diff (runs an external program)'],
];

// Shell metacharacters that could chain or redirect. `&&` is handled separately.
const FORBIDDEN_SHELL = [
  [/\n/, 'newline'], [/;/, ';'], [/`/, 'backtick'], [/\$\(/, '$( )'],
  [/>/, 'redirect >'], [/</, 'redirect <'], [/\|/, 'pipe |'],
];

// A skill that runs `node ${CLAUDE_SKILL_DIR}/scripts/x.mjs` reaches Bash with the variable
// already substituted by Claude Code (the skill's directory, normally an absolute path).
// Rewrite absolute paths inside the project to project-relative form (and drop plain
// quotes around a path token) so one relative allow-list entry such as
// `node .claude/skills/run-tests/scripts/summarize-surefire.mjs` matches both forms.
// Absolute paths outside the project are left as they are, so they still fail the list.
export function normalizeSegment(seg, projectDir) {
  if (!projectDir) return seg;
  const root = path.resolve(projectDir);
  return seg.split(' ').map((tok) => {
    const bare = tok.replace(/^(["'])(.*)\1$/, '$2');
    if (!path.isAbsolute(bare)) return tok;
    const rel = path.relative(root, path.resolve(bare)).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return tok;
    return rel;
  }).join(' ');
}

export function checkBash(command, allowedPrefixes, projectDir) {
  const cmd = String(command ?? '').trim();
  if (!cmd) return 'empty command';
  for (const [re, label] of ALWAYS_DENY) {
    if (re.test(cmd)) return `"${label}" is never allowed for this agent (CLAUDE.md rule 7: a human pushes, merges and deploys)`;
  }
  for (const [re, label] of FORBIDDEN_SHELL) {
    if (re.test(cmd)) return `shell metacharacter ${label} is not allowed; run one allowed command at a time`;
  }
  const segments = cmd.split('&&').map((s) => normalizeSegment(s.trim().replace(/\s+/g, ' '), projectDir));
  for (const seg of segments) {
    if (!seg || seg.includes('&')) return 'background (&) or empty command segment is not allowed';
    const ok = allowedPrefixes.some((p) => seg === p || seg.startsWith(p + ' '));
    if (!ok) return `"${seg}" is outside this agent's Bash allowlist: ${allowedPrefixes.map((p) => `"${p}"`).join(', ')}`;
  }
  return null;
}

export function checkWrite(filePath, specs, projectDir, cwd) {
  if (!filePath) return 'no file_path in tool input';
  const allowed = specs.filter((s) => !s.startsWith('!'));
  const denied = specs.filter((s) => s.startsWith('!')).map((s) => s.slice(1));
  const abs = path.resolve(cwd || projectDir, filePath);
  const rel = path.relative(projectDir, abs).split(path.sep).join('/');
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return `${filePath} is outside the project directory`;
  }
  const under = (p) => rel === p.replace(/\/$/, '') || rel.startsWith(p.endsWith('/') ? p : p + '/');
  const hit = denied.find(under);
  if (hit) return `${rel} is explicitly protected for this agent (${hit})`;
  if (!allowed.some(under)) {
    return `${rel} is outside this agent's write scope: ${allowed.join(', ')}`;
  }
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
  let reason = null;
  if (mode === 'bash-allow') {
    if (tool !== 'Bash') process.exit(0);
    reason = checkBash(ti.command, args, projectDir);
  } else if (mode === 'write-scope') {
    if (!['Write', 'Edit', 'NotebookEdit'].includes(tool)) process.exit(0);
    reason = checkWrite(ti.file_path ?? ti.notebook_path, args, projectDir, input.cwd);
  } else {
    reason = `unknown mode "${mode}"; expected write-scope or bash-allow`;
  }
  if (reason) {
    const who = input.agent_type ? `[${input.agent_type}] ` : '';
    process.stderr.write(`tool-guard ${who}blocked ${tool}: ${reason}. If the task needs this, stop and hand off with status: blocked.\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
