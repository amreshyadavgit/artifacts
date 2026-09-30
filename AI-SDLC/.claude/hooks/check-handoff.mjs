#!/usr/bin/env node
// check-handoff.mjs: validates AI-SDLC handoff documents (format: workflows/README.md).
//
// Hook mode (no arguments, SubagentStop JSON on stdin):
//   Registered for SubagentStop with matcher "architect|developer|reviewer|tester|security|sre"
//   (orchestrator frontmatter, the feature/bug-fix/incident skills, or settings.json).
//   Which handoff is validated, in order:
//     1. a line `HANDOFF: .ai-sdlc/runs/<run-id>/NN-<step>.md` in the final message -> that file;
//   only while a workflow run is active (.ai-sdlc/runs/.active holds a run id):
//     2. the handoff document inline in `last_assistant_message` (front matter `---` / `run_id:`);
//     3. the newest NN-*.md in the active run folder whose `agent` is this subagent;
//     4. none found -> blocked until the subagent produces one.
//   Outside a workflow run, roster agents used ad hoc pass without a handoff.
//   exit 0 = valid (or nothing to check); exit 2 + stderr = invalid, the subagent continues and fixes it.
//
// CLI mode:  node .claude/hooks/check-handoff.mjs <handoff.md | run-folder> ...
//   Prints PASS/FAIL per file. exit 0 = all valid, 1 = at least one invalid.
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, basename, resolve, isAbsolute, relative, sep } from "node:path";

export const ROSTER = ["architect", "developer", "reviewer", "tester", "security", "sre"];
const AGENTS = [...ROSTER, "orchestrator"];
const STATUSES = ["complete", "blocked", "needs-human"];
const NEXT = [...AGENTS, "human", "none"];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const SECTIONS = ["Summary", "Findings", "Decisions", "Open questions", "Artifacts"];
const FINDING_COLUMNS = ["id", "severity", "category", "location", "evidence", "recommendation"];
const RUN_ID = /^\d{4}-\d{2}-\d{2}-(feat|bug|inc)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_FILE = /^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const RUNS_SEGMENT = `${sep}.ai-sdlc${sep}runs${sep}`;

/** Parse the flat YAML front matter used by handoffs (scalars and [a, b] flow lists only). */
export function parseFrontMatter(text) {
  const m = String(text).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return null;
  const fields = {};
  const bad = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) { bad.push(raw.trim()); continue; }
    let value = kv[2].trim();
    if (value.startsWith("[")) {
      if (!value.endsWith("]")) { bad.push(raw.trim()); continue; }
      value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    fields[kv[1]] = value;
  }
  return { fields, bad, body: String(text).slice(m[0].length) };
}

/** Split the Markdown body into { "Summary": "...", ... } by level-2 headings. */
function sections(body) {
  const out = {};
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { current = h[1]; out[current] = ""; continue; }
    if (current) out[current] += line + "\n";
  }
  return out;
}

