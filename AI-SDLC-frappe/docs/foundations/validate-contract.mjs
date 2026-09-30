#!/usr/bin/env node
// Validate an Agent Contract markdown file (course convention; see agents/CONTRACT_TEMPLATE.md).
// Frappe edition. Zero dependencies, Node 22.
//
// Usage (from AI-SDLC-frappe/):
//   node docs/foundations/validate-contract.mjs <contract.md> [more.md ...]   validate filled contracts
//   node docs/foundations/validate-contract.mjs --template agents/CONTRACT_TEMPLATE.md   headings only
//   node docs/foundations/validate-contract.mjs --json <contract.md>   print the agentContracts JSON object
// Exit codes: 0 valid, 1 invalid, 2 usage or I/O error.
import { readFileSync } from "node:fs";

export const FIELDS = [
  "purpose", "inputs", "outputs", "tools", "permissions", "must", "mustNot",
  "failureConditions", "validation", "handoffFormat", "humanGate",
];
export const LIST_FIELDS = new Set(["inputs", "outputs", "tools", "must", "mustNot", "failureConditions"]);
export const ROSTER = ["architect", "developer", "reviewer", "tester", "security", "sre", "orchestrator"];
// Built-in tool names as Claude Code spells them (build/CLAUDE_CODE_FACTS.md section 1), plus MCP tools.
const TOOLS = new Set([
  "Read", "Grep", "Glob", "LSP", "Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch",
  "WebSearch", "TodoWrite", "Skill", "ToolSearch", "EnterWorktree", "ExitWorktree", "Monitor",
  "TaskStop", "SendMessage", "Agent",
]);
const MCP_TOOL = /^mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_*-]+)?$/;
const ENFORCEMENT = /\[(mechanism|convention):\s*[^\]]+\]\s*$/;
const GATE_MECHANISM = /plan mode|permissionMode: plan|`ask`|\bask rule|pull[- ]request approval|PR approval|Claude Code hook|exit 2/i;
// bench sub-commands that must never be in an agent's tool scope (FRAPPE_FACTS section 10):
// console and execute run arbitrary Python as Administrator and commit; drop-site and reinstall destroy data.
const BENCH_FORBIDDEN = /\bbench\b[^;\n]*\b(console|execute|drop-site|reinstall)\b/;
const BENCH_MIGRATE = /\bbench\b[^;\n]*\bmigrate\b/;

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripCode = (s) => s.replace(/`[^`\n]*`/g, "``");

export function parseContract(markdown) {
  const text = stripComments(markdown);
  const title = (text.match(/^# Agent Contract:\s*(.+?)\s*$/m) || [])[1] || null;
  const sections = [];
  let current = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^## (\S.*?)\s*$/);
    if (h) { current = { name: h[1], lines: [] }; sections.push(current); continue; }
    if (/^# /.test(line)) { current = null; continue; }
    if (current) current.lines.push(line);
  }
  return { title, sections };
}

// CLAUDE.md rule 5: "hook" alone is ambiguous in a Frappe repo. Returns the number of bare uses.
export function bareHookCount(text) {
  const prose = stripCode(text);
  let n = 0;
  for (const m of prose.matchAll(/\bhooks?\b/gi)) {
    const before = prose.slice(Math.max(0, m.index - 20), m.index);
    if (!/(Frappe|Claude Code)(\s+``)?\s+$/.test(before)) n++;
  }
  return n;
}

export function validateContract(markdown, { template = false } = {}) {
  const errors = [];
  const warnings = [];
  const { title, sections } = parseContract(markdown);
  const names = sections.map((s) => s.name);

  if (!title) errors.push('missing title line "# Agent Contract: <agent>"');
  else if (!template && !ROSTER.includes(title)) errors.push(`agent "${title}" is not in the roster (${ROSTER.join(", ")})`);

  for (const f of FIELDS) {
    const n = names.filter((x) => x === f).length;
    if (n === 0) errors.push(`missing section "## ${f}"`);
    if (n > 1) errors.push(`section "## ${f}" appears ${n} times`);
  }
  const known = names.filter((x) => FIELDS.includes(x));
  const expectedOrder = FIELDS.filter((f) => known.includes(f));
  if (known.join() !== expectedOrder.join()) errors.push(`sections out of order: expected ${expectedOrder.join(", ")}`);
  for (const x of names) if (!FIELDS.includes(x)) warnings.push(`extra section "## ${x}" is not an agentContracts field`);

  if (template) return { ok: errors.length === 0, errors, warnings };

  for (const s of sections) {
    if (!FIELDS.includes(s.name)) continue;
    const body = s.lines.join("\n").trim();
    const bullets = s.lines.filter((l) => /^- \S/.test(l)).map((l) => l.slice(2).trim());
    if (!body) { errors.push(`${s.name}: section is empty`); continue; }
    if (/<[a-z][^>\n]*>/i.test(stripCode(body))) errors.push(`${s.name}: unreplaced <placeholder> text`);
    if (LIST_FIELDS.has(s.name) && bullets.length === 0) errors.push(`${s.name}: needs at least one "- " bullet`);
    if (!LIST_FIELDS.has(s.name) && bullets.length > 0) errors.push(`${s.name}: must be a paragraph, not a bullet list`);
    const bare = bareHookCount(body);
    if (bare) warnings.push(`${s.name}: ${bare} bare "hook" (say "Frappe hook" or "Claude Code hook", CLAUDE.md rule 5)`);
    if (s.name === "must" || s.name === "mustNot") {
      bullets.forEach((b, i) => {
        if (!ENFORCEMENT.test(b)) errors.push(`${s.name}[${i + 1}]: must end with [mechanism: ...] or [convention: ...]`);
      });
      const mech = bullets.filter((b) => /\[mechanism:/.test(b)).length;
      if (s.name === "mustNot" && bullets.length && mech === 0) warnings.push("mustNot: no rule is enforced by a mechanism; all are conventions");
    }
    if (s.name === "tools") {
      bullets.forEach((b) => {
        const name = b.split(/[\s(]/)[0];
        if (!TOOLS.has(name) && !MCP_TOOL.test(name)) errors.push(`tools: "${name}" is not a Claude Code tool name`);
        // only the granted part of the scope counts: "Bash (git diff only; never bench console)" is fine
        const granted = b.split(/\b(never|not|no|except)\b/i)[0];
        const bench = granted.match(BENCH_FORBIDDEN);
        if (bench) errors.push(`tools: "bench ... ${bench[1]}" must not be in a tool scope (arbitrary code as Administrator or destroys a site)`);
        if (BENCH_MIGRATE.test(granted) && !/\bask\b/.test(b)) errors.push('tools: a "bench ... migrate" scope must say it runs behind the `ask` rule');
      });
    }
    if (s.name === "humanGate" && !GATE_MECHANISM.test(body)) {
      errors.push("humanGate: name the real mechanism (plan mode, a permission ask rule, PR approval, or a Claude Code hook that exits 2)");
    }
    if (s.name === "handoffFormat" && !body.includes(".ai-sdlc/runs/")) {
      errors.push("handoffFormat: must name the run-folder path .ai-sdlc/runs/<run-id>/NN-<agent>.md");
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function toAgentContract(markdown) {
  const { title, sections } = parseContract(markdown);
  const out = { agent: title };
  for (const f of FIELDS) {
    const s = sections.find((x) => x.name === f);
    const lines = s ? s.lines : [];
    out[f] = LIST_FIELDS.has(f)
      ? lines.filter((l) => /^- \S/.test(l)).map((l) => l.slice(2).trim())
      : lines.join("\n").trim().replace(/\s*\n\s*/g, " ");
  }
  return out;
}

function main(argv) {
  const template = argv.includes("--template");
  const json = argv.includes("--json");
  const files = argv.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    process.stderr.write("usage: validate-contract.mjs [--template] [--json] <contract.md> [...]\n");
    return 2;
  }
  let failed = false;
  for (const file of files) {
    let md;
    try { md = readFileSync(file, "utf8"); } catch (e) { process.stderr.write(`ERROR ${file}: ${e.message}\n`); return 2; }
    const r = validateContract(md, { template });
    for (const w of r.warnings) process.stderr.write(`WARN  ${file}: ${w}\n`);
    for (const e of r.errors) process.stderr.write(`FAIL  ${file}: ${e}\n`);
    if (!r.ok) { failed = true; continue; }
    if (json) process.stdout.write(JSON.stringify(toAgentContract(md), null, 2) + "\n");
    else process.stdout.write(`OK    ${file}: ${FIELDS.length}/${FIELDS.length} contract sections${template ? " (template mode)" : ""}\n`);
  }
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
