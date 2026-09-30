#!/usr/bin/env node
// Deterministic lint for Frappe DocType JSON files. Every rule is checkable from the file alone, so the same
// diff always gets the same answer, and a convincing PR description cannot talk it out of one.
//
// Errors (exit 1), per <app>/<module>/doctype/<folder>/<folder>.json:
//   shape      not JSON, doctype != "DocType", or the folder is not the scrubbed DocType name
//   field_order   field_order and fields disagree (a field missing from one of them)
//   index      a field used for filtering or lookup has neither search_index nor unique:
//              in_standard_filter: 1, listed in search_fields, the sort_field, or a mandatory Link (the join key)
//   naming     autoname / naming_rule uses a PHI field ("field:mrn", "format:...{last_name}..."), or a clinical
//              DocType is named "Set by user" / "prompt" (people type the patient's name)
//   perms      a forbidden role (Guest, All), a role the policy does not know, a missing required right,
//              or a forbidden right (for example delete or export for Clinician), per scripts/automation/doctype-policy.json
// Exit 0 = pass, 1 = violation, 2 = usage error.
//
// Usage (from AI-SDLC-frappe/):
//   node scripts/automation/lint-doctype-json.mjs                          # every DocType under sample-app/spice_lite
//   node scripts/automation/lint-doctype-json.mjs path/to/x.json ...       # only these files
//   node scripts/automation/lint-doctype-json.mjs --policy other.json --json
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_APP = join(ROOT, "sample-app", "spice_lite");
const DEFAULT_POLICY = join(HERE, "doctype-policy.json");
const LAYOUT = new Set(["Section Break", "Column Break", "Tab Break"]);
const STANDARD = new Set(["name", "creation", "modified", "owner", "modified_by", "idx", "docstatus"]);
const PTYPES = ["read", "write", "create", "delete", "submit", "cancel", "amend", "report", "export", "import", "share", "print", "email", "select"];

/** Frappe's scrub(): "SL Patient" -> "sl_patient". */
export const scrub = (name) => name.replace(/[\s-]+/g, "_").toLowerCase();