function cells(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function checkFindings(text, errors) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (rows.length === 0) {
    if (!text.trim()) errors.push('section "## Findings" is empty: add a findings table or state "No findings."');
    return;
  }
  const header = cells(rows[0]).map((c) => c.toLowerCase());
  const missing = FINDING_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) errors.push(`findings table is missing column(s): ${missing.join(", ")} (expected ${FINDING_COLUMNS.join(" | ")})`);
  const sevIdx = header.indexOf("severity");
  for (const row of rows.slice(1)) {
    if (/^\|?\s*:?-{3,}/.test(row.trim())) continue;
    const c = cells(row);
    if (sevIdx >= 0) {
      const sev = (c[sevIdx] || "").toLowerCase().replace(/[`*]/g, "");
      if (!SEVERITIES.includes(sev)) errors.push(`finding "${c[0]}" has severity "${c[sevIdx]}"; use one of ${SEVERITIES.join("|")}`);
    }
  }
}

/**
 * Validate one handoff document.
 * opts.fileName  - basename when validating a file (NN prefix must equal step)
 * opts.runDir    - folder holding the run's handoffs (inputs must exist there)
 * opts.agentType - agent_type from the hook input (must equal `agent`)
 */
export function validateHandoff(text, opts = {}) {
  const errors = [];
  const fm = parseFrontMatter(text);
  if (!fm) return ["missing YAML front matter: the handoff must start with a line '---', the fields run_id, step, agent, status, inputs, next, and a closing '---'"];
  const f = fm.fields;
  for (const b of fm.bad) errors.push(`unparseable front matter line: "${b}"`);
  for (const key of ["run_id", "step", "agent", "status", "inputs", "next"]) {
    if (!(key in f) || f[key] === "") errors.push(`front matter field "${key}" is missing`);
  }
  if (f.run_id && !RUN_ID.test(f.run_id)) errors.push(`run_id "${f.run_id}" must look like 2026-09-30-feat-patient-pagination (date, feat|bug|inc, kebab-case slug)`);
  if (f.step && !/^\d{2}$/.test(f.step)) errors.push(`step "${f.step}" must be two digits, e.g. 03`);
  if (f.agent && !AGENTS.includes(f.agent)) errors.push(`agent "${f.agent}" is not in the roster (${AGENTS.join(", ")})`);
  if (opts.agentType && ROSTER.includes(opts.agentType) && f.agent && f.agent !== opts.agentType) {
    errors.push(`agent "${f.agent}" does not match the subagent that produced it ("${opts.agentType}")`);
  }
  if (f.status && !STATUSES.includes(f.status)) errors.push(`status "${f.status}" must be one of ${STATUSES.join(" | ")}`);
  if ("next" in f && f.next && !NEXT.includes(f.next)) errors.push(`next "${f.next}" must be a roster agent, "human" or "none"`);
  if ("inputs" in f && !Array.isArray(f.inputs)) errors.push('inputs must be a YAML flow list, e.g. [01-requirements.md] or []');

  if (opts.fileName) {
    const m = opts.fileName.match(RUN_FILE);
    if (!m) errors.push(`file name "${opts.fileName}" must be NN-<step-name>.md, e.g. 04-developer.md`);
    else if (f.step && m[1] !== f.step) errors.push(`file name prefix ${m[1]} does not match step ${f.step}`);
  }
  if (opts.runDir && (resolve(opts.runDir) + sep).includes(RUNS_SEGMENT) && f.run_id && basename(resolve(opts.runDir)) !== f.run_id) {
    errors.push(`run_id "${f.run_id}" does not match its run folder "${basename(resolve(opts.runDir))}"`);
  }
  if (Array.isArray(f.inputs)) {
    for (const input of f.inputs) {
      const m = input.match(RUN_FILE);
      if (m) {
        if (f.step && /^\d{2}$/.test(f.step) && Number(m[1]) >= Number(f.step)) errors.push(`input "${input}" is not an earlier step than ${f.step}`);
        if (opts.runDir && existsSync(opts.runDir) && !existsSync(join(opts.runDir, input))) errors.push(`input "${input}" does not exist in ${opts.runDir}`);
      } else if (!/^[a-z]+:\S+$/.test(input)) {
        errors.push(`input "${input}" must be a run file (NN-name.md) or an external reference such as ticket:PAT-142`);
      }
    }
  }

  const s = sections(fm.body);
  for (const name of SECTIONS) if (!(name in s)) errors.push(`section "## ${name}" is missing`);
  if ("Findings" in s) checkFindings(s.Findings, errors);
  if (["blocked", "needs-human"].includes(f.status)) {
    const q = (s["Open questions"] || "").trim();
    if (!q || /^(none|n\/a|-)\.?$/i.test(q)) errors.push(`status "${f.status}" requires at least one concrete item under "## Open questions" (what must the human or next agent decide?)`);
  }
  return errors;
}

/** Pull an inline handoff out of a final message (tolerates a preamble line and a ```markdown fence). */
export function extractInline(message) {
  const text = String(message || "");
  const i = text.search(/(^|\n)---\r?\nrun_id:/);
  if (i < 0) return null;
  return text.slice(text[i] === "\n" ? i + 1 : i).replace(/\n```\s*$/, "\n");
}

function activeRun(projectDir) {
  const marker = join(projectDir, ".ai-sdlc", "runs", ".active");
  if (!existsSync(marker)) return null;
  const id = readFileSync(marker, "utf8").trim();
  return id && id !== "none" ? id : null;
}

function fail(agentType, source, errors) {
  process.stderr.write(
    `Handoff check failed for subagent "${agentType}" (${source}):\n` +
      errors.map((e) => `- ${e}`).join("\n") +
      "\nFix the handoff and end your final message with the complete handoff document " +
      "(front matter + ## Summary, ## Findings, ## Decisions, ## Open questions, ## Artifacts) as defined in workflows/README.md.\n"
  );
  return 2;
}

/** Newest NN-*.md in the run folder whose front matter names this agent (for agents that write their own file). */
function latestFileBy(runDir, agentType) {
  if (!existsSync(runDir)) return null;
  let best = null;
  for (const n of readdirSync(runDir).filter((n) => /^\d{2}-.*\.md$/.test(n))) {
    const p = join(runDir, n);
    const fm = parseFrontMatter(readFileSync(p, "utf8"));
    if (!fm || fm.fields.agent !== agentType) continue;
    const t = statSync(p).mtimeMs;
    if (!best || t > best.t || (t === best.t && n > basename(best.p))) best = { p, t };
  }
  return best && best.p;
}

export function runHook(input, env = process.env) {
  const agentType = input.agent_type;
  if (!ROSTER.includes(agentType)) return 0; // built-ins (Explore, Plan, general-purpose) and forks are not workflow steps
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const runsRoot = join(projectDir, ".ai-sdlc", "runs");
  const message = input.last_assistant_message || "";

  // 1. Explicit pointer: always validated, inside or outside a workflow run.
  const pointer = message.match(/^HANDOFF:\s*(\S+)\s*$/m);
  if (pointer) {
    const p = isAbsolute(pointer[1]) ? pointer[1] : resolve(projectDir, pointer[1]);
    const rel = relative(runsRoot, p);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).length !== 2) {
      return fail(agentType, pointer[1], [`handoff path must be under .ai-sdlc/runs/<run-id>/ (got ${pointer[1]})`]);
    }
    if (!existsSync(p) || !statSync(p).isFile()) return fail(agentType, pointer[1], [`handoff file ${pointer[1]} does not exist`]);
    const errors = validateHandoff(readFileSync(p, "utf8"), { fileName: basename(p), runDir: dirname(p), agentType });
    return errors.length ? fail(agentType, pointer[1], errors) : 0;
  }

  // Outside a workflow run (no .active marker) roster agents may be used ad hoc: nothing to enforce.
  const run = activeRun(projectDir);
  if (!run) return 0;
  const runDir = join(runsRoot, run);

  // 2. Inline handoff (reviewer, security, sre have no Write tool; the orchestrator saves it verbatim).
  const inline = extractInline(message);
  if (inline) {
    const errors = validateHandoff(inline, { runDir, agentType });
    const fm = parseFrontMatter(inline);
    if (fm && fm.fields.run_id && fm.fields.run_id !== run) errors.push(`run_id "${fm.fields.run_id}" is not the active run "${run}" (.ai-sdlc/runs/.active)`);
    return errors.length ? fail(agentType, "inline handoff in final message", errors) : 0;
  }

  // 3. Latest file this agent wrote in the active run (architect, developer, tester write their own).
  const latest = latestFileBy(runDir, agentType);
  if (latest) {
    const errors = validateHandoff(readFileSync(latest, "utf8"), { fileName: basename(latest), runDir, agentType });
    return errors.length ? fail(agentType, relative(projectDir, latest), errors) : 0;
  }

  return fail(agentType, `active run ${run}`, [
    `no handoff found: return the handoff document inline as your final message, or write .ai-sdlc/runs/${run}/NN-${agentType}.md and end with 'HANDOFF: <that path>'`,
  ]);
}

function runCli(args) {
  let failed = 0;
  const files = [];
  for (const a of args) {
    if (existsSync(a) && statSync(a).isDirectory()) {
      for (const n of readdirSync(a).filter((n) => /^\d{2}-.*\.md$/.test(n)).sort()) files.push(join(a, n));
    } else files.push(a);
  }
  if (!files.length) { console.error("usage: check-handoff.mjs <handoff.md | run-folder> ..."); return 1; }
  for (const file of files) {
    if (!existsSync(file)) { console.log(`FAIL  ${file}\n  - file not found`); failed++; continue; }
    const errors = validateHandoff(readFileSync(file, "utf8"), { fileName: basename(file), runDir: dirname(file) });
    if (errors.length) { failed++; console.log(`FAIL  ${file}\n${errors.map((e) => `  - ${e}`).join("\n")}`); }
    else console.log(`PASS  ${file}`);
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length) process.exit(runCli(args));
  let input;
  try { input = JSON.parse(readFileSync(0, "utf8")); }
  catch (e) { process.stderr.write(`check-handoff: could not parse hook input (${e.message}); not blocking\n`); process.exit(1); }
  process.exit(runHook(input));
}
