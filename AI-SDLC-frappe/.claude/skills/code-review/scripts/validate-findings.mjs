#!/usr/bin/env node
// Validate a code-review report (Markdown) against .claude/skills/code-review/output-format.md,
// and optionally grade it against a golden case from skills/code-review/tests/cases.json.
//
// Usage:
//   node validate-findings.mjs <report.md | -> [--repo <dir>] [--case <cases.json>#<case-id>] [--json]
//     --repo   <dir> is the AI-SDLC-frappe project root: every location path must exist under it and
//              the line must be within the (patched) file
//     --case   also check the golden case's expected verdict, required findings and forbidden findings
//     --json   print a JSON result instead of text
// Exit codes: 0 valid (and case passed), 1 invalid or case failed, 2 usage error.
// Frappe edition: also rejects a recommendation that tells the author to switch TO frappe.get_all,
// which does not check permissions (build/FRAPPE_FACTS.md section 6). Zero dependencies, Node 22.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const CATEGORIES = ["correctness", "design", "readability", "testing", "security", "performance", "standards", "docs"];
export const COLUMNS = ["id", "severity", "category", "location", "evidence", "recommendation"];
export const SECTIONS = ["Summary", "Findings", "Details", "Categories checked", "Verdict"];
export const VERDICTS = ["BLOCK", "NEEDS-DECISION", "APPROVE"];

