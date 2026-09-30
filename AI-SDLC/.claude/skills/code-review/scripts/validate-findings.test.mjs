// Run: node --test .claude/skills/code-review/scripts/validate-findings.test.mjs   (from AI-SDLC/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReport, gradeCase, splitRow, expectedVerdict } from "./validate-findings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, "..");
const projectDir = join(skillDir, "..", "..", "..");
const example = readFileSync(join(skillDir, "examples/expected-review-patient-by-name.md"), "utf8");
const cases = JSON.parse(readFileSync(join(projectDir, "skills/code-review/tests/cases.json"), "utf8")).cases;
const byId = (id) => cases.find((c) => c.id === id);

const CLEAN = `## Summary
Adds one MockMvc test. No findings.

## Findings
| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|

## Details
None.

## Categories checked
- correctness: no findings
- design: no findings
- readability: no findings
- testing: no findings
- security: no findings
- performance: no findings
- standards: no findings
- docs: no findings

## Verdict
APPROVE
`;

test("the shipped example report is valid and passes golden case cr-01", () => {
  const r = validateReport(example);
  assert.deepEqual(r.errors, []);
  assert.equal(r.findings.length, 10);
  assert.equal(r.verdict, "BLOCK");
  assert.deepEqual(gradeCase(r, byId("cr-01-jpql-concat-entity-return")), []);
});

test("the example report fails a case it does not satisfy", () => {
  const r = validateReport(example);
  const errs = gradeCase(r, byId("cr-06-clean-test-only-change"));
  assert.ok(errs.some((e) => e.includes("verdict BLOCK, expected APPROVE")));
  assert.ok(errs.some((e) => e.includes("findings above low")));
});

test("a clean report with every category marked no findings is valid and approves", () => {
  const r = validateReport(CLEAN);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(gradeCase(r, byId("cr-06-clean-test-only-change")), []);
});

test("missing column, bad severity and unquoted evidence are reported", () => {
  const bad = example
    .replace("| id | severity | category | location | evidence | recommendation |", "| id | severity | category | location | recommendation |")
  const r = validateReport(bad);
  assert.ok(r.errors.some((e) => e.startsWith("findings table columns must be")));

  const bad2 = example.replace("| CR-009 | low | performance |", "| CR-009 | minor | performance |");
  assert.ok(validateReport(bad2).errors.some((e) => e.includes('severity "minor"')));

  const bad3 = CLEAN.replace("|---|---|---|---|---|---|", "|---|---|---|---|---|---|\n| CR-001 | low | docs | `sample-app/README.md:1` | the readme is old | Update it per api-standards.md |");
  const errs3 = validateReport(bad3).errors;
  assert.ok(errs3.some((e) => e.includes("evidence must quote")));
  assert.ok(errs3.some((e) => e.includes('"docs" says no findings')));
  assert.ok(errs3.some((e) => e.includes("missing \"### CR-001\"")));
});

test("verdict must follow the severities", () => {
  const r = validateReport(example.replace(/## Verdict\nBLOCK/, "## Verdict\nAPPROVE"));
  assert.ok(r.errors.some((e) => e.includes("inconsistent with severities")));
  assert.equal(expectedVerdict([{ severity: "medium" }, { severity: "low" }]), "NEEDS-DECISION");
});

test("location must be a backticked path:line and findings sorted by severity", () => {
  const r = validateReport(example.replace("| CR-010 | low | docs | `sample-app/src/main/java/org/example/fhir/api/PatientController.java:52` |", "| CR-010 | high | docs | PatientController line 52 |"));
  assert.ok(r.errors.some((e) => e.includes("location must start with a backticked path:line")));
  assert.ok(r.errors.some((e) => e.includes("sorted by severity")));
});

test("--repo check catches a line past the end of a real file", () => {
  const r = validateReport(CLEAN.replace("|---|---|---|---|---|---|", "|---|---|---|---|---|---|\n| CR-001 | low | docs | `sample-app/src/main/java/org/example/fhir/api/Bundle.java:400` | `Bundle` | See api-standards.md |").replace("- docs: no findings", "- docs: CR-001").replace("## Details\nNone.", "## Details\n### CR-001\nx").replace("APPROVE", "APPROVE"), { repo: projectDir });
  assert.ok(r.errors.some((e) => e.includes("line 400 is past the end")));
});

test("escaped pipes stay inside one cell", () => {
  assert.deepEqual(splitRow("| a | `x \\| y` | c |"), ["a", "`x | y`", "c"]);
});
