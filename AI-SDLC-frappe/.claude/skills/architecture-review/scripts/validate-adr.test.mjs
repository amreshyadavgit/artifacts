// Run: node --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs   (from AI-SDLC-frappe/)
// Set FRAPPE_BENCH to check the Frappe-source citations too (default /home/user/frappe-bench, skipped if absent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdr, gradeCase } from "./validate-adr.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, "..", "..", "..", "..");
const bench = process.env.FRAPPE_BENCH || "/home/user/frappe-bench";
const example = readFileSync(join(here, "../examples/0002-national-health-id-integration-app.md"), "utf8");
const adr0001 = readFileSync(join(projectDir, "docs/adr/0001-fhir-lite-over-whitelisted-methods.md"), "utf8");
const cases = JSON.parse(readFileSync(join(projectDir, "skills/architecture-review/tests/cases.json"), "utf8")).cases;
const byId = (id) => cases.find((c) => c.id === id);

test("ADR-0002 example is valid, proposed, and every repo citation resolves", () => {
  const r = validateAdr(example, { repo: projectDir, status: "proposed" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.number, "0002");
  assert.equal(r.optionCount, 4);
  assert.equal(r.riskCount, 7);
  assert.ok(r.cites.length >= 20);
});

test("ADR-0002 Frappe-source citations resolve against the bench", { skip: !existsSync(join(bench, "apps/frappe")) }, () => {
  const r = validateAdr(example, { bench });
  assert.deepEqual(r.errors, []);
  assert.ok(r.cites.filter((c) => c.path.startsWith("apps/frappe/")).length >= 8);
});

test("ADR-0002 example passes golden case ar-01", () => {
  const r = validateAdr(example, { repo: projectDir });
  assert.deepEqual(gradeCase(example, r, byId("ar-01-national-health-id")), []);
});

test("ADR-0002 example does not pass an unrelated case", () => {
  const r = validateAdr(example);
  const errs = gradeCase(example, r, byId("ar-05-lastn-set-based"));
  assert.ok(errs.some((e) => e.includes("does not cite KNOWN_DEFECTS.md")));
});

test("the human-written ADR-0001 conforms to the template", () => {
  assert.deepEqual(validateAdr(adr0001, { repo: projectDir, templateOnly: true }).errors, []);
});

test("an accepted status is rejected when the skill requires proposed", () => {
  const r = validateAdr(example.replace("- Status: proposed", "- Status: accepted"), { status: "proposed" });
  assert.ok(r.errors.some((e) => e.includes('Status must be "proposed"')));
});

test("a missing or renamed section is reported", () => {
  const noVerification = example.split("\n## Verification")[0];
  assert.ok(validateAdr(noVerification).errors.some((e) => e.startsWith("H2 sections must be exactly")));
  const renamed = example.replace("## Decision", "## Choice");
  assert.ok(validateAdr(renamed).errors.some((e) => e.includes("got: Context, Options considered, Choice")));
});

test("a single option is not a trade-off analysis", () => {
  const oneOption = example.replace(/\| A\. Core field.*\n/, "").replace(/\| B\. Country app.*\n/, "").replace(/\| D\. Core child table.*\n/, "");
  assert.ok(validateAdr(oneOption).errors.some((e) => e.includes("at least 2 options, got 1")));
});

test("a citation past the end of a real file is caught with --repo", () => {
  const bad = example.replace("hooks.py:11`", "hooks.py:110`");
  assert.ok(validateAdr(bad, { repo: projectDir }).errors.some((e) => e.includes("hooks.py:110 is outside the file")));
});

test("Verification without test_ names is rejected", () => {
  const bad = example.replace(/## Verification[\s\S]*$/, "## Verification\n- We will test it thoroughly.\n");
  assert.ok(validateAdr(bad).errors.some((e) => e.startsWith("Verification must name concrete tests")));
});
