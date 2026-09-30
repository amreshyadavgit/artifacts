// Run: node --test .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs   (from AI-SDLC-frappe/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePlan, gradeCase, testExists } from "./validate-test-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, "..", "..", "..", "..");
const plan = readFileSync(join(here, "../examples/lastn-test-plan.md"), "utf8");
const template = readFileSync(join(here, "../TEST_PLAN_TEMPLATE.md"), "utf8");
const cases = JSON.parse(readFileSync(join(projectDir, "skills/test-strategy/tests/cases.json"), "utf8")).cases;
const byId = (id) => cases.find((c) => c.id === id);

test("the lastn example plan is valid against the real app tests", () => {
  const r = validatePlan(plan, { repo: projectDir });
  assert.deepEqual(r.errors, []);
  assert.equal(r.cases.length, 24);
  assert.equal(r.findings.length, 7);
});

test("the lastn example plan passes golden case ts-01 and fails ts-04", () => {
  const r = validatePlan(plan);
  assert.deepEqual(gradeCase(plan, r, byId("ts-01-lastn")), []);
  const errs = gradeCase(plan, r, byId("ts-04-backfill-country-patch"));
  assert.ok(errs.some((e) => e.includes("does not reference TestFhirApi#test_backfill_country_patch")));
});

test("the unfilled template is not a valid plan", () => {
  assert.ok(validatePlan(template).errors.length > 5);
});

test("an existing test that does not exist is caught with --repo", () => {
  const bad = plan.replace("| `TestFhirApi#test_lastn_returns_latest_per_patient` | Guard named", "| `TestFhirApi#test_lastn_returns_latest` | Guard named");
  const r = validatePlan(bad, { repo: projectDir });
  assert.ok(r.errors.some((e) => e.includes("marked existing but TestFhirApi#test_lastn_returns_latest is not in sample-app/spice_lite/spice_lite")));
});

test("a new test that already exists is caught with --repo", () => {
  const bad = plan.replace(
    "| TC-17 | performance | query counter | `TestFhirApi#test_lastn_query_count_grows_with_subjects` | 1 and 5 subjects | Pins the N+1; replace with TC-16 when fixed | existing |",
    "| TC-17 | performance | query counter | `TestFhirApi#test_lastn_query_count_grows_with_subjects` | 1 and 5 subjects | Pins the N+1 | new |",
  );
  const r = validatePlan(bad, { repo: projectDir });
  assert.ok(r.errors.some((e) => e.includes("marked new but TestFhirApi#test_lastn_query_count_grows_with_subjects already exists")));
});

test("a category missing from the coverage matrix is reported", () => {
  const bad = plan.replace(/\| regression \| TC-23, TC-24 \|.*\n/, "");
  assert.ok(validatePlan(bad).errors.some((e) => e.includes('category "regression" missing')));
});

test("N/A with a reason is accepted for an empty category", () => {
  const noRegression = plan
    .replace(/\| TC-23 \| regression .*\n/, "")
    .replace(/\| TC-24 \| regression .*\n/, "")
    .replace(/\| regression \| TC-23, TC-24 \|.*\n/, "| regression | N/A: new method, nothing to regress | |\n");
  assert.deepEqual(validatePlan(noRegression).errors, []);
});

test("bad tool, test name and status are reported", () => {
  const bad = plan
    .replace("| TC-10 | negative | FrappeTestCase + call() | `TestLastnPlan#test_lastn_with_malformed_json_is_400_invalid` |", "| TC-10 | negative | Postman | `lastn_bad_json` |")
    .replace("| 400, `issue[0].code` = `invalid` | new |", "| 400, `issue[0].code` = `invalid` | todo |");
  const errs = validatePlan(bad).errors;
  assert.ok(errs.some((e) => e.includes('tool "Postman"')));
  assert.ok(errs.some((e) => e.includes("must be `TestSomething#test_behaviour`")));
  assert.ok(errs.some((e) => e.includes('status "todo"')));
});

test("a citation past the end of a real file is caught with --repo", () => {
  const bad = plan.replace("fhir.py:186`", "fhir.py:1860`");
  assert.ok(validatePlan(bad, { repo: projectDir }).errors.some((e) => e.includes("fhir.py:1860 is outside the file")));
});

test("testExists finds real test methods in DocType and API test modules", () => {
  assert.equal(testExists(projectDir, "TestSLObservation", "test_clinician_cannot_delete"), true);
  assert.equal(testExists(projectDir, "TestFhirApi", "test_lastn_requires_subjects"), true);
  assert.equal(testExists(projectDir, "TestFhirApi", "test_clinician_can_delete"), false);
});
