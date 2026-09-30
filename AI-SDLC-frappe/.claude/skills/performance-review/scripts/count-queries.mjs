#!/usr/bin/env node
// count-queries.mjs: count SQL statements by shape and flag N+1 signatures (spice_lite, Frappe edition).
// Zero dependencies (Node 22).
//
// Reads two kinds of input:
//   1. "SQL: <statement>" lines, as printed by examples/lastn-fix/test_lastn_query_count.py
//   2. a PostgreSQL server log with log_min_duration_statement or log_statement enabled:
//        2026-09-22 08:04:10.118 UTC [4312] app@db LOG:  duration: 312.114 ms  statement: SELECT ...
//        2026-09-22 08:04:10.118 UTC [4312] app@db LOG:  statement: SELECT ...
//      Continuation lines (a multi-line statement) are joined to the statement they belong to.
//
// Usage:
//   node count-queries.mjs <log-file | -> [--from REGEX] [--to REGEX] [--threshold N] [--json] [--fail-on-suspect]
//
//   --from / --to     only count statements after the first line matching --from and before the next line
//                     matching --to (the test prints LASTN_BEGIN / LASTN_END around one lastn() call)
//   --threshold N     a SELECT shape repeated N or more times is an N+1 suspect (default 5)
//   --json            machine-readable output
//   --fail-on-suspect exit 1 when at least one suspect is found (for CI or a Claude Code hook)
//
// Exit codes: 0 ok, 1 suspect found with --fail-on-suspect, 2 usage error.
// Output never contains literal values: string and numeric literals become "?" and IN lists collapse
// to "(?+)", so document names, MRNs or measurement values in the log are not echoed.
import { readFileSync } from "node:fs";

function usage(msg) {
  if (msg) process.stderr.write(`count-queries: ${msg}\n`);
  process.stderr.write("usage: count-queries.mjs <log-file|-> [--from REGEX] [--to REGEX] [--threshold N] [--json] [--fail-on-suspect]\n");
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { threshold: 5, json: false, failOnSuspect: false, from: null, to: null, file: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json") opts.json = true;
  else if (a === "--fail-on-suspect") opts.failOnSuspect = true;
  else if (a === "--threshold") opts.threshold = Number(args[++i]);
  else if (a === "--from") opts.from = new RegExp(args[++i] ?? usage("--from needs a value"));
  else if (a === "--to") opts.to = new RegExp(args[++i] ?? usage("--to needs a value"));
  else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else if (opts.file === null) opts.file = a;
  else usage("only one log file");
}
if (opts.file === null) usage("missing log file");
if (!Number.isInteger(opts.threshold) || opts.threshold < 2) usage("--threshold must be an integer >= 2");

let text;
try {
  text = readFileSync(opts.file === "-" ? 0 : opts.file, "utf8");
} catch (e) {
  usage(`cannot read ${opts.file}: ${e.message}`);
}

const TEST_LINE = /^SQL:\s+(.+)$/;
const PG_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \w+ .*?LOG:\s+(?:duration: ([\d.]+) ms\s+)?(?:statement|execute [^:]+):\s+(.*)$/;
const PG_ANY = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/; // any new Postgres log record ends a continuation

function normalize(sql) {
  return sql
    .trim()
    .toLowerCase()
    .replace(/'(?:[^']|'')*'/g, "?")                 // string literals ('SLP-00016', timestamps)
    .replace(/\$\d+/g, "?")                          // server-side bind placeholders
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")              // numeric literals
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, "(?+)")  // IN lists of any length collapse to one shape
    .replace(/\s+/g, " ");
}

const statements = []; // { sql, ms }
let active = opts.from === null;
let windowFound = opts.from === null;
let open = null; // Postgres statement that may continue on the next lines
for (const line of text.split(/\r?\n/)) {
  if (!active && opts.from && opts.from.test(line)) { active = true; windowFound = true; continue; }
  if (active && opts.to && opts.to.test(line)) { open = null; if (opts.from) break; active = false; continue; }
  if (!active) continue;
  let m = line.match(TEST_LINE);
  if (m) { open = null; statements.push({ sql: m[1], ms: null }); continue; }
  m = line.match(PG_LINE);
  if (m) { open = { sql: m[2], ms: m[1] ? Number(m[1]) : null }; statements.push(open); continue; }
  if (PG_ANY.test(line)) { open = null; continue; }
  if (open && /^\s/.test(line)) open.sql += " " + line.trim();
}
if (!windowFound) usage(`--from pattern ${opts.from} not found in log`);

const shapes = new Map();
for (const s of statements) {
  const shape = normalize(s.sql);
  const e = shapes.get(shape) || { count: 0, totalMs: 0, maxMs: 0, timed: 0 };
  e.count++;
  if (s.ms !== null) { e.totalMs += s.ms; e.maxMs = Math.max(e.maxMs, s.ms); e.timed++; }
  shapes.set(shape, e);
}
const byShape = [...shapes.entries()]
  .map(([sql, e]) => ({ count: e.count, kind: sql.split(" ")[0], totalMs: e.timed ? Number(e.totalMs.toFixed(1)) : null, maxMs: e.timed ? e.maxMs : null, sql }))
  .sort((a, b) => b.count - a.count || a.sql.localeCompare(b.sql));
const suspects = byShape.filter((s) => s.kind === "select" && s.count >= opts.threshold);
const total = statements.length;

if (opts.json) {
  process.stdout.write(JSON.stringify({ total, distinct: byShape.length, threshold: opts.threshold, suspects, byShape }, null, 2) + "\n");
} else {
  process.stdout.write(`statements: ${total}  distinct shapes: ${byShape.length}  n+1 threshold: ${opts.threshold}\n`);
  for (const s of byShape) {
    const flag = suspects.includes(s) ? "  <-- N+1 suspect" : "";
    const time = s.totalMs !== null ? `  total ${s.totalMs} ms, max ${s.maxMs} ms` : "";
    const sql = s.sql.length > 150 ? s.sql.slice(0, 147) + "..." : s.sql;
    process.stdout.write(`${String(s.count).padStart(6)}  ${sql}${time}${flag}\n`);
  }
  if (suspects.length === 0) process.stdout.write("no N+1 suspects\n");
}
process.exit(opts.failOnSuspect && suspects.length > 0 ? 1 : 0);
