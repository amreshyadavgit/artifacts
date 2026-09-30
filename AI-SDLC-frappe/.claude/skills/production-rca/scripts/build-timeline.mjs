#!/usr/bin/env node
// build-timeline.mjs: merge timestamped lines from Frappe incident evidence into one UTC timeline.
// Zero dependencies (Node 22).
//
// Usage:
//   node build-timeline.mjs <file>... [--date YYYY-MM-DD] [--offset <file>=+HH:MM]... [--from ISO] [--to ISO]
//                           [--grep REGEX] [--collapse] [--json]
//
// Timestamp styles understood (first one found in a line wins):
//   ISO 8601        2026-09-22T08:04:10Z, 2026-09-22T11:04:10.118+03:00         (change calendars, samplers)
//   nginx           [22/Sep/2026:08:03:40 +0000]                                 (nginx / gunicorn access logs)
//   space-separated 2026-09-22 08:04:05 +0000, 2026-09-22 08:01:58.310 UTC     (gunicorn error log, Postgres log)
//   naive           2026-09-22 11:10:00.412118                                   (Error Log `creation`: site local time)
//   time only       08:10:00 default: ...  at line start                         (RQ worker.log; needs --date)
// A timestamp without a zone is read in the offset given for that file with --offset <basename>=+03:00;
// without one it is taken as UTC and a warning is printed, because Frappe stores Error Log, Version and
// document timestamps in the site's time zone, not in UTC.
//
// PHI and secret guard: every input line is checked before anything is printed (MRNs, Form Dict dumps with
// patient fields, PHI query parameters, traceback locals holding patient fields, SL Patient INSERT/UPDATE
// statements with values, Frappe API tokens, site_config secrets). On a hit the script prints file:line and
// the rule name only, never the content, and exits 3. Redact the evidence and raise a privacy incident; do
// not work around the guard.
//
// Exit codes: 0 ok, 2 usage error, 3 PHI-like or secret-like content found.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const PHI_FIELDS = "family|given|identifier|mrn|first_name|last_name|birth_date|birthdate";
const GUARD_RULES = [
  ["MRN value", /\bMRN[-_ ]?\d{3,}\b/i],
  ["Form Dict with patient fields", new RegExp(`Form Dict:.*['"](${PHI_FIELDS})['"]\\s*:\\s*(?!['"]?\\[)`, "i")],
  ["PHI query parameter", new RegExp(`[?&](${PHI_FIELDS})=(?!\\[)[^&\\s"]+`, "i")],
  ["traceback local holding a patient field", new RegExp(`^\\s*(${PHI_FIELDS})\\s*=\\s*['"][^'"]+['"]`, "i")],
  ["SL Patient write with values", /(INSERT INTO|UPDATE)\s+["`]tabSL Patient["`].*(VALUES|SET)/i],
  ["Frappe API token", /\btoken\s+[0-9a-f]{15}:[0-9a-f]{15}\b|\b[0-9a-f]{15}:[0-9a-f]{15}\b/i],
  ["site_config secret", /["']?(db_password|encryption_key|admin_password)["']?\s*[:=]/i],
];

function usage(msg) {
  if (msg) process.stderr.write(`build-timeline: ${msg}\n`);
  process.stderr.write("usage: build-timeline.mjs <file>... [--date YYYY-MM-DD] [--offset <file>=+HH:MM]... [--from ISO] [--to ISO] [--grep REGEX] [--collapse] [--json]\n");
  process.exit(2);
}

function parseOffset(text) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(text ?? "");
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

const args = process.argv.slice(2);
const files = [];
const offsets = new Map();
const opts = { from: null, to: null, grep: null, collapse: false, json: false, date: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--from" || a === "--to") {
    const t = Date.parse(args[++i] ?? "");
    if (Number.isNaN(t)) usage(`${a} needs an ISO 8601 timestamp`);
    opts[a.slice(2)] = t;
  } else if (a === "--date") {
    const d = args[++i] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) usage("--date needs YYYY-MM-DD");
    opts.date = d;
  } else if (a === "--offset") {
    const [name, off] = (args[++i] ?? "").split("=");
    const ms = parseOffset(off);
    if (!name || ms === null) usage("--offset needs <file basename>=+HH:MM");
    offsets.set(name, ms);
  } else if (a === "--grep") opts.grep = new RegExp(args[++i] ?? usage("--grep needs a pattern"), "i");
  else if (a === "--collapse") opts.collapse = true;
  else if (a === "--json") opts.json = true;
  else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else files.push(a);
}
if (files.length === 0) usage("no evidence files given");

const ZONE_UTC = /^(Z|UTC|GMT)$/i;
function zoneMs(zone) {
  if (!zone) return null;
  if (ZONE_UTC.test(zone)) return 0;
  return parseOffset(zone);
}

// Returns { ms, match, naive } for the first timestamp in the line, or { timeOnly: true } or null.
function findTimestamp(line, fileOffset) {
  const local = (base, zone) => {
    const z = zoneMs(zone);
    if (z !== null) return { ms: base - z, naive: false };
    return { ms: base - (fileOffset ?? 0), naive: fileOffset === undefined };
  };
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/);
  if (m) {
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number(m[7]) * 1000) : 0);
    return { ...local(base, m[8]), match: m[0] };
  }
  m = line.match(/\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\]/);
  if (m && m[2] in MONTHS) {
    const base = Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]);
    return { ...local(base, m[7]), match: m[0] };
  }
  m = line.match(/\[?(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?(?: ([+-]\d{4}|UTC|GMT|Z)\b)?\]?/);
  if (m) {
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number(m[7]) * 1000) : 0);
    return { ...local(base, m[8]), match: m[0] };
  }
  m = line.match(/^(\d{2}):(\d{2}):(\d{2})\s/);
  if (m) {
    if (!opts.date) return { timeOnly: true };
    const [y, mo, d] = opts.date.split("-").map(Number);
    const base = Date.UTC(y, mo - 1, d, +m[1], +m[2], +m[3]);
    return { ...local(base, null), match: m[0].trim() };
  }
  return null;
}

const guardHits = [];
const events = [];
const naiveByFile = new Map();
let timeOnlySkipped = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    usage(`cannot read ${file}: ${e.message}`);
  }
  const name = basename(file);
  const fileOffset = offsets.has(name) ? offsets.get(name) : undefined;
  text.split(/\r?\n/).forEach((line, idx) => {
    for (const [rule, re] of GUARD_RULES) if (re.test(line)) guardHits.push(`${name}:${idx + 1}: ${rule}`);
    if (line.startsWith("#")) return; // comments in exported evidence
    const ts = findTimestamp(line, fileOffset);
    if (!ts) return;
    if (ts.timeOnly) { timeOnlySkipped++; return; }
    if (ts.naive) naiveByFile.set(name, (naiveByFile.get(name) || 0) + 1);
    const message = line.replace(ts.match, " ").replace(/^[\s|]+|[\s|]+$/g, "").replace(/\s+/g, " ");
    events.push({ ms: ts.ms, time: new Date(ts.ms).toISOString(), source: name, ref: `${name}:${idx + 1}`, message });
  });
}

if (guardHits.length) {
  process.stderr.write(`build-timeline: PHI-like or secret-like content found; nothing printed. Redact these lines and raise a privacy incident:\n  ${guardHits.join("\n  ")}\n`);
  process.exit(3);
}

let selected = events
  .filter((e) => (opts.from === null || e.ms >= opts.from) && (opts.to === null || e.ms <= opts.to))
  .filter((e) => opts.grep === null || opts.grep.test(e.message))
  .sort((a, b) => a.ms - b.ms || a.ref.localeCompare(b.ref, undefined, { numeric: true }));

if (opts.collapse) {
  const out = [];
  // Same source and same message once ids, pids, quoted literals and durations are masked. Counters
  // such as queue lengths are NOT masked, so samples with different values stay separate rows.
  const shape = (e) =>
    e.source + "|" + e.message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
      .replace(/'[^']*'/g, "?")
      .replace(/\bpid:? ?\d+/g, "pid:#")
      .replace(/\[\d+\]/g, "[#]")
      .replace(/\d+\.\d+/g, "#");
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
for (const [name, n] of naiveByFile) {
  process.stderr.write(`build-timeline: warning: ${n} timestamp(s) without a zone in ${name} taken as UTC; pass --offset ${name}=+HH:MM if they are site-local\n`);
}
if (timeOnlySkipped) process.stderr.write(`build-timeline: warning: ${timeOnlySkipped} time-only line(s) skipped; pass --date YYYY-MM-DD\n`);
process.stderr.write(`build-timeline: ${selected.length} events from ${files.length} file(s)\n`);
process.exit(0);
