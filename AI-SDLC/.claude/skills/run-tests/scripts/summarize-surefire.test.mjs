// Tests for summarize-surefire.mjs. Run from AI-SDLC/: node --test .claude/skills/run-tests/scripts/summarize-surefire.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseSurefireXml, summarize, loadReports } from "./summarize-surefire.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "summarize-surefire.mjs");

const PASSING = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="org.example.fhir.SecurityTest" time="1.033" tests="2" errors="0" skipped="0" failures="0">
  <properties><property name="java.version" value="21"/></properties>
  <testcase name="wrongPasswordIs401" classname="org.example.fhir.SecurityTest" time="0.099">
    <system-out><![CDATA[action=READ resource=Patient/42 user=clinician
]]></system-out>
  </testcase>
  <testcase name="healthEndpointIsPublic" classname="org.example.fhir.SecurityTest" time="0.027"/>
</testsuite>`;

const FAILING = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="org.example.fhir.PatientApiTest" time="8.5" tests="4" errors="1" skipped="1" failures="1">
  <testcase name="searchWithoutParametersIs400" classname="org.example.fhir.PatientApiTest" time="0.2">
    <failure message="Status expected:&lt;400&gt; but was:&lt;200&gt;" type="java.lang.AssertionError"><![CDATA[java.lang.AssertionError: Status expected:<400> but was:<200>
	at org.springframework.test.util.AssertionErrors.fail(AssertionErrors.java:61)
	at org.example.fhir.PatientApiTest.searchWithoutParametersIs400(PatientApiTest.java:76)
]]></failure>
    <system-out><![CDATA[Loaded patient Test Patient (MRN MRN-000123)
]]></system-out>
  </testcase>
  <testcase name="readById" classname="org.example.fhir.PatientApiTest" time="0.1">
    <error message="Failed to load ApplicationContext" type="java.lang.IllegalStateException"><![CDATA[java.lang.IllegalStateException: Failed to load ApplicationContext
	at org.springframework.test.context.cache.DefaultCacheAwareContextLoaderDelegate.loadContext(DefaultCacheAwareContextLoaderDelegate.java:180)
]]></error>
  </testcase>
  <testcase name="duplicateMrnIs409" classname="org.example.fhir.PatientApiTest" time="0">
    <skipped/>
  </testcase>
  <testcase name="createReturns201WithLocationAndResource" classname="org.example.fhir.PatientApiTest" time="0.3"/>
</testsuite>`;

function tempReports(files) {
  const dir = mkdtempSync(join(tmpdir(), "surefire-"));
  for (const [name, xml] of Object.entries(files)) writeFileSync(join(dir, name), xml);
  return dir;
}

test("parses suite totals and self-closing and bodied testcases", () => {
  const { suite, cases } = parseSurefireXml(PASSING);
  assert.equal(suite.name, "org.example.fhir.SecurityTest");
  assert.equal(suite.tests, 2);
  assert.deepEqual(cases.map((c) => [c.name, c.outcome]), [["wrongPasswordIs401", "passed"], ["healthEndpointIsPublic", "passed"]]);
});

test("extracts failure message (entity-decoded), type and the test-class stack frame", () => {
  const { cases } = parseSurefireXml(FAILING);
  const f = cases.find((c) => c.name === "searchWithoutParametersIs400");
  assert.equal(f.outcome, "failed");
  assert.equal(f.type, "java.lang.AssertionError");
  assert.equal(f.message, "Status expected:<400> but was:<200>");
  assert.equal(f.at, "org.example.fhir.PatientApiTest.searchWithoutParametersIs400(PatientApiTest.java:76)");
  assert.equal(cases.find((c) => c.name === "readById").outcome, "error");
  assert.equal(cases.find((c) => c.name === "duplicateMrnIs409").outcome, "skipped");
});

test("summary reports FAIL, counts, failures and skipped, and never leaks system-out", () => {
  const reports = [PASSING, FAILING].map((x) => parseSurefireXml(x));
  const { ok, text } = summarize(reports);
  assert.equal(ok, false);
  assert.match(text, /^## Test summary: FAIL/);
  assert.match(text, /6 tests: 3 passed, 1 failed, 1 errors, 1 skipped \(2 suites/);
  assert.match(text, /1\. PatientApiTest\.searchWithoutParametersIs400 \(failed, java\.lang\.AssertionError\)/);
  assert.match(text, /2\. PatientApiTest\.readById \(error, java\.lang\.IllegalStateException\)/);
  assert.match(text, /- PatientApiTest\.duplicateMrnIs409/);
  assert.doesNotMatch(text, /MRN-000123|Loaded patient|Patient\/42/);
});

test("all-green summary says PASS", () => {
  const { ok, text } = summarize([parseSurefireXml(PASSING)]);
  assert.equal(ok, true);
  assert.match(text, /## Test summary: PASS\n\n2 tests: 2 passed, 0 failed/);
});

test("--since drops stale report files", () => {
  const dir = tempReports({ "TEST-a.xml": PASSING, "TEST-b.xml": FAILING });
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(join(dir, "TEST-b.xml"), old, old);
  const { reports, skippedStale } = loadReports(dir, Date.parse("2021-01-01T00:00:00Z"));
  assert.equal(reports.length, 1);
  assert.equal(skippedStale, 1);
  rmSync(dir, { recursive: true });
});

test("CLI exit codes: 0 on failures by default, 1 with --strict, 2 without reports", () => {
  const dir = tempReports({ "TEST-b.xml": FAILING, "b.txt": "ignored" });
  const normal = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
  assert.equal(normal.status, 0);
  assert.match(normal.stdout, /Test summary: FAIL/);
  const strict = spawnSync(process.execPath, [SCRIPT, dir, "--strict"], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  const empty = spawnSync(process.execPath, [SCRIPT, join(dir, "missing")], { encoding: "utf8" });
  assert.equal(empty.status, 2);
  assert.match(empty.stdout, /NO REPORTS/);
  const badSince = spawnSync(process.execPath, [SCRIPT, dir, "--since", "yesterday"], { encoding: "utf8" });
  assert.equal(badSince.status, 2);
  rmSync(dir, { recursive: true });
});
