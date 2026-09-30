// Run: node --test .claude/skills/test-strategy/scripts/validate-test-plan.test.mjs   (from AI-SDLC/)
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

test("the $lastn example plan is valid against the real repo", () => {
  const r = validatePlan(plan, { repo: projectDir });
  assert.deepEqual(r.errors, []);
  assert.equal(r.cases.length, 18);
  assert.equal(r.findings.length, 6);
});

test("the $lastn example plan passes golden case ts-01 and fails ts-04", () => {
  const r = validatePlan(plan);
  assert.deepEqual(gradeCase(plan, r, byId("ts-01-lastn-endpoint")), []);
  const errs = gradeCase(plan, r, byId("ts-04-delete-patient"));
  assert.ok(errs.some((e) => e.includes("does not reference SecurityTest#clinicianCannotDelete")));
});

test("the unfilled template is not a valid plan", () => {
  assert.ok(validatePlan(template).errors.length > 5);
});

test("an existing test that does not exist is caught with --repo", () => {
  const bad = plan.replace("`ObservationApiTest#lastnReturnsMostRecentObservationPerSubject` | Existing guard", "`ObservationApiTest#lastnReturnsLatest` | Existing guard");
  const r = validatePlan(bad, { repo: projectDir });
  assert.ok(r.errors.some((e) => e.includes("marked existing but ObservationApiTest#lastnReturnsLatest is not in sample-app/src/test/java")));
});

test("a new test that already exists is caught with --repo", () => {
  const bad = plan.replace("| TC-18 | regression | MockMvc + H2 | `ObservationApiTest#lastnReturnsMostRecentObservationPerSubject` | Existing guard named in `KNOWN_DEFECTS.md` \"How to verify\" | Keeps passing before and after the N+1 fix | existing |",
    "| TC-18 | regression | MockMvc + H2 | `ObservationApiTest#lastnReturnsMostRecentObservationPerSubject` | Existing guard | Keeps passing | new |");
  const r = validatePlan(bad, { repo: projectDir });
  assert.ok(r.errors.some((e) => e.includes("marked new but ObservationApiTest#lastnReturnsMostRecentObservationPerSubject already exists")));
});

test("a category missing from the coverage matrix is reported", () => {
  const bad = plan.replace(/\| regression \| TC-18 \|.*\n/, "");
  assert.ok(validatePlan(bad).errors.some((e) => e.includes('category "regression" missing')));
});

test("N/A with a reason is accepted for an empty category", () => {
  const noRegression = plan
    .replace(/\| TC-18 \| regression .*\n/, "")
    .replace(/\| regression \| TC-18 \|.*\n/, "| regression | N/A: new endpoint, nothing to regress | |\n");
  assert.deepEqual(validatePlan(noRegression).errors, []);
});

test("bad tool, test name and status are reported", () => {
  const bad = plan.replace("| TC-06 | negative | MockMvc | `ObservationLastnTest#lastnWithoutSubjectsParameterIs400` |", "| TC-06 | negative | Postman | `test400` |")
    .replace("| 400 `OperationOutcome`, `issue[0].code` = `required` | new |", "| 400 `OperationOutcome`, `issue[0].code` = `required` | todo |");
  const errs = validatePlan(bad).errors;
  assert.ok(errs.some((e) => e.includes('tool "Postman"')));
  assert.ok(errs.some((e) => e.includes("must be `SomethingTest#behaviourName`")));
  assert.ok(errs.some((e) => e.includes('status "todo"')));
});

test("testExists finds real test methods", () => {
  assert.equal(testExists(projectDir, "SecurityTest", "clinicianCannotDelete"), true);
  assert.equal(testExists(projectDir, "SecurityTest", "clinicianCanDelete"), false);
});
