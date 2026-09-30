#!/usr/bin/env node
// Validate an ADR drafted by the architecture-review skill against docs/adr/0000-template.md,
// and optionally grade it against a golden case from skills/architecture-review/tests/cases.json.
//
// Usage:
//   node validate-adr.mjs <adr.md> [--repo <dir>] [--bench <dir>] [--status proposed] [--template-only] [--case <cases.json>#<id>] [--json]
//     --repo           every backticked repo path:line must exist under <dir> (the AI-SDLC-frappe root), line within the file
//     --bench          every backticked apps/... path:line (Frappe source) must exist under this bench directory
//     --status         require this exact status (the skill always writes "proposed")
//     --template-only  only check template conformance (no Risks table required); use for human-written ADRs
//     --case           also check the case's mustCite / mustMention / minOptions / minRisks
// Exit codes: 0 valid, 1 invalid or case failed, 2 usage error. Zero dependencies, Node 22.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SECTIONS = ["Context", "Options considered", "Decision", "Consequences", "Verification"];
export const OPTION_COLUMNS = ["option", "pros", "cons", "risk"];
export const RISK_COLUMNS = ["id", "severity", "category", "location", "evidence", "recommendation"];
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const PATH_LINE = /`((?:[\w.-]+\/)*[\w.-]+\.(?:py|json|md|txt|mjs|ya?ml|toml)):(\d+)(?:-(\d+))?`/g;

export function splitRow(line) {
  const out = [];
  let cur = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") { cur += "|"; i++; continue; }
    if (body[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += body[i];
  }
  out.push(cur.trim());
  return out;
}

function tables(text) {
  const result = [];
  let block = [];
  for (const line of [...text.split("\n"), ""]) {
    if (line.trim().startsWith("|")) block.push(line);
    else if (block.length) { result.push(block); block = []; }
  }
  return result.filter((b) => b.length >= 2).map((b) => ({
    header: splitRow(b[0]).map((c) => c.toLowerCase()),
    rows: b.slice(2).map(splitRow),
  }));
}

export function parseAdr(md) {
  const lines = md.split(/\r?\n/);
  const h2 = [];
  const body = new Map();
  let cur = null;
  for (const line of lines) {
    const m = /^## (?!#)(.+?)\s*$/.exec(line);
    if (m) { cur = m[1]; h2.push(cur); body.set(cur, []); continue; }
    if (cur) body.get(cur).push(line);
  }
  const text = new Map([...body].map(([k, v]) => [k, v.join("\n")]));
  const sub = (section, heading) => {
    const t = text.get(section) || "";
    const idx = t.search(new RegExp(`^### ${heading}\\s*$`, "m"));
    if (idx < 0) return null;
    const rest = t.slice(idx).split("\n").slice(1).join("\n");
    const next = rest.search(/^### /m);
    return next < 0 ? rest : rest.slice(0, next);
  };
  return { lines, h2, text, sub };
}

export function validateAdr(md, { repo = null, bench = null, status = null, templateOnly = false } = {}) {
  const errors = [];
  const { lines, h2, text, sub } = parseAdr(md);
  const title = /^# ADR-(\d{4}): (.+)$/.exec(lines[0] || "");
  if (!title) errors.push('first line must be "# ADR-NNNN: Title"');
  const meta = (key) => (lines.find((l) => l.startsWith(`- ${key}:`)) || "").slice(key.length + 3).trim();
  const st = meta("Status");
  if (!/^(proposed|accepted|superseded by ADR-\d{4})$/.test(st)) errors.push(`Status must be proposed | accepted | superseded by ADR-XXXX, got "${st}"`);
  if (status && st !== status) errors.push(`Status must be "${status}", got "${st}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta("Date"))) errors.push(`Date must be YYYY-MM-DD, got "${meta("Date")}"`);
  if (!meta("Deciders")) errors.push("Deciders line missing or empty");

  if (h2.join("|") !== SECTIONS.join("|")) errors.push(`H2 sections must be exactly, in order: ${SECTIONS.join(", ")} (got: ${h2.join(", ")})`);
  for (const s of SECTIONS) if (!(text.get(s) || "").trim()) errors.push(`section "${s}" is empty`);

  const opt = tables(text.get("Options considered") || "")[0];
  let optionCount = 0;
  if (!opt || opt.header.join("|") !== OPTION_COLUMNS.join("|")) errors.push("Options considered needs a table with columns Option | Pros | Cons | Risk");
  else {
    optionCount = opt.rows.length;
    if (optionCount < 2) errors.push(`Options considered needs at least 2 options, got ${optionCount}`);
    opt.rows.forEach((r, i) => { if (r.length !== 4 || r.some((c) => !c)) errors.push(`option row ${i + 1} must fill all 4 cells`); });
  }

  let riskCount = 0;
  if (!templateOnly) {
    const risks = sub("Consequences", "Risks");
    const t = risks ? tables(risks)[0] : null;
    if (!t) errors.push('Consequences needs a "### Risks" table');
    else if (t.header.join("|") !== RISK_COLUMNS.join("|")) errors.push(`Risks table columns must be: ${RISK_COLUMNS.join(" | ")}`);
    else {
      riskCount = t.rows.length;
      if (!riskCount) errors.push("Risks table has no rows");
      t.rows.forEach((r, i) => {
        if (!/^AR-\d{3}$/.test(r[0])) errors.push(`risk row ${i + 1}: id "${r[0]}" must be AR-NNN`);
        if (!SEVERITIES.includes(r[1])) errors.push(`risk row ${i + 1}: severity "${r[1]}" not in ${SEVERITIES.join("|")}`);
        if (!/^`[^`]+:\d+/.test(r[3] || "")) errors.push(`risk row ${i + 1}: location must be a backticked path:line`);
        if (!/`[^`]+`/.test(r[4] || "")) errors.push(`risk row ${i + 1}: evidence must quote code in backticks`);
      });
    }
    if (!sub("Context", "Current architecture \\(evidence\\)")) errors.push('Context needs a "### Current architecture (evidence)" sub-section');
    if (!/\btest_\w+/.test(text.get("Verification") || "")) errors.push("Verification must name concrete tests (test_... methods)");
  }

  const cites = [...md.matchAll(PATH_LINE)].map((m) => ({ path: m[1], from: Number(m[2]), to: Number(m[3] || m[2]) }));
  if (!templateOnly && cites.length < 3) errors.push(`expected at least 3 backticked path:line citations, got ${cites.length}`);
  for (const c of cites) {
    const fromBench = c.path.startsWith("apps/");
    const base = fromBench ? bench : repo;
    if (base) {
      const file = join(base, c.path);
      if (!existsSync(file)) { errors.push(`cited file not found under ${fromBench ? "--bench" : "--repo"}: ${c.path}`); continue; }
      const n = readFileSync(file, "utf8").split("\n").length;
      if (c.to > n || c.from > c.to) errors.push(`cited line ${c.path}:${c.from}${c.to !== c.from ? `-${c.to}` : ""} is outside the file (${n} lines)`);
    }
  }
  return { ok: errors.length === 0, errors, number: title ? title[1] : null, status: st, optionCount, riskCount, cites };
}

