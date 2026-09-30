// Run: node --test .claude/skills/code-review/scripts/validate-findings.test.mjs   (from AI-SDLC-frappe/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReport, gradeCase, splitRow, expectedVerdict } from "./validate-findings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, "..");
const projectDir = join(skillDir, "..", "..", "..");
const example = readFileSync(join(skillDir, "examples/expected-review-front-desk-lookup.md"), "utf8");
const cases = JSON.parse(readFileSync(join(projectDir, "skills/code-review/tests/cases.json"), "utf8")).cases;
const byId = (id) => cases.find((c) => c.id === id);

const CLEAN = `## Summary
Adds one FrappeTestCase test for a plain MRN search. No findings.

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

const oneFinding = (row, category) =>
  CLEAN.replace("|---|---|---|---|---|---|", `|---|---|---|---|---|---|\n${row}`)
    .replace(`- ${category}: no findings`, `- ${category}: CR-001`)
    .replace("## Details\nNone.", "## Details\n### CR-001\nx");

test("the shipped example review is valid and passes golden case cr-01", () => {
  const r = validateReport(example);
  assert.deepEqual(r.errors, []);
  assert.equal(r.findings.length, 11);
  assert.equal(r.verdict, "BLOCK");
  assert.deepEqual(gradeCase(r, byId("cr-01-front-desk-lookup")), []);
});

test("the example review fails a case it does not satisfy", () => {
  const r = validateReport(example);
  const errs = gradeCase(r, byId("cr-06-clean-test-only-change"));
  assert.ok(errs.some((e) => e.includes("verdict BLOCK, expected APPROVE")));
  assert.ok(errs.some((e) => e.includes("findings above low")));
  assert.ok(gradeCase(r, byId("cr-05-audit-logger-with-more-info")).some((e) => e.includes("no finding matches")));
});

test("a clean report with every category marked no findings is valid and approves", () => {
  const r = validateReport(CLEAN);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(gradeCase(r, byId("cr-06-clean-test-only-change")), []);
});

test("missing column, bad severity and unquoted evidence are reported", () => {
  const bad = example.replace("| id | severity | category | location | evidence | recommendation |", "| id | severity | category | location | recommendation |");
  assert.ok(validateReport(bad).errors.some((e) => e.startsWith("findings table columns must be")));

  const bad2 = example.replace("| CR-011 | low | docs |", "| CR-011 | minor | docs |");
  assert.ok(validateReport(bad2).errors.some((e) => e.includes('severity "minor"')));

  const bad3 = CLEAN.replace("|---|---|---|---|---|---|", "|---|---|---|---|---|---|\n| CR-001 | low | docs | `sample-app/README.md:1` | the readme is old | Update it per api-standards.md |");
  const errs3 = validateReport(bad3).errors;
  assert.ok(errs3.some((e) => e.includes("evidence must quote")));
  assert.ok(errs3.some((e) => e.includes('"docs" says no findings')));
  assert.ok(errs3.some((e) => e.includes('missing "### CR-001"')));
});

test("verdict must follow the severities", () => {
  const r = validateReport(example.replace(/## Verdict\nBLOCK/, "## Verdict\nAPPROVE"));
  assert.ok(r.errors.some((e) => e.includes("inconsistent with severities")));
  assert.equal(expectedVerdict([{ severity: "medium" }, { severity: "low" }]), "NEEDS-DECISION");
});

test("location must be a backticked path:line and findings sorted by severity", () => {
  const r = validateReport(example.replace("| CR-011 | low | docs | `sample-app/spice_lite/spice_lite/api/fhir.py:5-9` |", "| CR-011 | high | docs | fhir.py docstring |"));
  assert.ok(r.errors.some((e) => e.includes("location must start with a backticked path:line")));
  assert.ok(r.errors.some((e) => e.includes("sorted by severity")));
});

test("--repo catches a line past the end of the unpatched fhir.py", () => {
  // the example cites post-patch lines 190-202; the unpatched file ends at line 188
  const r = validateReport(example, { repo: projectDir });
  assert.ok(r.errors.some((e) => /line 20[12] is past the end of sample-app\/spice_lite\/spice_lite\/api\/fhir.py/.test(e)));
});

test("recommending frappe.get_all as a fix is rejected", () => {
  const row = "| CR-001 | high | security | `sample-app/spice_lite/spice_lite/api/fhir.py:83` | `rows = frappe.get_list(` | Use frappe.get_all to avoid the permission overhead (frappe-coding-standards.md#2). |";
  const errs = validateReport(oneFinding(row, "security").replace("## Verdict\nAPPROVE", "## Verdict\nBLOCK")).errors;
  assert.ok(errs.some((e) => e.includes("suggests frappe.get_all")));
  const ok = row.replace("Use frappe.get_all to avoid the permission overhead", "Replace frappe.get_all with frappe.get_list");
  assert.deepEqual(validateReport(oneFinding(ok, "security").replace("## Verdict\nAPPROVE", "## Verdict\nBLOCK")).errors, []);
});

test("escaped pipes stay inside one cell", () => {
  assert.deepEqual(splitRow("| a | `x \\| y` | c |"), ["a", "`x | y`", "c"]);
});
