#!/usr/bin/env node
// Build the AI-SDLC curriculum SPA: validate modules, sort by level, inline into the template.
// Usage: node build/build.mjs [--strict]   (strict: warnings fail the build)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const schema = JSON.parse(readFileSync(join(ROOT, "build/schema.json"), "utf8"));
const errors = [];
const warnings = [];

// ---- minimal JSON Schema validator (subset used by build/schema.json) ----
function typeOf(v) {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}
function validate(s, v, path, out) {
  if (s.type) {
    const t = typeOf(v);
    const ok = s.type === t || (s.type === "number" && t === "integer");
    if (!ok) { out.push(`${path}: expected ${s.type}, got ${t}`); return; }
  }
  if (s.enum && !s.enum.includes(v)) out.push(`${path}: ${JSON.stringify(v)} not in enum ${JSON.stringify(s.enum)}`);
  if (typeof v === "string") {
    if (s.minLength != null && v.length < s.minLength) out.push(`${path}: string shorter than ${s.minLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${path}: "${v}" does not match ${s.pattern}`);
  }
  if (typeof v === "number") {
    if (s.minimum != null && v < s.minimum) out.push(`${path}: ${v} < minimum ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) out.push(`${path}: ${v} > maximum ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
    if (s.items) v.forEach((item, i) => validate(s.items, item, `${path}[${i}]`, out));
  }
  if (typeOf(v) === "object") {
    for (const r of s.required || []) if (!(r in v)) out.push(`${path}: missing required "${r}"`);
    for (const [k, val] of Object.entries(v)) {
      if (s.properties && s.properties[k]) validate(s.properties[k], val, `${path}.${k}`, out);
      else if (s.additionalProperties === false) out.push(`${path}: unexpected property "${k}"`);
    }
  }
}

// ---- load modules ----
const modDir = join(ROOT, "content/modules");
const modules = [];
for (const name of readdirSync(modDir).filter((f) => f.endsWith(".json")).sort()) {
  const file = join(modDir, name);
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); } catch (e) { errors.push(`${name}: invalid JSON: ${e.message}`); continue; }
  const out = [];
  validate(schema, data, name, out);
  errors.push(...out);
  if (data.id && `${data.id}.json` !== name) errors.push(`${name}: id "${data.id}" does not match filename`);
  modules.push({ name, data });
}

