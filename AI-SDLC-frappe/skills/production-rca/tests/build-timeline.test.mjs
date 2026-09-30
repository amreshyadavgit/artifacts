// Deterministic tests for .claude/skills/production-rca/scripts/build-timeline.mjs
// Run from AI-SDLC-frappe/: node --test skills/production-rca/tests/build-timeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(root, ".claude/skills/production-rca/scripts/build-timeline.mjs");
const pack = join(root, ".claude/skills/production-rca/examples/INC-2026-0922-lastn");
const fixtures = join(root, "skills/production-rca/tests/fixtures");
const packFiles = readdirSync(pack).filter((f) => /\.(log|txt|md)$/.test(f)).map((f) => join(pack, f));
const STD = ["--date", "2026-09-22", "--offset", "error-log.txt=+03:00", "--offset", "worker.log=+00:00"];

function run(args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const rows = (out) => out.split("\n").filter((l) => /^\| \d+ \|/.test(l));

test("evidence pack is PHI-free and merges into one UTC timeline", () => {
  const r = run([...packFiles, ...STD]);
  assert.equal(r.code, 0, r.err);
  assert.equal(packFiles.length, 9);
  assert.equal(rows(r.out).length, 128);
  assert.match(r.err, /128 events from 9 file\(s\)/);
  assert.doesNotMatch(r.err, /warning/);
  const times = rows(r.out).map((l) => l.split("|")[2].trim());
  assert.deepEqual([...times].sort(), times, "rows are in time order");
});

test("--collapse merges repeats but keeps distinct queue samples", () => {
  const r = run([...packFiles, ...STD, "--collapse"]);
  assert.equal(r.code, 0);
  assert.equal(rows(r.out).length, 125);
  assert.match(r.out, /Booting worker with pid: 2240 \(x2 until 07:41:04\)/);
  assert.equal(rows(r.out).filter((l) => l.includes("redis-queue.txt")).length, 23);
});

test("Error Log times are site-local: the offset moves the first job timeout to 08:10 UTC", () => {
  const withOffset = run([...packFiles, ...STD]);
  const line = rows(withOffset.out).find((l) => l.includes("error-log.txt:3"));
  assert.match(line, /2026-09-22 08:10:00/);
  const without = run([...packFiles, "--date", "2026-09-22", "--offset", "worker.log=+00:00"]);
  assert.match(without.err, /5 timestamp\(s\) without a zone in error-log.txt taken as UTC/);
  assert.match(rows(without.out).find((l) => l.includes("error-log.txt:3")), /2026-09-22 11:10:00/);
});

test("time-only RQ lines need --date", () => {
  const r = run([...packFiles, "--offset", "error-log.txt=+03:00"]);
  assert.equal(r.code, 0);
  assert.match(r.err, /26 time-only line\(s\) skipped; pass --date/);
  assert.equal(rows(r.out).filter((l) => l.includes("worker.log")).length, 0);
});

test("PHI guard stops on Form Dict and search terms and never prints them", () => {
  const r = run([join(fixtures, "phi-leak/frappe.log"), join(fixtures, "phi-leak/nginx-access.log")]);
  assert.equal(r.code, 3);
  assert.equal(r.out, "");
  assert.match(r.err, /frappe\.log:3: Form Dict with patient fields/);
  assert.match(r.err, /nginx-access\.log:1: PHI query parameter/);
  assert.doesNotMatch(r.err, /nginx-access\.log:2/, "a document name is not PHI");
  assert.doesNotMatch(r.err + r.out, /Wanjiru/);
});

test("secrets are caught like PHI", () => {
  // generated at test time so no token-shaped string is committed to the repo
  const dir = mkdtempSync(join(tmpdir(), "rca-guard-"));
  const file = join(dir, "web.error.log");
  const key = "a".repeat(15), secret = "b".repeat(15);
  writeFileSync(file, `[2026-09-22 08:04:05 +0000] [2211] [INFO] curl -H "Authorization: token ${key}:${secret}"\n` +
    `[2026-09-22 08:04:06 +0000] [2211] [INFO] "db_password": "x"\n`);
  const r = run([file]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.code, 3);
  assert.match(r.err, /web\.error\.log:1: Frappe API token/);
  assert.match(r.err, /web\.error\.log:2: site_config secret/);
  assert.doesNotMatch(r.err, new RegExp(secret));
});

test("usage errors exit 2", () => {
  assert.equal(run([]).code, 2);
  assert.equal(run([...packFiles, "--offset", "error-log.txt=3h"]).code, 2);
  assert.equal(run([...packFiles, "--date", "22/09/2026"]).code, 2);
});