/** Split a Markdown table row into trimmed cells, honouring `\|` escapes. */
export function splitRow(line) {
  const cells = [];
  let cur = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") { cur += "|"; i++; continue; }
    if (body[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Return { sections: Map(name -> text), order: [names] } for level-2 headings. */
export function splitSections(md) {
  const sections = new Map();
  const order = [];
  let current = null;
  for (const line of md.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith("###")) { current = m[1]; order.push(current); sections.set(current, []); continue; }
    if (current) sections.get(current).push(line);
  }
  return { sections: new Map([...sections].map(([k, v]) => [k, v.join("\n")])), order };
}

export function parseFindings(sectionText) {
  const lines = sectionText.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { header: null, rows: [] };
  const header = splitRow(lines[0]).map((c) => c.toLowerCase());
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { header, rows };
}

const rank = (s) => SEVERITIES.indexOf(s);

export function expectedVerdict(findings) {
  if (findings.some((f) => rank(f.severity) >= 0 && rank(f.severity) <= 1)) return "BLOCK";
  if (findings.some((f) => f.severity === "medium")) return "NEEDS-DECISION";
  return "APPROVE";
}

export function validateReport(md, { repo = null, idPattern = /^CR-\d{3}$/ } = {}) {
  const errors = [];
  const { sections, order } = splitSections(md);
  const present = SECTIONS.filter((s) => sections.has(s));
  for (const s of SECTIONS) if (!sections.has(s)) errors.push(`missing section "## ${s}"`);
  const seen = order.filter((s) => SECTIONS.includes(s));
  if (present.length === SECTIONS.length && seen.join("|") !== SECTIONS.join("|")) errors.push(`sections out of order: ${seen.join(", ")}`);

  const { header, rows } = parseFindings(sections.get("Findings") || "");
  if (!header) errors.push("Findings section has no Markdown table");
  else if (header.join("|") !== COLUMNS.join("|")) errors.push(`findings table columns must be: ${COLUMNS.join(" | ")} (got: ${header.join(" | ")})`);

  const ids = new Set();
  let prevRank = -1;
  for (const [i, r] of rows.entries()) {
    const where = `row ${i + 1}${r.id ? ` (${r.id})` : ""}`;
    if (!idPattern.test(r.id || "")) errors.push(`${where}: id "${r.id}" does not match ${idPattern}`);
    if (ids.has(r.id)) errors.push(`${where}: duplicate id`);
    ids.add(r.id);
    if (!SEVERITIES.includes(r.severity)) errors.push(`${where}: severity "${r.severity}" not in ${SEVERITIES.join("|")}`);
    else {
      if (rank(r.severity) < prevRank) errors.push(`${where}: findings must be sorted by severity (critical first)`);
      prevRank = rank(r.severity);
    }
    if (!CATEGORIES.includes(r.category)) errors.push(`${where}: category "${r.category}" not in ${CATEGORIES.join("|")}`);
    const loc = /^`([^`:]+):(\d+)(?:-(\d+))?`/.exec(r.location || "");
    if (!loc) errors.push(`${where}: location must start with a backticked path:line, got "${r.location}"`);
    else if (repo) {
      const file = join(repo, loc[1]);
      if (!existsSync(file)) errors.push(`${where}: location file not found under --repo: ${loc[1]}`);
      else {
        const n = readFileSync(file, "utf8").split("\n").length;
        const last = Number(loc[3] || loc[2]);
        if (last > n) errors.push(`${where}: line ${last} is past the end of ${loc[1]} (${n} lines)`);
      }
    }
    if (!/`[^`]+`/.test(r.evidence || "") && !/^".+"$/.test(r.evidence || "")) errors.push(`${where}: evidence must quote code or output in backticks`);
    if (!/[A-Za-z0-9_.-]+\.md(#[\w-]+)?/.test(r.recommendation || "")) errors.push(`${where}: recommendation must cite a standard, e.g. frappe-coding-standards.md#4`);
    if (/\b(use|switch to|replace (it |this )?with)\s+`?frappe\.get_all\b/i.test(r.recommendation || "")) errors.push(`${where}: recommendation suggests frappe.get_all, which ignores permissions; use frappe.get_list`);
  }

  const details = sections.get("Details") || "";
  for (const id of ids) if (!new RegExp(`^###\\s+${id}\\b`, "m").test(details)) errors.push(`Details: missing "### ${id}"`);

  const checked = sections.get("Categories checked") || "";
  for (const c of CATEGORIES) {
    const line = checked.split("\n").find((l) => new RegExp(`^\\s*[-*]\\s*${c}\\s*:`).test(l));
    if (!line) { errors.push(`Categories checked: "${c}" not listed (write "${c}: no findings" if clean)`); continue; }
    const value = line.split(":").slice(1).join(":").trim();
    const catRows = rows.filter((r) => r.category === c);
    if (/^no findings\b/i.test(value)) {
      if (catRows.length) errors.push(`Categories checked: "${c}" says no findings but the table has ${catRows.map((r) => r.id).join(", ")}`);
    } else {
      const listed = value.match(/[A-Z]+-\d{3}/g) || [];
      for (const r of catRows) if (!listed.includes(r.id)) errors.push(`Categories checked: "${c}" does not list ${r.id}`);
      for (const id of listed) if (!ids.has(id)) errors.push(`Categories checked: "${c}" lists unknown id ${id}`);
    }
  }

  const verdictText = (sections.get("Verdict") || "").trim().split(/\s+/)[0] || "";
  if (!VERDICTS.includes(verdictText)) errors.push(`Verdict must start with one of ${VERDICTS.join("|")}, got "${verdictText}"`);
  else if (verdictText !== expectedVerdict(rows)) errors.push(`Verdict "${verdictText}" is inconsistent with severities (expected ${expectedVerdict(rows)})`);

  return { ok: errors.length === 0, errors, findings: rows, verdict: verdictText };
}

function matches(f, spec) {
  if (spec.category) {
    const cats = Array.isArray(spec.category) ? spec.category : [spec.category];
    if (!cats.includes(f.category)) return false;
  }
  if (spec.minSeverity && !(rank(f.severity) >= 0 && rank(f.severity) <= rank(spec.minSeverity))) return false;
  if (spec.location && !(f.location || "").includes(spec.location)) return false;
  if (spec.evidenceIncludes && !(f.evidence || "").toLowerCase().includes(spec.evidenceIncludes.toLowerCase())) return false;
  return true;
}

/** Grade a validated report against one golden case ({ expected: { verdict, findings, forbidden, maxSeverity } }). */
export function gradeCase(result, testCase) {
  const errors = [];
  const exp = testCase.expected || {};
  if (exp.verdict && result.verdict !== exp.verdict) errors.push(`case ${testCase.id}: verdict ${result.verdict}, expected ${exp.verdict}`);
  for (const spec of exp.findings || []) {
    if (!result.findings.some((f) => matches(f, spec))) errors.push(`case ${testCase.id}: no finding matches ${JSON.stringify(spec)}`);
  }
  for (const spec of exp.forbidden || []) {
    const hit = result.findings.find((f) => matches(f, spec));
    if (hit) errors.push(`case ${testCase.id}: forbidden finding present ${hit.id} matches ${JSON.stringify(spec)}`);
  }
  if (exp.maxSeverity) {
    const worse = result.findings.filter((f) => rank(f.severity) < rank(exp.maxSeverity));
    if (worse.length) errors.push(`case ${testCase.id}: findings above ${exp.maxSeverity}: ${worse.map((f) => f.id).join(", ")}`);
  }
  return errors;
}

export function loadCase(spec) {
  const [file, id] = spec.split("#");
  const data = JSON.parse(readFileSync(file, "utf8"));
  const found = (data.cases || []).find((c) => c.id === id);
  if (!found) throw new Error(`case "${id}" not found in ${file}`);
  return found;
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes("--json");
  if (json) args.splice(args.indexOf("--json"), 1);
  const repo = opt("--repo");
  const caseSpec = opt("--case");
  const input = args[0];
  if (!input) { console.error("usage: validate-findings.mjs <report.md|-> [--repo dir] [--case cases.json#id] [--json]"); return 2; }
  const md = readFileSync(input === "-" ? 0 : input, "utf8");
  const result = validateReport(md, { repo: repo ? resolve(repo) : null });
  const errors = [...result.errors];
  if (caseSpec) {
    try { errors.push(...gradeCase(result, loadCase(caseSpec))); } catch (e) { console.error(e.message); return 2; }
  }
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, result.findings.filter((f) => f.severity === s).length]));
  if (json) console.log(JSON.stringify({ ok: errors.length === 0, verdict: result.verdict, counts, errors }, null, 2));
  else {
    for (const e of errors) console.log(`FAIL ${e}`);
    console.log(`${errors.length ? "INVALID" : "OK"}  ${result.findings.length} findings ${JSON.stringify(counts)} verdict=${result.verdict || "none"}${caseSpec ? ` case=${caseSpec.split("#")[1]}` : ""}`);
  }
  return errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
