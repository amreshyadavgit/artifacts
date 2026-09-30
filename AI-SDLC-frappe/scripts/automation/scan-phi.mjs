#!/usr/bin/env node
// Deterministic PHI scanner for text: handoff files, ticket summaries, PR bodies, and Frappe log files
// (<bench>/logs/*.log, sites/<site>/logs/*.log). Regexes, not judgement: the same input always gives the same
// answer, so it can gate a workflow step or a CI job. It finds identifiers with a fixed shape; it cannot
// recognise a bare person name, which is why the ticket-intake skill also redacts names by instruction.
//
// Kinds: MRN (except synthetic MRN-000xxx), NATIONAL_ID (labelled), DOB (labelled), EMAIL (except example.com/.org,
// *.test, localhost), PHONE (international +CC..., Kenyan 07xx/01xx, US style), NAME ("Patient name: X Y"),
// FIELD (a PHI field serialised with a value, e.g. 'last_name': 'Kamau' or "family": "Otieno", which is what
// frappe.logger(..., with_more_info=True) writes when it appends frappe.form_dict).
//
// Usage (from AI-SDLC-frappe/):
//   node scripts/automation/scan-phi.mjs FILE...                    # exit 1 if anything is found
//   node scripts/automation/scan-phi.mjs --fix FILE...              # rewrite FILE with [REDACTED-*] tokens, then rescan
//   node scripts/automation/scan-phi.mjs --ignore EMAIL FILE...     # e.g. audit logs, which record staff users
//   cat notes.txt | node scripts/automation/scan-phi.mjs -          # scan stdin
// Exit 0 = clean, 1 = PHI-shaped content found, 2 = usage error.
// Findings print kind, line and length only, never the matched value, so the output is safe to paste.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SYNTHETIC_VALUE = String.raw`(?:Test|Patient|Test Patient|MRN-000\d{3}|\[REDACTED[^\]]*\])`;
export const RULES = [
  { kind: "MRN", re: /\bMRN[-\s:#]*(?!000\d{3}\b)\d{4,10}\b/gi },
  { kind: "NATIONAL_ID", re: /\b(?:national[ _-]?id|id(?:entity)?[ _-]?(?:no|number)|huduma(?: number)?)\.?\s*[:#=]?\s*\d{6,10}\b/gi },
  { kind: "DOB", re: /\b(?:dob|date of birth|birth[ _]?date|born(?: on)?)["']?\s*[:=]?\s*["']?\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/gi },
  { kind: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)(?![A-Za-z0-9.-]*\.test\b)(?!localhost\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    kind: "PHONE",
    re: /(?<![\w-])(?:\+\d{1,3}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4}){2,3}|0[17]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})(?![\w-])/g,
  },
  { kind: "NAME", re: /\b(?:patient(?: name)?|pt|name)\s*[:=]\s*(?!Test Patient\b)(?!\[REDACTED)[A-Z][a-z]+(?:[ ,]+[A-Z][a-z]+)+/g },
  {
    kind: "FIELD",
    re: new RegExp(
      String.raw`["']?\b(?:mrn|first_name|last_name|birth_date|family|given|identifier|national_id)["']?\s*[:=]\s*["'](?!${SYNTHETIC_VALUE}["'])[^"'\n]{2,}["']`,
      "g"
    ),
  },
];

/** Returns [{ kind, line, match }] for one text. */
export function scan(text, ignore = []) {
  const findings = [];
  text.split("\n").forEach((line, i) => {
    for (const { kind, re } of RULES) {
      if (ignore.includes(kind)) continue;
      for (const m of line.matchAll(re)) findings.push({ kind, line: i + 1, match: m[0] });
    }
  });
  return findings;
}

/** Replace every finding with a [REDACTED-KIND] token, keeping labels so the sentence still reads. */
export function redact(text, ignore = []) {
  let out = text;
  for (const { kind, re } of RULES) {
    if (ignore.includes(kind)) continue;
    out = out.replace(re, (m) => {
      if (kind === "FIELD") return m.replace(/(["'])[^"']*\1$/, (q) => `${q[0]}[REDACTED]${q[0]}`);
      const label = /^(\D*?[:=#]\s*)/.exec(m);
      return ["DOB", "NAME", "NATIONAL_ID"].includes(kind) ? `${label ? label[1] : ""}[REDACTED-${kind}]` : `[REDACTED-${kind}]`;
    });
  }
  return out;
}

function main(argv) {
  const fix = argv.includes("--fix");
  const ignore = [];
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fix") continue;
    if (argv[i] === "--ignore") ignore.push(...(argv[++i] || "").split(",").map((s) => s.trim().toUpperCase()));
    else files.push(argv[i]);
  }
  if (files.length === 0 || ignore.some((k) => !RULES.some((r) => r.kind === k))) {
    console.error(`usage: scan-phi.mjs [--fix] [--ignore ${RULES.map((r) => r.kind).join(",")}] FILE... | -`);
    return 2;
  }
  let total = 0;
  for (const f of files) {
    const text = f === "-" ? readFileSync(0, "utf8") : readFileSync(f, "utf8");
    if (fix && f !== "-") {
      const before = scan(text, ignore).length;
      writeFileSync(f, redact(text, ignore));
      if (before) console.log(`${f}: redacted ${before} finding(s)`);
    }
    const findings = scan(fix && f !== "-" ? readFileSync(f, "utf8") : text, ignore);
    for (const x of findings) console.log(`${f}:${x.line}: ${x.kind} (${x.match.length} chars)`);
    total += findings.length;
  }
  console.log(total ? `FAIL: ${total} PHI-shaped value(s) found` : "PASS: no PHI-shaped values found");
  return total ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
