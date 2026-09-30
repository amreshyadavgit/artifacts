// Deterministic tests for .claude/skills/security-review/scripts/render-report.mjs
// Run from AI-SDLC-frappe/: node --test skills/security-review/tests/render-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(root, ".claude/skills/security-review/scripts/render-report.mjs");
const answerKey = join(root, "skills/security-review/tests/expected/sample-app-report.json");
const answerMd = join(root, "skills/security-review/tests/expected/sample-app-report.md");
const example = join(root, ".claude/skills/security-review/examples/example-report.json");
const run = (args, input) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", input });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const key = () => JSON.parse(readFileSync(answerKey, "utf8"));
const viaStdin = (obj, extra = []) => run(["-", ...extra], JSON.stringify(obj));

test("answer key validates, renders, and gates on high", () => {
  const r = run([answerKey, "--fail-on", "high"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /3 finding\(s\) at or above high: SEC-001, SEC-002, SEC-003/);
  assert.match(r.out, /Findings: critical 0, high 3, medium 2, low 5, info 1/);
});

test("committed Markdown rendering is up to date", () => {
  assert.equal(run([answerKey]).out, readFileSync(answerMd, "utf8"));
});

test("example report passes without a gate and with --fail-on critical", () => {
  assert.equal(run([example]).code, 0);
  assert.equal(run([example, "--fail-on", "critical"]).code, 0);
});

test("inconsistent counts or verdict are rejected", () => {
  const a = key(); a.summary.high = 2;
  assert.match(viaStdin(a).err, /summary\.high is 2 but findings contain 3/);
  const b = key(); b.summary.verdict = "pass";
  const r = viaStdin(b);
  assert.equal(r.code, 2);
  assert.match(r.err, /findings imply "block"/);
});

test("schema violations are rejected", () => {
  const a = key(); a.findings[0].category = "permissions";
  assert.equal(viaStdin(a).code, 2);
  const b = key(); b.findings[0].location = "fhir.py line 177";
  assert.match(viaStdin(b).err, /does not match/);
});

test("a non-synthetic MRN, an unredacted Form Dict or an API token is rejected", () => {
  const a = key(); a.findings[1].evidence += "\nMRN-482913";
  assert.match(viaStdin(a).err, /MRN-482913, which is not a synthetic MRN/);
  const b = key(); b.findings[1].evidence += "\nForm Dict: {'cmd': 'x', 'family': 'Wanjiru'}";
  assert.match(viaStdin(b).err, /unredacted Form Dict/);
  const c = key(); c.findings[8].evidence += `\n${"c".repeat(15)}:${"d".repeat(15)}`;
  assert.match(viaStdin(c).err, /api_key:api_secret/);
  const ok = key(); ok.findings[1].evidence += "\nForm Dict: {'family': '[REDACTED]'} MRN-000123";
  assert.equal(viaStdin(ok, ["--fail-on", "critical"]).code, 0);
});

test("--out writes the file and usage errors exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "sec-render-"));
  const out = join(dir, "r.md");
  assert.equal(run([example, "--out", out]).code, 0);
  assert.match(readFileSync(out, "utf8"), /^# Security review: git diff \(1 file\)/);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(run([]).code, 2);
  assert.equal(run([example, "--fail-on", "severe"]).code, 2);
  const bad = join(tmpdir(), "not-json-" + process.pid);
  writeFileSync(bad, "{");
  assert.equal(run([bad]).code, 2);
  rmSync(bad);
});
