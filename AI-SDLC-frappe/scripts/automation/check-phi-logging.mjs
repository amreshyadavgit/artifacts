#!/usr/bin/env node
// Deterministic PHI-in-logs check for Frappe Python code. It finds calls whose output reaches a log file,
// the Error Log DocType, or a client-visible message, and fails when their arguments reference a PHI field.
//
// Sinks:  frappe.logger(...).<level>(), <x>.logger.<level>(), _logger().<level>(), logging.<level>(),
//         logger/log/LOG.<level>()  (debug, info, warning, warn, error, exception, critical)
//         frappe.log_error(), frappe.throw(), frappe.msgprint(), print(), log_access() (spice_lite audit)
// Rules (errors, exit 1):
//   phi-field     an argument references a PHI name as code: `self.mrn`, `doc.last_name`, `family`, `f"{identifier}"`.
//                 Words inside plain string literals do not count ("A patient with this MRN already exists" is fine).
//   whole-doc     an argument dumps a document or the request: `.as_dict()`, `get_valid_dict`, `frappe.form_dict`
//   more-info     frappe.logger(..., with_more_info=True): Frappe then appends frappe.form_dict to every line
// Output names the rule, file, line and the PHI name only; source code is not PHI, but keep the report short.
// Exit 0 = clean, 1 = findings, 2 = usage error.
//
// Usage (from AI-SDLC-frappe/):
//   node scripts/automation/check-phi-logging.mjs                              # sample-app/spice_lite, tests excluded
//   node scripts/automation/check-phi-logging.mjs path/to/app --include-tests
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DIR = join(ROOT, "sample-app", "spice_lite");
// Field and parameter names that carry PHI in spice_lite (context/domain/spice-lite-glossary.md, PHI table).
export const PHI_NAMES = ["mrn", "first_name", "last_name", "birth_date", "family", "given", "identifier", "national_id", "phone", "mobile_no"];
const LEVELS = "debug|info|warning|warn|error|exception|critical";
const SINK = new RegExp(
  String.raw`(?:\bfrappe\.logger\([^)]*\)\.(?:${LEVELS})|\b(?:_?logger\(\)|logger|log|LOG|logging)\.(?:${LEVELS})|\bfrappe\.(?:log_error|throw|msgprint)|(?<![\w.])print|(?<![\w.])log_access)\s*\(`,
  "g"
);

/** Return the text between the "(" at `open` and its matching ")", or null. Skips string literals. */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "#") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < src.length && !src.startsWith(q, j)) j += src[j] === "\\" ? 2 : 1;
      i = j + q.length - 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

/** Remove plain string literal contents; keep the {expressions} of f-strings. */
export function codeOnly(args) {
  return args.replace(/([rRbBuU]?[fF]?[rR]?)("""|'''|"|')((?:\\.|(?!\2)[\s\S])*?)\2/g, (m, prefix, q, body) =>
    /f/i.test(prefix) ? ` ${[...body.matchAll(/\{([^{}]*)\}/g)].map((x) => x[1]).join(" ")} ` : ' "" '
  );
}

export function checkSource(src, file = "<input>") {
  const findings = [];
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(SINK)) {
    const open = m.index + m[0].length - 1;
    const args = argsAt(src, open);
    if (args === null) continue;
    const code = codeOnly(args);
    const sink = m[0].replace(/\s*\($/, "");
    for (const name of PHI_NAMES) {
      if (new RegExp(String.raw`(?<![\w"'])${name}\b(?!\s*=[^=])`).test(code))
        findings.push({ rule: "phi-field", file, line: lineOf(m.index), sink, name });
    }
    if (/\.as_dict\(|get_valid_dict|\bform_dict\b/.test(code)) findings.push({ rule: "whole-doc", file, line: lineOf(m.index), sink, name: code.match(/as_dict|get_valid_dict|form_dict/)[0] });
  }
  for (const m of src.matchAll(/\bfrappe\.logger\s*\(/g)) {
    const args = argsAt(src, m.index + m[0].length - 1) || "";
    if (/with_more_info\s*=\s*True/.test(args)) findings.push({ rule: "more-info", file, line: lineOf(m.index), sink: "frappe.logger", name: "with_more_info=True" });
  }
  return findings;
}

function pyFiles(dir, includeTests) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f.startsWith(".") || f === "node_modules" || f === "__pycache__") continue;
      if (!includeTests && (f === "tests" || /^test_.*\.py$/.test(f))) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".py")) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function main(argv) {
  const includeTests = argv.includes("--include-tests");
  const targets = argv.filter((a) => !a.startsWith("--"));
  if (argv.some((a) => a.startsWith("--") && a !== "--include-tests")) {
    console.error("usage: check-phi-logging.mjs [--include-tests] [DIR_OR_FILE...]");
    return 2;
  }
  const paths = (targets.length ? targets.map((t) => resolve(t)) : [DEFAULT_DIR]).flatMap((p) => {
    if (!existsSync(p)) return [];
    return statSync(p).isDirectory() ? pyFiles(p, includeTests) : [p];
  });
  if (!paths.length) {
    console.error("no Python files found");
    return 2;
  }
  const findings = paths.flatMap((p) => checkSource(readFileSync(p, "utf8"), relative(ROOT, p).startsWith("..") ? p : relative(ROOT, p)));
  for (const f of findings) console.log(`ERROR  ${f.rule}: ${f.file}:${f.line}: ${f.sink}(...) references ${f.name}`);
  console.log(findings.length ? `FAIL: ${findings.length} PHI logging finding(s) in ${paths.length} file(s)` : `PASS: ${paths.length} Python file(s), no PHI reaches a log, Error Log or message`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
