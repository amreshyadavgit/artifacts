#!/usr/bin/env node
// Validate a test plan produced by the test-strategy skill against TEST_PLAN_TEMPLATE.md,
// and optionally grade it against a golden case from skills/test-strategy/tests/cases.json.
//
// Usage:
//   node validate-test-plan.mjs <plan.md> [--repo <dir>] [--case <cases.json>#<id>] [--json]
//     --repo  <dir> is the AI-SDLC project root: every `existing` test must exist in
//             sample-app/src/test/java, every `new`/`new-failing` test must not, and cited path:line must resolve
//     --case  also check the case's requiredCategories / mustReferenceTests / mustMention / minCases / minFindings
// Exit codes: 0 valid, 1 invalid or case failed, 2 usage error. Zero dependencies, Node 22.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CATEGORIES = ["unit", "integration", "api", "negative", "edge", "performance", "security", "regression"];
export const SECTIONS = ["Scope", "Risks and defects found while planning", "Test cases", "Coverage matrix", "Test data", "Exit criteria"];
export const CASE_COLUMNS = ["id", "category", "tool", "test", "scenario", "expected", "status"];
export const FINDING_COLUMNS = ["id", "severity", "category", "location", "evidence", "recommendation"];
export const STATUSES = ["existing", "new", "new-failing"];
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const TOOLS = /junit|mockito|mockmvc|h2|springboottest|hibernate statistics|assertj/i;
const TEST_NAME = /^`?([A-Z]\w*Test)#([a-z]\w*)`?$/;
const PATH_LINE = /`((?:[\w.-]+\/)+[\w.-]+\.(?:java|sql|md|ya?ml|json|xml)):(\d+)(?:-(\d+))?`/g;

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

function firstTable(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("|"));
  if (start < 0) return null;
  const block = [];
  for (let i = start; i < lines.length && lines[i].trim().startsWith("|"); i++) block.push(lines[i]);
  if (block.length < 2) return null;
  const header = splitRow(block[0]).map((c) => c.toLowerCase());
  return { header, rows: block.slice(2).map((l) => Object.fromEntries(splitRow(l).map((c, i) => [header[i], c]))) };
}

export function sections(md) {
  const map = new Map();
  const order = [];
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const m = /^## (?!#)(.+?)\s*$/.exec(line);
    if (m) { cur = m[1]; order.push(cur); map.set(cur, []); continue; }
    if (cur) map.get(cur).push(line);
  }
  return { order, text: new Map([...map].map(([k, v]) => [k, v.join("\n")])) };
}

function listJava(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJava(p));
    else if (name.endsWith(".java")) out.push(p);
  }
  return out;
}

export function testExists(repo, cls, method) {
  const files = listJava(join(repo, "sample-app/src/test/java")).filter((f) => f.endsWith(`/${cls}.java`));
  return files.some((f) => new RegExp(`void\\s+${method}\\s*\\(`).test(readFileSync(f, "utf8")));
}