export function gradeCase(md, result, testCase) {
  const errors = [];
  const exp = testCase.expected || {};
  const lower = md.toLowerCase();
  for (const p of exp.mustCite || []) if (!result.cites.some((c) => c.path.includes(p)) && !md.includes(p)) errors.push(`case ${testCase.id}: does not cite ${p}`);
  for (const term of exp.mustMention || []) {
    const alts = Array.isArray(term) ? term : [term];
    if (!alts.some((a) => lower.includes(a.toLowerCase()))) errors.push(`case ${testCase.id}: does not mention ${alts.join(" or ")}`);
  }
  for (const term of exp.mustNotMention || []) if (lower.includes(term.toLowerCase())) errors.push(`case ${testCase.id}: mentions forbidden "${term}"`);
  if (exp.minOptions && result.optionCount < exp.minOptions) errors.push(`case ${testCase.id}: ${result.optionCount} options, expected >= ${exp.minOptions}`);
  if (exp.minRisks && result.riskCount < exp.minRisks) errors.push(`case ${testCase.id}: ${result.riskCount} risks, expected >= ${exp.minRisks}`);
  if (exp.status && result.status !== exp.status) errors.push(`case ${testCase.id}: status ${result.status}, expected ${exp.status}`);
  return errors;
}

export function loadCase(spec) {
  const [file, id] = spec.split("#");
  const found = (JSON.parse(readFileSync(file, "utf8")).cases || []).find((c) => c.id === id);
  if (!found) throw new Error(`case "${id}" not found in ${file}`);
  return found;
}

function main(argv) {
  const args = argv.slice(2);
  const take = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const json = flag("--json");
  const templateOnly = flag("--template-only");
  const repo = take("--repo");
  const status = take("--status");
  const bench = take("--bench");
  const caseSpec = take("--case");
  if (!args[0]) { console.error("usage: validate-adr.mjs <adr.md> [--repo dir] [--bench dir] [--status proposed] [--template-only] [--case cases.json#id] [--json]"); return 2; }
  const md = readFileSync(args[0], "utf8");
  const result = validateAdr(md, { repo: repo ? resolve(repo) : null, bench: bench ? resolve(bench) : null, status, templateOnly });
  const errors = [...result.errors];
  if (caseSpec) { try { errors.push(...gradeCase(md, result, loadCase(caseSpec))); } catch (e) { console.error(e.message); return 2; } }
  if (json) console.log(JSON.stringify({ ok: !errors.length, adr: result.number, status: result.status, options: result.optionCount, risks: result.riskCount, citations: result.cites.length, errors }, null, 2));
  else {
    for (const e of errors) console.log(`FAIL ${e}`);
    console.log(`${errors.length ? "INVALID" : "OK"}  ADR-${result.number ?? "????"} status=${result.status || "none"} options=${result.optionCount} risks=${result.riskCount} citations=${result.cites.length}${caseSpec ? ` case=${caseSpec.split("#")[1]}` : ""}`);
  }
  return errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
