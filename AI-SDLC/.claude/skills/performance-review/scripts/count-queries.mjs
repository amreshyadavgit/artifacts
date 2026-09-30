#!/usr/bin/env node
// count-queries.mjs: count SQL statements in a Hibernate log and flag N+1 signatures.
// Zero dependencies (Node 22). Reads a log produced with -Dspring.jpa.show-sql=true
// ("Hibernate: select ...") or logging.level.org.hibernate.SQL=DEBUG ("... org.hibernate.SQL : select ...").
//
// Usage:
//   node count-queries.mjs <log-file | -> [--from REGEX] [--to REGEX] [--threshold N] [--json] [--fail-on-suspect]
//
//   --from / --to     only count statements after the first line matching --from and before the next
//                     line matching --to (use test markers such as LASTN_BEGIN / LASTN_QUERY_COUNT)
//   --threshold N     a SELECT shape repeated N or more times is an N+1 suspect (default 5)
//   --json            machine-readable output
//   --fail-on-suspect exit 1 when at least one suspect is found (for CI or a hook)
//
// Exit codes: 0 ok, 1 suspect found with --fail-on-suspect, 2 usage error.
// Output never contains bound parameter values: Hibernate prints "?" placeholders, and literals are masked.
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

const SQL_LINE = /(?:^Hibernate:\s+|org\.hibernate\.SQL\s*:\s+)(.+)$/;

function normalize(sql) {
  return sql
    .trim()
    .toLowerCase()
    .replace(/'(?:[^']|'')*'/g, "?")          // string literals
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")        // numeric literals (aliases like p1_0 keep their shape)
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?+)") // IN lists of any length collapse to one shape
    .replace(/\s+/g, " ");
}

// Table aliases such as p1_0 are kept: \b does not match inside an identifier.
const lines = text.split(/\r?\n/);
let active = opts.from === null;
let windowFound = opts.from === null;
const shapes = new Map();
let total = 0;
for (const line of lines) {
  if (!active && opts.from && opts.from.test(line)) { active = true; windowFound = true; continue; }
  if (active && opts.to && opts.to.test(line)) { if (opts.from) break; active = false; continue; }
  if (!active) continue;
  const m = line.match(SQL_LINE);
  if (!m) continue;
  total++;
  const shape = normalize(m[1]);
  shapes.set(shape, (shapes.get(shape) || 0) + 1);
}

if (!windowFound) usage(`--from pattern ${opts.from} not found in log`);

const byShape = [...shapes.entries()]
  .map(([sql, count]) => ({ count, kind: sql.split(" ")[0], sql }))
  .sort((a, b) => b.count - a.count || a.sql.localeCompare(b.sql));
const suspects = byShape.filter((s) => s.kind === "select" && s.count >= opts.threshold);

if (opts.json) {
  process.stdout.write(JSON.stringify({ total, distinct: byShape.length, threshold: opts.threshold, suspects, byShape }, null, 2) + "\n");
} else {
  process.stdout.write(`statements: ${total}  distinct shapes: ${byShape.length}  n+1 threshold: ${opts.threshold}\n`);
  for (const s of byShape) {
    const flag = suspects.includes(s) ? "  <-- N+1 suspect" : "";
    const sql = s.sql.length > 140 ? s.sql.slice(0, 137) + "..." : s.sql;
    process.stdout.write(`${String(s.count).padStart(6)}  ${sql}${flag}\n`);
  }
  if (suspects.length === 0) process.stdout.write("no N+1 suspects\n");
}
process.exit(opts.failOnSuspect && suspects.length > 0 ? 1 : 0);