export function validatePlan(md, { repo = null } = {}) {
  const errors = [];
  if (!/^# Test plan: .+/.test(md.split("\n")[0] || "")) errors.push('first line must be "# Test plan: <change>"');
  const { order, text } = sections(md);
  const seen = order.filter((s) => SECTIONS.includes(s));
  for (const s of SECTIONS) if (!text.has(s)) errors.push(`missing section "## ${s}"`);
  if (seen.length === SECTIONS.length && seen.join("|") !== SECTIONS.join("|")) errors.push(`sections out of order: ${seen.join(", ")}`);
  if (!/^### Change surface \(evidence\)/m.test(text.get("Scope") || "")) errors.push('Scope needs "### Change surface (evidence)"');
  if (!/^### Existing coverage/m.test(text.get("Scope") || "")) errors.push('Scope needs "### Existing coverage"');

  const findings = firstTable(text.get("Risks and defects found while planning") || "");
  const findingRows = findings ? findings.rows : [];
  if (findings) {
    if (findings.header.join("|") !== FINDING_COLUMNS.join("|")) errors.push(`findings table columns must be: ${FINDING_COLUMNS.join(" | ")}`);
    for (const f of findingRows) {
      if (!/^TS-\d{3}$/.test(f.id || "")) errors.push(`finding "${f.id}": id must be TS-NNN`);
      if (!SEVERITIES.includes(f.severity)) errors.push(`finding ${f.id}: severity "${f.severity}" invalid`);
      if (!/^`[^`]+:\d+/.test(f.location || "")) errors.push(`finding ${f.id}: location must be a backticked path:line`);
    }
  } else if (!/no (risks|defects)/i.test(text.get("Risks and defects found while planning") || "")) {
    errors.push('Risks section needs a findings table or the sentence "No risks or defects found."');
  }

  const tc = firstTable(text.get("Test cases") || "");
  const cases = tc ? tc.rows : [];
  if (!tc || tc.header.join("|") !== CASE_COLUMNS.join("|")) errors.push(`test case table columns must be: ${CASE_COLUMNS.join(" | ")}`);
  const ids = new Set();
  for (const c of cases) {
    const where = `test case ${c.id || "?"}`;
    if (!/^TC-\d{2,3}$/.test(c.id || "")) errors.push(`${where}: id must be TC-NN`);
    if (ids.has(c.id)) errors.push(`${where}: duplicate id`);
    ids.add(c.id);
    if (!CATEGORIES.includes(c.category)) errors.push(`${where}: category "${c.category}" not in ${CATEGORIES.join("|")}`);
    if (!TOOLS.test(c.tool || "")) errors.push(`${where}: tool "${c.tool}" must name JUnit 5, Mockito, MockMvc, H2, SpringBootTest or Hibernate statistics`);
    const name = TEST_NAME.exec(c.test || "");
    if (!name) errors.push(`${where}: test "${c.test}" must be \`SomethingTest#behaviourName\``);
    if (!STATUSES.includes(c.status)) errors.push(`${where}: status "${c.status}" not in ${STATUSES.join("|")}`);
    if (!c.scenario || !c.expected) errors.push(`${where}: scenario and expected must be filled`);
    if (repo && name && STATUSES.includes(c.status)) {
      const exists = testExists(repo, name[1], name[2]);
      if (c.status === "existing" && !exists) errors.push(`${where}: marked existing but ${name[1]}#${name[2]} is not in sample-app/src/test/java`);
      if (c.status !== "existing" && exists) errors.push(`${where}: marked ${c.status} but ${name[1]}#${name[2]} already exists`);
    }
  }

  const cov = firstTable(text.get("Coverage matrix") || "");
  if (!cov) errors.push("Coverage matrix needs a table");
  else {
    for (const cat of CATEGORIES) {
      const row = cov.rows.find((r) => r.category === cat);
      if (!row) { errors.push(`Coverage matrix: category "${cat}" missing`); continue; }
      const listed = (row.cases || "").match(/TC-\d{2,3}/g) || [];
      const actual = cases.filter((c) => c.category === cat).map((c) => c.id);
      if (!listed.length && !/^N\/A:\s*\S/.test(row.cases || "")) errors.push(`Coverage matrix: "${cat}" needs case ids or "N/A: reason"`);
      for (const id of actual) if (!listed.includes(id)) errors.push(`Coverage matrix: "${cat}" does not list ${id}`);
      for (const id of listed) if (!actual.includes(id)) errors.push(`Coverage matrix: "${cat}" lists ${id}, which is not a ${cat} case`);
    }
  }

  const cites = [...md.matchAll(PATH_LINE)].map((m) => ({ path: m[1], from: Number(m[2]), to: Number(m[3] || m[2]) }));
  if (repo) {
    for (const c of cites) {
      const file = join(repo, c.path);
      if (!existsSync(file)) { errors.push(`cited file not found: ${c.path}`); continue; }
      const n = readFileSync(file, "utf8").split("\n").length;
      if (c.to > n) errors.push(`cited line ${c.path}:${c.to} is outside the file (${n} lines)`);
    }
  }
  if (!/mvn -q -B test/.test(text.get("Exit criteria") || "")) errors.push("Exit criteria must include `mvn -q -B test`");
  return { ok: errors.length === 0, errors, cases, findings: findingRows, cites };
}

export function gradeCase(md, result, testCase) {
  const errors = [];
  const exp = testCase.expected || {};
  const lower = md.toLowerCase();
  for (const cat of exp.requiredCategories || []) if (!result.cases.some((c) => c.category === cat)) errors.push(`case ${testCase.id}: no ${cat} test case`);
  for (const t of exp.mustReferenceTests || []) if (!md.includes(t)) errors.push(`case ${testCase.id}: does not reference ${t}`);
  for (const term of exp.mustMention || []) {
    const alts = Array.isArray(term) ? term : [term];
    if (!alts.some((a) => lower.includes(a.toLowerCase()))) errors.push(`case ${testCase.id}: does not mention ${alts.join(" or ")}`);
  }
  if (exp.minCases && result.cases.length < exp.minCases) errors.push(`case ${testCase.id}: ${result.cases.length} test cases, expected >= ${exp.minCases}`);
  if (exp.minFindings && result.findings.length < exp.minFindings) errors.push(`case ${testCase.id}: ${result.findings.length} findings, expected >= ${exp.minFindings}`);
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
  const take = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = args.includes("--json");
  if (json) args.splice(args.indexOf("--json"), 1);
  const repo = take("--repo");
  const caseSpec = take("--case");
  if (!args[0]) { console.error("usage: validate-test-plan.mjs <plan.md> [--repo dir] [--case cases.json#id] [--json]"); return 2; }
  const md = readFileSync(args[0], "utf8");
  const result = validatePlan(md, { repo: repo ? resolve(repo) : null });
  const errors = [...result.errors];
  if (caseSpec) { try { errors.push(...gradeCase(md, result, loadCase(caseSpec))); } catch (e) { console.error(e.message); return 2; } }
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, result.cases.filter((x) => x.category === c).length]));
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, result.cases.filter((x) => x.status === s).length]));
  if (json) console.log(JSON.stringify({ ok: !errors.length, cases: result.cases.length, byCategory: byCat, byStatus, findings: result.findings.length, errors }, null, 2));
  else {
    for (const e of errors) console.log(`FAIL ${e}`);
    console.log(`${errors.length ? "INVALID" : "OK"}  ${result.cases.length} cases ${JSON.stringify(byCat)} ${JSON.stringify(byStatus)} findings=${result.findings.length}${caseSpec ? ` case=${caseSpec.split("#")[1]}` : ""}`);
  }
  return errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
