// Run: node --test .claude/skills/architecture-review/scripts/validate-adr.test.mjs   (from AI-SDLC/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdr, gradeCase } from "./validate-adr.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, "..", "..", "..", "..");
const example = readFileSync(join(here, "../examples/0002-paginate-patient-search.md"), "utf8");
const adr0001 = readFileSync(join(projectDir, "docs/adr/0001-fhir-lite-instead-of-hapi.md"), "utf8");
const cases = JSON.parse(readFileSync(join(projectDir, "skills/architecture-review/tests/cases.json"), "utf8")).cases;
const byId = (id) => cases.find((c) => c.id === id);

test("ADR-0002 example is valid, proposed, and every citation resolves in the repo", () => {
  const r = validateAdr(example, { repo: projectDir, status: "proposed" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.number, "0002");
  assert.equal(r.optionCount, 4);
  assert.equal(r.riskCount, 5);
  assert.ok(r.cites.length >= 10);
});

test("ADR-0002 example passes golden case ar-01", () => {
  const r = validateAdr(example, { repo: projectDir });
  assert.deepEqual(gradeCase(example, r, byId("ar-01-patient-search-pagination")), []);
});

test("ADR-0002 example does not pass an unrelated case", () => {
  const r = validateAdr(example);
  const errs = gradeCase(example, r, byId("ar-03-oauth2-bearer-tokens"));
  assert.ok(errs.some((e) => e.includes("does not cite SecurityConfig.java")));
});

test("the human-written ADR-0001 conforms to the template", () => {
  assert.deepEqual(validateAdr(adr0001, { repo: projectDir, templateOnly: true }).errors, []);
});

test("an accepted status is rejected when the skill requires proposed", () => {
  const r = validateAdr(example.replace("- Status: proposed", "- Status: accepted"), { status: "proposed" });
  assert.ok(r.errors.some((e) => e.includes('Status must be "proposed"')));
});

test("a missing or reordered section is reported", () => {
  const noVerification = example.split("\n## Verification")[0];
  assert.ok(validateAdr(noVerification).errors.some((e) => e.startsWith("H2 sections must be exactly")));
  const swapped = example.replace("## Decision", "## Choice");
  assert.ok(validateAdr(swapped).errors.some((e) => e.includes("got: Context, Options considered, Choice")));
});

test("a single option is not a trade-off analysis", () => {
  const oneOption = example.replace(/\| A\. Hard cap.*\n/, "").replace(/\| C\. Keyset.*\n/, "").replace(/\| D\. Return.*\n/, "");
  assert.ok(validateAdr(oneOption).errors.some((e) => e.includes("at least 2 options, got 1")));
});

test("a citation past the end of a real file is caught with --repo", () => {
  const bad = example.replace("PatientRepository.java:14`", "PatientRepository.java:140`");
  assert.ok(validateAdr(bad, { repo: projectDir }).errors.some((e) => e.includes("PatientRepository.java:140 is outside the file")));
});
