#!/usr/bin/env node
// render-report.mjs: validate a security-review JSON report (spice_lite, Frappe edition) and render it as Markdown.
// Zero dependencies (Node 22).
//
// Usage:
//   node render-report.mjs <report.json | -> [--out report.md] [--fail-on critical|high|medium|low|info]
//
// Checks, in order:
//   1. the report validates against ../report.schema.json (subset of JSON Schema used by that file)
//   2. summary counts equal the findings, and the verdict follows the rule in SKILL.md
//   3. finding ids are unique
//   4. no title, evidence or recommendation contains a non-synthetic MRN (synthetic = MRN-000xxx),
//      a Frappe API key:secret pair, or an unredacted "Form Dict:" dump from logs/frappe.log
// Exit codes: 0 rendered; 1 rendered but a finding is at or above --fail-on; 2 invalid report or usage error.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const here = dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  process.stderr.write(`render-report: ${msg}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
let file = null, out = null, failOn = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i] ?? fail("--out needs a path");
  else if (args[i] === "--fail-on") failOn = args[++i];
  else if (args[i].startsWith("--")) fail(`unknown option ${args[i]}`);
  else if (file === null) file = args[i];
  else fail("only one report file");
}
if (file === null) fail("usage: render-report.mjs <report.json|-> [--out report.md] [--fail-on <severity>]");
if (failOn !== null && !SEVERITIES.includes(failOn)) fail(`--fail-on must be one of ${SEVERITIES.join("|")}`);

let report;
try {
  report = JSON.parse(readFileSync(file === "-" ? 0 : file, "utf8"));
} catch (e) {
  fail(`cannot read JSON from ${file}: ${e.message}`);
}
const schema = JSON.parse(readFileSync(join(here, "..", "report.schema.json"), "utf8"));

// ---- 1. schema validation (type, enum, pattern, minLength, minimum, required, properties, additionalProperties, items)
function typeOf(v) {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}
function validate(s, v, path, errs) {
  if (s.type) {
    const t = typeOf(v);
    if (!(s.type === t || (s.type === "number" && t === "integer"))) { errs.push(`${path}: expected ${s.type}, got ${t}`); return; }
  }
  if (s.enum && !s.enum.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} not one of ${s.enum.join("|")}`);
  if (typeof v === "string") {
    if (s.minLength != null && v.length < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${path}: ${JSON.stringify(v)} does not match ${s.pattern}`);
  }
  if (typeof v === "number" && s.minimum != null && v < s.minimum) errs.push(`${path}: below ${s.minimum}`);
  if (Array.isArray(v) && s.items) v.forEach((item, i) => validate(s.items, item, `${path}[${i}]`, errs));
  if (typeOf(v) === "object") {
    for (const r of s.required || []) if (!(r in v)) errs.push(`${path}: missing "${r}"`);
    for (const [k, val] of Object.entries(v)) {
      if (s.properties && s.properties[k]) validate(s.properties[k], val, `${path}.${k}`, errs);
      else if (s.additionalProperties === false) errs.push(`${path}: unexpected property "${k}"`);
    }
  }
}
const errs = [];
validate(schema, report, "$", errs);
if (errs.length) fail(`report does not match report.schema.json:\n  ${errs.join("\n  ")}`);

// ---- 2. consistency
const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
for (const f of report.findings) counts[f.severity]++;
for (const s of SEVERITIES) {
  if (report.summary[s] !== counts[s]) errs.push(`summary.${s} is ${report.summary[s]} but findings contain ${counts[s]}`);
}
const expectedVerdict = counts.critical + counts.high > 0 ? "block" : counts.medium > 0 ? "needs-decision" : "pass";
if (report.summary.verdict !== expectedVerdict) errs.push(`summary.verdict is "${report.summary.verdict}" but the findings imply "${expectedVerdict}"`);

// ---- 3. unique ids
const seen = new Set();
for (const f of report.findings) {
  if (seen.has(f.id)) errs.push(`duplicate finding id ${f.id}`);
  seen.add(f.id);
}

