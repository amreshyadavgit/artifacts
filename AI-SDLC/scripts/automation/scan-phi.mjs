#!/usr/bin/env node
// Deterministic PHI scanner for text an agent is about to hand off or send (handoff files, ticket
// summaries, PR bodies). Regexes, not judgement: the same input always gives the same answer, so it
// can gate a workflow step. It finds identifiers with a fixed shape; it cannot recognise a bare
// person name, which is why the ticket-intake skill also redacts names by instruction.
//
// Usage (from AI-SDLC/):
//   node scripts/automation/scan-phi.mjs FILE...            # exit 1 if anything is found
//   node scripts/automation/scan-phi.mjs --fix FILE...      # rewrite FILE with [REDACTED-*] tokens, then rescan
//   cat notes.txt | node scripts/automation/scan-phi.mjs -  # scan stdin
// Exit 0 = clean, 1 = PHI-shaped content found, 2 = usage error.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Synthetic MRNs in this course are MRN-000xxx (context/domain/fhir-lite-glossary.md); anything else is treated as real.
export const RULES = [
  { kind: "MRN", re: /\bMRN[-\s:#]*(?!000\d{3}\b)\d{4,10}\b/gi },
  { kind: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "DOB", re: /\b(?:dob|date of birth|birth ?date|born(?: on)?)\s*[:=]?\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/gi },
  { kind: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "PHONE", re: /(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g },
  { kind: "NAME", re: /\b(?:patient(?: name)?|pt|name)\s*[:=]\s*(?!Test Patient\b)(?!\[REDACTED)[A-Z][a-z]+(?:[ ,]+[A-Z][a-z]+)+/g },
];

/** Returns [{ kind, line, match }] for one text. */
export function scan(text) {
  const findings = [];
  text.split("\n").forEach((line, i) => {
    for (const { kind, re } of RULES) {
      for (const m of line.matchAll(re)) findings.push({ kind, line: i + 1, match: m[0] });
    }
  });
  return findings;
}

/** Replace every finding with a [REDACTED-KIND] token. */
export function redact(text) {
  let out = text;
  for (const { kind, re } of RULES) {
    out = out.replace(re, (m) => {
      // keep the label ("DOB: ", "Patient name: ") so the sentence still reads
      const label = /^(\D*?[:=]\s*)/.exec(m);
      return kind === "DOB" || kind === "NAME" ? `${label ? label[1] : ""}[REDACTED-${kind}]` : `[REDACTED-${kind}]`;
    });
  }
  return out;
}

// Findings print kind and position only, never the matched value, so the scanner's own output is PHI-free.
function main(argv) {
  const fix = argv.includes("--fix");
  const files = argv.filter((a) => a !== "--fix");
  if (files.length === 0) {
    console.error("usage: scan-phi.mjs [--fix] FILE... | -");
    return 2;
  }
  let total = 0;
  for (const f of files) {
    const text = f === "-" ? readFileSync(0, "utf8") : readFileSync(f, "utf8");
    if (fix && f !== "-") {
      const before = scan(text).length;
      writeFileSync(f, redact(text));
      if (before) console.log(`${f}: redacted ${before} finding(s)`);
    }
    const findings = scan(fix && f !== "-" ? readFileSync(f, "utf8") : text);
    for (const x of findings) console.log(`${f}:${x.line}: ${x.kind} (${x.match.length} chars)`);
    total += findings.length;
  }
  console.log(total ? `FAIL: ${total} PHI-shaped value(s) found` : "PASS: no PHI-shaped values found");
  return total ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
