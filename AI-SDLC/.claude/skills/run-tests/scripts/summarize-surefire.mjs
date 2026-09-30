#!/usr/bin/env node
// Summarize Maven Surefire XML reports into a compact Markdown block for an agent's context.
//
// Usage:
//   node .claude/skills/run-tests/scripts/summarize-surefire.mjs [reportsDir] [--since <ISO-8601 time>] [--strict]
//
//   reportsDir  default: sample-app/target/surefire-reports (relative to the current directory)
//   --since     ignore report files last modified before this time (drops stale reports left
//               over from an earlier run, e.g. after running a single test class)
//   --strict    exit 1 when any test failed or errored (for CI); default exit 0 so the summary
//               is always delivered to the caller
//
// Exit codes: 0 summary printed; 1 tests failed (only with --strict); 2 no usable reports found.
//
// Deliberately never prints <system-out>/<system-err>: test logs can contain request data, and
// the summary is meant to be pasted into prompts. Messages are truncated to 300 characters.
// Zero dependencies (Node 22).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_MESSAGE = 300;

export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

function oneLine(s, max = MAX_MESSAGE) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 3) + "..." : flat;
}

/** Parse one Surefire TEST-*.xml document. Returns { suite, cases }. */
export function parseSurefireXml(xml) {
  const suiteTag = xml.match(/<testsuite\b[^>]*>/);
  if (!suiteTag) throw new Error("no <testsuite> element");
  const s = attrs(suiteTag[0]);
  const suite = {
    name: s.name ?? "unknown",
    tests: Number(s.tests ?? 0),
    failures: Number(s.failures ?? 0),
    errors: Number(s.errors ?? 0),
    skipped: Number(s.skipped ?? 0),
    time: Number(s.time ?? 0),
  };
  const cases = [];
  // A testcase is either self-closing or has a body (failure/error/skipped/system-out).
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const a = attrs(m[1]);
    const body = m[3] ?? "";
    let outcome = "passed";
    let type = "";
    let message = "";
    let at = "";
    const problem = body.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
    if (problem) {
      outcome = problem[1] === "failure" ? "failed" : "error";
      const pa = attrs(problem[2]);
      type = pa.type ?? "";
      const detail = decodeEntities((problem[4] ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, ""));
      message = oneLine(pa.message ?? detail.split("\n")[0] ?? "");
      // First stack frame inside the test class itself gives the failing line.
      const simple = (a.classname ?? "").split(".").pop();
      const frame = detail.split("\n").map((l) => l.trim()).find((l) => simple && l.startsWith("at ") && l.includes(`(${simple}.java:`));
      at = frame ? frame.slice(3) : "";
    } else if (/<skipped\b/.test(body)) {
      outcome = "skipped";
    }
    cases.push({ classname: a.classname ?? suite.name, name: a.name ?? "unknown", time: Number(a.time ?? 0), outcome, type, message, at });
  }
  return { suite, cases };
}

export function loadReports(dir, sinceMs) {
  if (!existsSync(dir)) return { reports: [], skippedStale: 0 };
  const files = readdirSync(dir).filter((f) => /^TEST-.*\.xml$/.test(f)).sort();
  const reports = [];
  let skippedStale = 0;
  for (const f of files) {
    const p = join(dir, f);
    if (sinceMs !== undefined && statSync(p).mtimeMs < sinceMs) {
      skippedStale++;
      continue;
    }
    reports.push({ file: basename(p), ...parseSurefireXml(readFileSync(p, "utf8")) });
  }
  return { reports, skippedStale };
}

export function summarize(reports, { skippedStale = 0 } = {}) {
  const t = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  for (const r of reports) for (const k of Object.keys(t)) t[k] += r.suite[k];
  const passed = t.tests - t.failures - t.errors - t.skipped;
  const ok = t.failures === 0 && t.errors === 0;
  const lines = [];
  lines.push(`## Test summary: ${ok ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push(`${t.tests} tests: ${passed} passed, ${t.failures} failed, ${t.errors} errors, ${t.skipped} skipped (${reports.length} suites, ${t.time.toFixed(1)} s)`);
  if (skippedStale) lines.push(`Ignored ${skippedStale} stale report file(s) older than --since.`);
  lines.push("");
  lines.push("| Suite | Tests | Failed | Errors | Skipped | Time (s) |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of reports) {
    const simple = r.suite.name.split(".").pop();
    lines.push(`| ${simple} | ${r.suite.tests} | ${r.suite.failures} | ${r.suite.errors} | ${r.suite.skipped} | ${r.suite.time.toFixed(2)} |`);
  }
  const bad = reports.flatMap((r) => r.cases.filter((c) => c.outcome === "failed" || c.outcome === "error"));
  if (bad.length) {
    lines.push("");
    lines.push("### Failures");
    bad.forEach((c, i) => {
      const simple = c.classname.split(".").pop();
      lines.push(`${i + 1}. ${simple}.${c.name} (${c.outcome}${c.type ? ", " + c.type : ""})`);
      if (c.message) lines.push(`   message: ${c.message}`);
      if (c.at) lines.push(`   at: ${c.at}`);
    });
  }
  const skipped = reports.flatMap((r) => r.cases.filter((c) => c.outcome === "skipped"));
  if (skipped.length) {
    lines.push("");
    lines.push("### Skipped");
    for (const c of skipped) lines.push(`- ${c.classname.split(".").pop()}.${c.name}`);
  }
  return { ok, text: lines.join("\n") + "\n" };
}

function parseArgs(argv) {
  const opts = { dir: "sample-app/target/surefire-reports", since: undefined, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") opts.strict = true;
    else if (a === "--since") {
      const v = argv[++i];
      const ms = Date.parse(v ?? "");
      if (Number.isNaN(ms)) throw new Error(`--since needs an ISO-8601 time, got: ${v}`);
      opts.since = ms;
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.dir = a;
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`summarize-surefire: ${e.message}`);
    process.exit(2);
  }
  const { reports, skippedStale } = loadReports(opts.dir, opts.since);
  if (reports.length === 0) {
    const why = skippedStale ? `all ${skippedStale} report file(s) are older than --since` : `no TEST-*.xml files in ${opts.dir}`;
    console.log(`## Test summary: NO REPORTS\n\n${why}. The build probably failed before tests ran (compilation error or Maven failure): check the first [ERROR] lines of the Maven output.`);
    process.exit(2);
  }
  const { ok, text } = summarize(reports, { skippedStale });
  process.stdout.write(text);
  process.exit(opts.strict && !ok ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