// ---- 4. PHI and secret guard
// MRNs outside the synthetic MRN-000xxx range, Frappe API tokens ("token <15 hex>:<15 hex>", the shape
// generate_keys() returns) and raw Form Dict dumps must never appear in a report.
const MRN = /\bMRN-(\d+)\b/g;
const API_TOKEN = /\b[0-9a-f]{15}:[0-9a-f]{15}\b/i;
const FORM_DICT = /Form Dict:\s*\{[^}]*'(family|identifier|mrn|first_name|last_name|birth_date|value)'\s*:\s*(?:'(?!\[REDACTED\])[^']+'|[^\s',}][^,}]*)/i;
for (const f of report.findings) {
  for (const field of ["evidence", "recommendation", "title"]) {
    for (const m of f[field].matchAll(MRN)) {
      if (!m[1].startsWith("000")) errs.push(`${f.id}.${field}: contains ${m[0]}, which is not a synthetic MRN; redact it`);
    }
    if (API_TOKEN.test(f[field])) errs.push(`${f.id}.${field}: contains something shaped like a Frappe api_key:api_secret pair; remove it`);
    if (FORM_DICT.test(f[field])) errs.push(`${f.id}.${field}: contains an unredacted Form Dict value; replace it with [REDACTED]`);
  }
}
if (errs.length) fail(`report is inconsistent:\n  ${errs.join("\n  ")}`);

// ---- render
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const sorted = [...report.findings].sort(
  (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id)
);
const lines = [];
lines.push(`# Security review: ${report.scope.target}`);
lines.push("");
lines.push(`- Mode: ${report.scope.mode}${report.scope.ref ? ` (ref ${report.scope.ref})` : ""}`);
lines.push(`- Verdict: **${report.summary.verdict}**`);
lines.push(`- Findings: ${SEVERITIES.map((s) => `${s} ${counts[s]}`).join(", ")}`);
lines.push("");
lines.push("## Findings");
lines.push("");
if (sorted.length === 0) {
  lines.push("No findings.");
} else {
  lines.push("| id | severity | category | location | title | PHI |");
  lines.push("|---|---|---|---|---|---|");
  for (const f of sorted) {
    lines.push(`| ${f.id} | ${f.severity} | ${f.category} | \`${cell(f.location)}\` | ${cell(f.title)} | ${f.phi ? "yes" : "no"} |`);
  }
  for (const f of sorted) {
    lines.push("");
    lines.push(`### ${f.id} (${f.severity}): ${f.title}`);
    lines.push("");
    lines.push(`- Category: ${f.category}${f.cwe ? ` (${f.cwe})` : ""}; confidence ${f.confidence}`);
    lines.push(`- Location: \`${f.location}\``);
    if (f.verifiedBy) lines.push(`- Verified by: \`${f.verifiedBy}\``);
    if (f.related && f.related.length) lines.push(`- Related: ${f.related.join(", ")}`);
    lines.push("");
    lines.push("Evidence:");
    lines.push("");
    lines.push("```text");
    lines.push(f.evidence);
    lines.push("```");
    lines.push("");
    lines.push(`Recommendation: ${f.recommendation}`);
  }
}
lines.push("");
lines.push("## Checked and clean");
lines.push("");
if (report.checkedClean.length === 0) lines.push("None recorded.");
for (const c of report.checkedClean) lines.push(`- **${c.category}**: ${c.evidence}`);
lines.push("");
lines.push("## Limitations");
lines.push("");
if (report.limitations.length === 0) lines.push("None recorded.");
for (const l of report.limitations) lines.push(`- ${l}`);
const md = lines.join("\n") + "\n";

if (out) writeFileSync(out, md);
else process.stdout.write(md);

if (failOn !== null) {
  const limit = SEVERITIES.indexOf(failOn);
  const hit = report.findings.filter((f) => SEVERITIES.indexOf(f.severity) <= limit);
  if (hit.length) {
    process.stderr.write(`render-report: ${hit.length} finding(s) at or above ${failOn}: ${hit.map((f) => f.id).join(", ")}\n`);
    process.exit(1);
  }
}
process.exit(0);
