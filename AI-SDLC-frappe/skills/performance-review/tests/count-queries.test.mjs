// Deterministic tests for .claude/skills/performance-review/scripts/count-queries.mjs
// Run from AI-SDLC-frappe/: node --test skills/performance-review/tests/count-queries.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(root, ".claude/skills/performance-review/scripts/count-queries.mjs");
const ex = join(root, ".claude/skills/performance-review/examples/lastn-fix");
const pgLog = join(root, ".claude/skills/production-rca/examples/INC-2026-0922-lastn/postgres-slow.log");
const run = (args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test("shipped lastn: 40 statements for 20 subjects, two N+1 shapes", () => {
  const r = run([join(ex, "sql-before.log"), "--from", "LASTN_BEGIN", "--to", "LASTN_END", "--json"]);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.total, 40);
  assert.equal(j.suspects.length, 2);
  assert.deepEqual(j.suspects.map((s) => s.count), [20, 20]);
  assert.ok(j.suspects.some((s) => s.sql.startsWith('select * from "tabsl patient" where "name"=?')));
});

test("--fail-on-suspect turns the N+1 into exit 1", () => {
  assert.equal(run([join(ex, "sql-before.log"), "--from", "LASTN_BEGIN", "--to", "LASTN_END", "--fail-on-suspect"]).code, 1);
});

test("patched lastn: 3 statements, no suspects", () => {
  const r = run([join(ex, "sql-after.log"), "--from", "LASTN_BEGIN", "--to", "LASTN_END", "--fail-on-suspect"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^statements: 3 {2}distinct shapes: 3/);
  assert.match(r.out, /no N\+1 suspects/);
  assert.match(r.out, /in \(\?\+\)/, "IN lists collapse to one shape");
});

test("Postgres slow log from the RCA pack: one repeated shape with durations", () => {
  const j = JSON.parse(run([pgLog, "--json"]).out);
  assert.equal(j.total, 15);
  assert.equal(j.suspects.length, 1);
  assert.equal(j.suspects[0].count, 14);
  assert.equal(j.suspects[0].maxMs, 2407.744);
  assert.equal(j.byShape.find((s) => s.sql.includes('"tabsl encounter"')).count, 1);
});

test("no literal values are printed", () => {
  for (const f of [join(ex, "sql-before.log"), pgLog]) {
    const r = run([f]);
    assert.doesNotMatch(r.out, /SLP-\d+|8867-4|8480-6|1900-01-01/);
  }
});

test("usage errors exit 2", () => {
  assert.equal(run([]).code, 2);
  assert.equal(run([join(ex, "missing.log")]).code, 2);
  assert.equal(run([join(ex, "sql-after.log"), "--from", "NO_SUCH_MARKER"]).code, 2);
  assert.equal(run([join(ex, "sql-after.log"), "--threshold", "1"]).code, 2);
});
