#!/usr/bin/env node
// build-timeline.mjs: merge timestamped lines from incident evidence files into one UTC timeline.
// Zero dependencies (Node 22).
//
// Usage:
//   node build-timeline.mjs <file>... [--from ISO] [--to ISO] [--grep REGEX] [--collapse] [--json]
//
// Understands three timestamp styles anywhere in a line:
//   ISO 8601      2026-09-22T08:04:10Z, 2026-09-22T08:03:40.118Z, 2026-09-22T10:04:10+02:00
//   nginx         [22/Sep/2026:08:03:40 +0000]
//   RFC 1123      Tue, 22 Sep 2026 08:23:10 +0000   (kubectl describe)
// Lines without a timestamp (stack frames, table headers) are skipped. `kubectl logs --prefix`
// lines ([pod/<name>/<container>]) are attributed to the pod.
//
// PHI guard: before printing anything, every input line is checked for PHI-like content (MRNs,
// birth dates, name fields, SSN-like numbers, database errors that echo submitted values). On a hit
// the script prints file:line and the rule name only, never the content, and exits 3. Redact the
// evidence and open a privacy incident; do not work around the guard.
//
// Exit codes: 0 ok, 2 usage error, 3 PHI-like content found.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const PHI_RULES = [
  ["MRN value", /\bMRN[-_ ]?\d{3,}\b/i],
  ["birth date field", /\bbirth[_ ]?date\b\s*["']?\s*[:=]/i],
  ["patient name field", /["']?\b(family|given|family_name|given_names)\b["']?\s*[:=]\s*["']?[A-Za-z]/i],
  ["SSN-like number", /\b\d{3}-\d{2}-\d{4}\b/],
  ["database error echoing a submitted value", /Value too long for column|Key \((mrn|family_name|given_names|birth_date)\)=/i],
];

function usage(msg) {
  if (msg) process.stderr.write(`build-timeline: ${msg}\n`);
  process.stderr.write("usage: build-timeline.mjs <file>... [--from ISO] [--to ISO] [--grep REGEX] [--collapse] [--json]\n");
  process.exit(2);
}

const args = process.argv.slice(2);
const files = [];
const opts = { from: null, to: null, grep: null, collapse: false, json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--from" || a === "--to") {
    const v = args[++i];
    const t = Date.parse(v ?? "");
    if (Number.isNaN(t)) usage(`${a} needs an ISO 8601 timestamp`);
    opts[a.slice(2)] = t;
  } else if (a === "--grep") opts.grep = new RegExp(args[++i] ?? usage("--grep needs a pattern"), "i");
  else if (a === "--collapse") opts.collapse = true;
  else if (a === "--json") opts.json = true;
  else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else files.push(a);
}
if (files.length === 0) usage("no evidence files given");

function offsetMs(sign, hh, mm) {
  return (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60000;
}

// Returns { ms, match } for the first timestamp in the line, or null.
function findTimestamp(line) {
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))/);
  if (m) {
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number(m[7]) * 1000) : 0);
    return { ms: m[8] === "Z" ? base : base - offsetMs(m[9], m[10], m[11]), match: m[0] };
  }
  m = line.match(/\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\]/);
  if (m && m[2] in MONTHS) {
    const base = Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]);
    return { ms: base - offsetMs(m[7], m[8], m[9]), match: m[0] };
  }
  m = line.match(/\b\w{3}, (\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})/);
  if (m && m[2] in MONTHS) {
    const base = Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]);
    return { ms: base - offsetMs(m[7], m[8], m[9]), match: m[0] };
  }
  return null;
}

const phiHits = [];
const events = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    usage(`cannot read ${file}: ${e.message}`);
  }
  const name = basename(file);
  text.split(/\r?\n/).forEach((line, idx) => {
    for (const [rule, re] of PHI_RULES) if (re.test(line)) phiHits.push(`${name}:${idx + 1}: ${rule}`);
    const ts = findTimestamp(line);
    if (!ts) return;
    let source = name;
    let rest = line;
    const pod = rest.match(/^\[pod\/([^/\]]+)\/[^\]]+\]\s*/);
    if (pod) {
      source = `${name} (${pod[1].split("-").pop()})`;
      rest = rest.slice(pod[0].length);
    }
    const message = rest.replace(ts.match, " ").replace(/ --- \[[^\]]*\] \[[^\]]*\]/, "").replace(/\s+/g, " ").trim();
    events.push({ ms: ts.ms, time: new Date(ts.ms).toISOString(), source, ref: `${name}:${idx + 1}`, message });
  });
}

if (phiHits.length) {
  process.stderr.write(`build-timeline: PHI-like content found; nothing printed. Redact these lines and raise a privacy incident:\n  ${phiHits.join("\n  ")}\n`);
  process.exit(3);
}

let selected = events
  .filter((e) => (opts.from === null || e.ms >= opts.from) && (opts.to === null || e.ms <= opts.to))
  .filter((e) => opts.grep === null || opts.grep.test(e.message))
  .sort((a, b) => a.ms - b.ms || a.ref.localeCompare(b.ref, undefined, { numeric: true }));

if (opts.collapse) {
  const out = [];
  const shape = (e) => e.source + "|" + e.message.replace(/\d+/g, "#");
  for (const e of selected) {
    const last = out[out.length - 1];
    if (last && shape(last) === shape(e)) {
      last.count = (last.count || 1) + 1;
      last.until = e.time;
    } else out.push({ ...e });
  }
  selected = out;
}

if (opts.json) {
  process.stdout.write(JSON.stringify(selected.map(({ ms, ...rest }) => rest), null, 2) + "\n");
} else {
  const cell = (s) => s.replace(/\|/g, "\\|");
  process.stdout.write("| # | time (UTC) | source | event | ref |\n|---|---|---|---|---|\n");
  selected.forEach((e, i) => {
    let msg = e.message.length > 180 ? e.message.slice(0, 177) + "..." : e.message;
    if (e.count) msg += ` (x${e.count} until ${e.until.slice(11, 19)})`;
    process.stdout.write(`| ${i + 1} | ${e.time.slice(0, 19).replace("T", " ")} | ${cell(e.source)} | ${cell(msg)} | ${e.ref} |\n`);
  });
}
process.stderr.write(`build-timeline: ${selected.length} events from ${files.length} file(s)\n`);
process.exit(0);