// ---- cross-module checks ----
const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum)\b|\.\.\.\s*$|<your[-_ ]|\[insert/i;
const exIds = new Map();
const modIds = new Set(modules.map((m) => m.data.id));
let fileChecks = 0;
for (const { name, data } of modules) {
  for (const p of data.prerequisites || []) if (/^[0-9]{2}-/.test(p) && !modIds.has(p)) warnings.push(`${name}: prerequisite "${p}" is not a module id`);
  for (const x of data.exercises || []) {
    if (exIds.has(x.id)) errors.push(`${name}: duplicate exercise id "${x.id}" (also in ${exIds.get(x.id)})`);
    exIds.set(x.id, name);
    for (const f of [...(x.implementation || []), ...(x.startingFiles || [])]) {
      if (!f.path.startsWith("AI-SDLC/")) errors.push(`${name}/${x.id}: path "${f.path}" must start with AI-SDLC/`);
    }
    for (const f of x.implementation || []) {
      const disk = join(ROOT, f.path);
      fileChecks++;
      if (!existsSync(disk)) { errors.push(`${name}/${x.id}: implementation file missing on disk: ${f.path}`); continue; }
      const onDisk = readFileSync(disk, "utf8");
      if (onDisk !== f.content && onDisk.trimEnd() !== f.content.trimEnd()) errors.push(`${name}/${x.id}: content differs from disk: ${f.path}`);
    }
    const text = JSON.stringify([x.objective, x.exampleInput, x.expectedOutput, x.testCases, x.evaluationCriteria, x.improvements]);
    if (PLACEHOLDER.test(text.replace(/\\n/g, "\n"))) warnings.push(`${name}/${x.id}: possible placeholder text`);
    if ((x.testCases || []).length < 3) warnings.push(`${name}/${x.id}: fewer than 3 test cases`);
  }
}

modules.sort((a, b) => a.data.level - b.data.level || a.data.id.localeCompare(b.data.id));

// ---- translations: content/i18n/<lang>/<module-id>.json overlay the English module ----
// Allowed translatable fields. Code, commands, file contents, and real outputs stay English.
const I18N_FIELDS = {
  module: ["id", "title", "summary", "prerequisites", "concepts", "diagrams", "comparisonTables", "exercises", "agentContracts", "checklist"],
  concept: ["heading", "body_md"], diagram: ["title"], table: ["title", "columns", "rows"],
  exercise: ["title", "objective", "testCases", "evaluationCriteria", "improvements"], testCase: ["name", "expected"],
  contract: ["purpose", "inputs", "outputs", "must", "mustNot", "failureConditions", "validation", "handoffFormat", "humanGate", "permissions"],
};
const i18n = {};
const i18nDir = join(ROOT, "content/i18n");
const byId = new Map(modules.map((m) => [m.data.id, m.data]));
function checkShape(label, base, ov, allowed, sub) {
  if (typeof ov !== "object" || ov === null || Array.isArray(ov)) { errors.push(`${label}: expected object`); return; }
  for (const k of Object.keys(ov)) {
    if (!allowed.includes(k)) { errors.push(`${label}: field "${k}" is not translatable`); continue; }
    const bv = base[k], v = ov[k];
    if (Array.isArray(bv) && k !== "exercises") {
      if (!Array.isArray(v)) { errors.push(`${label}.${k}: expected array`); continue; }
      if (v.length !== bv.length) warnings.push(`${label}.${k}: ${v.length} items, English has ${bv.length}`);
      if (sub[k]) v.forEach((item, i) => bv[i] !== undefined && checkShape(`${label}.${k}[${i}]`, bv[i], item, I18N_FIELDS[sub[k]], {}));
      if (k === "rows") v.forEach((r, i) => bv[i] && r.length !== bv[i].length && warnings.push(`${label}.rows[${i}]: cell count differs`));
    } else if (k === "exercises") {
      for (const [xid, xo] of Object.entries(v)) {
        const bx = (bv || []).find((x) => x.id === xid);
        if (!bx) { errors.push(`${label}.exercises: unknown exercise "${xid}"`); continue; }
        checkShape(`${label}.exercises.${xid}`, bx, xo, I18N_FIELDS.exercise, { testCases: "testCase" });
      }
    } else if (typeof v !== typeof bv) errors.push(`${label}.${k}: type differs from English`);
  }
}
if (existsSync(i18nDir)) {
  for (const langName of readdirSync(i18nDir)) {
    const dir = join(i18nDir, langName);
    const pack = { modules: {} };
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let ov;
      try { ov = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (e) { errors.push(`i18n/${langName}/${f}: invalid JSON: ${e.message}`); continue; }
      const base = byId.get(ov.id);
      if (!base) { errors.push(`i18n/${langName}/${f}: no English module "${ov.id}"`); continue; }
      checkShape(`i18n/${langName}/${f}`, base, ov, I18N_FIELDS.module, { concepts: "concept", diagrams: "diagram", comparisonTables: "table", agentContracts: "contract" });
      pack.modules[ov.id] = ov;
    }
    const missing = [...byId.keys()].filter((id) => !pack.modules[id]);
    if (missing.length) warnings.push(`i18n/${langName}: untranslated modules fall back to English: ${missing.join(", ")}`);
    i18n[langName] = pack;
  }
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
if (errors.length || (STRICT && warnings.length)) {
  console.error(`\nBuild failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

// ---- inline into template ----
const template = readFileSync(join(ROOT, "src/template.html"), "utf8");
const MARK = "/*__CURRICULUM_DATA__*/null";
if (!template.includes(MARK)) { console.error("template marker not found"); process.exit(1); }
const payload = { builtAt: new Date().toISOString(), modules: modules.map((m) => m.data), i18n };
// Escape "<" so no string can close the <script> element; also escape U+2028/9 for older parsers.
const json = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const html = template.replace(MARK, () => json);
mkdirSync(join(ROOT, "dist"), { recursive: true });
writeFileSync(join(ROOT, "dist/index.html"), html);
// GitHub Pages serves the repo root of main: publish a copy there too.
writeFileSync(join(ROOT, "ai-sdlc-curriculum.html"), html);

// ---- self-containment check: only https CDN references allowed ----
const refs = [...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*?\s(?:src|href)="([^"]+)"/gi)].map((m) => m[1]);
const ALLOWED = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)(\/|$)/;
const bad = refs.filter((r) => !ALLOWED.test(r));
if (bad.length) { console.error(`Non-CDN resource references in dist/index.html: ${bad.join(", ")}`); process.exit(1); }

const exCount = modules.reduce((n, m) => n + m.data.exercises.length, 0);
console.log(`OK  ${modules.length} modules, ${exCount} exercises, ${fileChecks} implementation files verified on disk`);
console.log(`OK  dist/index.html ${(html.length / 1024).toFixed(0)} KiB, external refs: ${refs.length} (all CDN)`);