export function lintDoctype(doc, { folder, policy }) {
  const errors = [];
  const warnings = [];
  const e = (rule, msg) => errors.push(`${rule}: ${doc?.name ?? folder}: ${msg}`);
  if (!doc || doc.doctype !== "DocType" || typeof doc.name !== "string") {
    errors.push(`shape: ${folder}: not a DocType JSON (doctype must be "DocType" and name a string)`);
    return { errors, warnings };
  }
  if (folder && scrub(doc.name) !== folder) e("shape", `folder "${folder}" should be "${scrub(doc.name)}"`);

  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const byName = new Map(fields.map((f) => [f.fieldname, f]));
  const order = Array.isArray(doc.field_order) ? doc.field_order : [];
  for (const f of fields) if (!order.includes(f.fieldname)) e("field_order", `field "${f.fieldname}" is missing from field_order`);
  for (const n of order) if (!byName.has(n)) e("field_order", `field_order lists "${n}" but no such field exists`);

  // --- index rules
  const indexed = (f) => Number(f.search_index) === 1 || Number(f.unique) === 1;
  const need = new Map(); // fieldname -> [reasons]
  const add = (n, why) => need.set(n, [...(need.get(n) || []), why]);
  for (const f of fields) {
    if (LAYOUT.has(f.fieldtype)) continue;
    if (Number(f.in_standard_filter) === 1) add(f.fieldname, "in_standard_filter");
    if (f.fieldtype === "Link" && Number(f.reqd) === 1) add(f.fieldname, "mandatory Link (join key)");
  }
  for (const n of String(doc.search_fields || "").split(",").map((s) => s.trim()).filter(Boolean)) if (!STANDARD.has(n)) add(n, "search_fields");
  if (doc.sort_field && !STANDARD.has(doc.sort_field)) add(doc.sort_field, "sort_field");
  for (const [n, reasons] of need) {
    const why = reasons.join(" and ");
    const f = byName.get(n);
    if (!f) e("index", `${why} names "${n}", which is not a field`);
    else if (!indexed(f)) e("index", `"${n}" is used as ${why} but has neither search_index nor unique; add "search_index": 1 (and a patch if the table is large)`);
  }

  // --- naming rules
  const phi = new Set(policy.phiFields?.[doc.name] || []);
  const clinical = (policy.clinicalDoctypes || []).includes(doc.name);
  const autoname = String(doc.autoname || "");
  const namedBy = [];
  if (autoname.startsWith("field:")) namedBy.push(autoname.slice(6).trim());
  for (const m of autoname.matchAll(/\{([a-z0-9_]+)\}/g)) namedBy.push(m[1]);
  for (const n of namedBy) if (phi.has(n)) e("naming", `autoname "${autoname}" builds the document name from PHI field "${n}"; names end up in URLs, Link fields, Version and logs. Use a series such as "SLP-.#####"`);
  if (clinical && (autoname === "prompt" || doc.naming_rule === "Set by user")) e("naming", `clinical DocType is named by the user ("${autoname || doc.naming_rule}"); use a series`);

  // --- permissions
  const rules = policy.permissions?.[doc.name] || policy.permissions?.default || {};
  const perms = Array.isArray(doc.permissions) ? doc.permissions : [];
  if (clinical || policy.permissions?.[doc.name]) {
    for (const p of perms) {
      const where = `permissions[role=${p.role}, permlevel=${p.permlevel ?? 0}]`;
      if ((policy.forbiddenRoles || []).includes(p.role)) {
        e("perms", `${where}: role "${p.role}" must never have rights on this DocType`);
        continue;
      }
      const rule = rules[p.role];
      if (!rule) {
        e("perms", `${where}: role "${p.role}" is not in scripts/automation/doctype-policy.json; add it there (security review) before granting rights`);
        continue;
      }
      if (Number(p.permlevel || 0) !== 0) continue; // higher permlevels only narrow field access
      for (const r of rule.required || []) if (Number(p[r]) !== 1) e("perms", `${where}: missing required right "${r}"`);
      for (const r of rule.forbidden || []) if (Number(p[r]) === 1) e("perms", `${where}: forbidden right "${r}"`);
      for (const k of Object.keys(p)) if (!PTYPES.includes(k) && !["role", "permlevel", "if_owner"].includes(k)) warnings.push(`perms: ${doc.name}: ${where}: unknown key "${k}"`);
    }
    for (const role of Object.keys(rules)) if (!perms.some((p) => p.role === role)) e("perms", `role "${role}" from the policy has no permissions row`);
  }
  return { errors, warnings };
}

function findDoctypeJson(dir) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f.startsWith(".")) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".json") && basename(dirname(dirname(p))) === "doctype" && f === `${basename(dirname(p))}.json`) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

export function lintFiles(files, policy) {
  const errors = [];
  const warnings = [];
  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      errors.push(`shape: ${file}: not valid JSON (${err.message})`);
      continue;
    }
    const r = lintDoctype(doc, { folder: basename(dirname(file)), policy });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings, files: files.map((f) => (relative(ROOT, f).startsWith("..") ? f : relative(ROOT, f))) };
}

function main(argv) {
  let policyPath = DEFAULT_POLICY;
  let json = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--policy") policyPath = resolve(argv[++i]);
    else if (argv[i] === "--json") json = true;
    else if (argv[i].startsWith("--")) {
      console.error(`unknown argument: ${argv[i]}\nusage: lint-doctype-json.mjs [--policy FILE] [--json] [FILE_OR_DIR...]`);
      return 2;
    } else files.push(resolve(argv[i]));
  }
  if (!existsSync(policyPath)) {
    console.error(`policy not found: ${policyPath}`);
    return 2;
  }
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const targets = (files.length ? files : [DEFAULT_APP]).flatMap((p) => (statSync(p).isDirectory() ? findDoctypeJson(p) : [p]));
  const r = lintFiles(targets, policy);
  if (json) console.log(JSON.stringify({ ok: r.errors.length === 0, ...r }, null, 2));
  else {
    for (const f of r.files) console.log(`CHECK  ${f}`);
    for (const w of r.warnings) console.log(`WARN   ${w}`);
    for (const x of r.errors) console.log(`ERROR  ${x}`);
    console.log(r.errors.length ? `FAIL: ${r.errors.length} DocType rule violation(s)` : `PASS: ${r.files.length} DocType file(s)`);
  }
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
