#!/usr/bin/env node
// Tests for the deterministic automation scripts. Run from AI-SDLC-frappe/: node --test scripts/automation/automation.test.mjs
// Every test that mutates something works on a temporary copy or a temporary git repo; the real app is only read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPatches, parsePatches } from "./check-patches.mjs";
import { lintDoctype, lintFiles, scrub } from "./lint-doctype-json.mjs";
import { checkSource } from "./check-phi-logging.mjs";
import { scan, redact } from "./scan-phi.mjs";
import { checkMcpConfig } from "./check-mcp-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const APP = join(ROOT, "sample-app", "spice_lite", "spice_lite");
const POLICY = JSON.parse(readFileSync(join(HERE, "doctype-policy.json"), "utf8"));
const node = (script, args = []) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: "utf8" });

// ---------------------------------------------------------------- check-patches
const BASE_PATCHES = "[pre_model_sync]\n# comment\n\n[post_model_sync]\nmyapp.patches.v0_1.backfill_country\n";
function appRepo() {
  const root = mkdtempSync(join(tmpdir(), "patches-"));
  const app = join(root, "myapp", "myapp");
  mkdirSync(join(app, "patches", "v0_1"), { recursive: true });
  mkdirSync(join(app, "patches", "v0_2"), { recursive: true });
  writeFileSync(join(app, "patches.txt"), BASE_PATCHES);
  writeFileSync(join(app, "patches", "v0_1", "backfill_country.py"), "def execute():\n\tpass\n");
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], { cwd: root, stdio: "ignore" });
  g("init", "-q");
  g("add", ".");
  g("commit", "-q", "-m", "v0.1");
  const patch = (name, body = "def execute():\n\tpass\n") => writeFileSync(join(app, "patches", "v0_2", `${name}.py`), body);
  const setTxt = (t) => writeFileSync(join(app, "patches.txt"), t);
  return { app, patch, setTxt, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("patches: the real spice_lite patches.txt passes", () => {
  const r = node("check-patches.mjs");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /OK     ok post_model_sync spice_lite\.patches\.v0_1\.backfill_patient_country/);
  assert.match(r.stdout, /PASS: patches\.txt valid against HEAD/);
});

test("patches: a new patch appended at the end of its section passes", () => {
  const t = appRepo();
  t.patch("index_observation_effective_datetime");
  t.setTxt(BASE_PATCHES + "myapp.patches.v0_2.index_observation_effective_datetime\n");
  const r = checkPatches({ app: t.app });
  assert.deepEqual(r.errors, []);
  assert.ok(r.info.includes("new post_model_sync myapp.patches.v0_2.index_observation_effective_datetime"));
  t.done();
});

test("patches: editing an applied line (even a trailing comment) fails", () => {
  const t = appRepo();
  t.setTxt(BASE_PATCHES.replace("backfill_country", "backfill_country #2026-10-01"));
  const r = checkPatches({ app: t.app });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^applied: \[post_model_sync\] line 5 changed "myapp\.patches\.v0_1\.backfill_country" to ".*#2026-10-01"; Patch Log matches the exact text/);
  t.done();
});

test("patches: removing an applied line or inserting above it fails", () => {
  const t = appRepo();
  t.setTxt("[pre_model_sync]\n[post_model_sync]\n");
  assert.match(checkPatches({ app: t.app }).errors[0], /was removed; sites that have not migrated yet would silently skip it/);
  t.patch("add_national_id");
  t.setTxt("[pre_model_sync]\n[post_model_sync]\nmyapp.patches.v0_2.add_national_id\nmyapp.patches.v0_1.backfill_country\n");
  const errs = checkPatches({ app: t.app }).errors;
  assert.ok(errs.some((e) => /new line 3 "myapp\.patches\.v0_2\.add_national_id" is inserted above existing patches/.test(e)), errs.join("\n"));
  assert.ok(errs.some((e) => /^order: line 4 v0_1 comes after v0_2 \(line 3\)/.test(e)), errs.join("\n"));
  t.done();
});

test("patches: structure errors that break bench migrate", () => {
  let r = parsePatches("myapp.patches.v0_1.a\n[pre_model_sync]\n[post_model_sync]\n");
  assert.match(r.errors[0], /comes before the first \[section\]/);
  r = parsePatches("[pre_model_sync]\n[post_model_sync]\nmyapp.patches.v0_1.a\nmyapp.patches.v0_1.a\n");
  assert.match(r.errors[0], /^duplicate: .*DuplicateOptionError/);
  r = parsePatches("[post_model_sync]\nmyapp.patches.v0_1.a\n");
  assert.match(r.errors[0], /section \[pre_model_sync\] is missing/);
  r = parsePatches("[pre_model_sync]\n[post_model_sync]\n[post_sync]\n  myapp.patches.v0_1.a\n");
  assert.ok(r.errors.some((e) => /unknown section \[post_sync\]/.test(e)));
  assert.ok(r.errors.some((e) => /line 4 is indented/.test(e)));
});

test("patches: missing module, missing execute(), orphans and execute: lines", () => {
  const t = appRepo();
  t.patch("no_execute", "def run():\n\tpass\n");
  t.patch("forgotten");
  t.setTxt(BASE_PATCHES + "myapp.patches.v0_2.does_not_exist\nmyapp.patches.v0_2.no_execute\nexecute:frappe.db.set_default('x', 1)\n");
  const r = checkPatches({ app: t.app });
  assert.ok(r.errors.some((e) => /^module: line 6 "myapp\.patches\.v0_2\.does_not_exist" has no file/.test(e)));
  assert.ok(r.errors.some((e) => /^module: line 7 "myapp\.patches\.v0_2\.no_execute" has no top-level def execute\(\)/.test(e)));
  assert.ok(r.warnings.some((w) => /^orphan: myapp\.patches\.v0_2\.forgotten defines execute\(\)/.test(w)));
  assert.ok(r.warnings.some((w) => /^execute: line 8 runs inline Python/.test(w)));
  t.done();
});

test("patches: a base ref that does not exist is a usage error (exit 2)", () => {
  const r = node("check-patches.mjs", ["--base", "origin/does-not-exist"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /base ref "origin\/does-not-exist" does not exist/);
});

// ---------------------------------------------------------------- lint-doctype-json
const PATIENT = join(APP, "clinical", "doctype", "sl_patient", "sl_patient.json");
const patient = () => JSON.parse(readFileSync(PATIENT, "utf8"));
const lint = (doc, folder = "sl_patient") => lintDoctype(doc, { folder, policy: POLICY }).errors;

test("doctype: the four real spice_lite DocTypes pass", () => {
  const r = node("lint-doctype-json.mjs");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS: 4 DocType file\(s\)/);
});

test("doctype: naming by a PHI field fails; the series passes", () => {
  const d = patient();
  assert.deepEqual(lint(d), []);
  d.autoname = "field:mrn";
  d.naming_rule = "By fieldname";
  assert.match(lint(d)[0], /^naming: SL Patient: autoname "field:mrn" builds the document name from PHI field "mrn"/);
  d.autoname = "format:PAT-{last_name}-{####}";
  d.naming_rule = "Expression";
  assert.match(lint(d)[0], /PHI field "last_name"/);
  d.autoname = "prompt";
  d.naming_rule = "Set by user";
  assert.match(lint(d)[0], /clinical DocType is named by the user/);
});

test("doctype: a filtered or searched field without search_index fails", () => {
  const d = patient();
  delete d.fields.find((f) => f.fieldname === "last_name").search_index;
  const errs = lint(d);
  assert.deepEqual(errs, [
    'index: SL Patient: "last_name" is used as in_standard_filter and search_fields but has neither search_index nor unique; add "search_index": 1 (and a patch if the table is large)',
  ]);
  d.fields.find((f) => f.fieldname === "gender").in_standard_filter = 1;
  assert.ok(lint(d).some((e) => /"gender" is used as in_standard_filter/.test(e)));
});

test("doctype: permissions must match the policy", () => {
  const d = patient();
  d.permissions.find((p) => p.role === "Clinician").delete = 1;
  d.permissions.find((p) => p.role === "Clinician").export = 1;
  d.permissions.push({ role: "Guest", read: 1 }, { role: "Nurse", read: 1 });
  const errs = lint(d);
  assert.ok(errs.includes('perms: SL Patient: permissions[role=Clinician, permlevel=0]: forbidden right "delete"'), errs.join("\n"));
  assert.ok(errs.includes('perms: SL Patient: permissions[role=Clinician, permlevel=0]: forbidden right "export"'));
  assert.ok(errs.some((e) => /role "Guest" must never have rights/.test(e)));
  assert.ok(errs.some((e) => /role "Nurse" is not in scripts\/automation\/doctype-policy\.json/.test(e)));
  const noClin = patient();
  noClin.permissions = noClin.permissions.filter((p) => p.role !== "Clinician");
  assert.ok(lint(noClin).includes('perms: SL Patient: role "Clinician" from the policy has no permissions row'));
});

test("doctype: field_order drift, wrong folder and broken JSON fail", () => {
  const d = patient();
  d.field_order = d.field_order.filter((f) => f !== "country");
  assert.ok(lint(d).includes('field_order: SL Patient: field "country" is missing from field_order'));
  assert.ok(lint(patient(), "patient").some((e) => /folder "patient" should be "sl_patient"/.test(e)));
  assert.equal(scrub("SL Observation"), "sl_observation");
  const dir = mkdtempSync(join(tmpdir(), "dt-"));
  writeFileSync(join(dir, "x.json"), "{ not json");
  assert.match(lintFiles([join(dir, "x.json")], POLICY).errors[0], /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- check-phi-logging
test("phi-logging: the real spice_lite code passes (tests included)", () => {
  const r = node("check-phi-logging.mjs", ["--include-tests"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^PASS: \d+ Python file\(s\)/m);
});

test("phi-logging: the synthetic bad fixture yields exactly the six planted findings", () => {
  const f = checkSource(readFileSync(join(HERE, "fixtures", "bad_logging.py"), "utf8"));
  const got = f.map((x) => `${x.rule}:${x.line}:${x.name}`).sort();
  assert.deepEqual(got, [
    "more-info:13:with_more_info=True",
    "phi-field:11:family",
    "phi-field:11:identifier",
    "phi-field:24:mrn",
    "phi-field:37:last_name",
    "whole-doc:32:as_dict",
  ]);
});

test("phi-logging: words in plain strings and document names are not findings", () => {
  const src = [
    'frappe.throw(_("A patient with this MRN already exists"))',
    'frappe.throw(_("Patient {0} does not exist").format(self.patient))',
    'log_access("read", "SL Patient", doc.name)',
    'frappe.logger().info({"action": "search", "result_count": len(rows)})',
  ].join("\n");
  assert.deepEqual(checkSource(src), []);
  assert.equal(checkSource('print(f"{doc.first_name}")')[0].name, "first_name");
});

// ---------------------------------------------------------------- scan-phi
test("scan-phi: synthetic course data is clean", () => {
  const text = "Subject SLP-00042, MRN-000123, name: Test Patient, user clinician@spice-lite.test, dev@example.org, LOINC 8480-6, 2026-09-30";
  assert.deepEqual(scan(text), []);
});

test("scan-phi: real-looking identifiers are found by kind", () => {
  const text = [
    "Seen at the clinic: Patient name: Wanjiru Kamau, DOB: 1972-05-14, MRN 20417733",
    "National ID: 23456789, call +254 712 345 678 or 0712 345 678, w.kamau@mail.example.net",
    "Form Dict: {'family': 'Kamau', 'identifier': 'urn:spice-lite:mrn|KE-1182'}",
  ].join("\n");
  const kinds = scan(text).map((f) => f.kind).sort();
  assert.deepEqual(kinds, ["DOB", "EMAIL", "FIELD", "FIELD", "MRN", "NAME", "NATIONAL_ID", "PHONE", "PHONE"]);
});

test("scan-phi: redact removes every finding and keeps labels", () => {
  const text = "Patient name: Wanjiru Kamau, DOB: 1972-05-14, MRN 20417733, National ID: 23456789\nForm Dict: {'family': 'Kamau'}";
  const out = redact(text);
  assert.deepEqual(scan(out), []);
  assert.match(out, /Patient name: \[REDACTED-NAME\]/);
  assert.match(out, /DOB: \[REDACTED-DOB\]/);
  assert.match(out, /\[REDACTED-MRN\]/);
  assert.match(out, /National ID: \[REDACTED-NATIONAL_ID\]/);
  assert.match(out, /'family': '\[REDACTED\]'/);
});

test("scan-phi: a Frappe log written with with_more_info=True fails; the CLI never prints values", () => {
  const log = join(HERE, "fixtures", "audit-with-more-info.log");
  const r = node("scan-phi.mjs", [log]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /audit-with-more-info\.log:7: FIELD/);
  assert.match(r.stdout, /audit-with-more-info\.log:5: EMAIL/);
  assert.doesNotMatch(r.stdout, /Kamau|20417733|clinic\.example/);
  const ignored = node("scan-phi.mjs", ["--ignore", "EMAIL", log]);
  assert.doesNotMatch(ignored.stdout, /EMAIL/);
  assert.equal(ignored.status, 1);
  assert.equal(node("scan-phi.mjs", ["--ignore", "NOPE", log]).status, 2);
});

test("scan-phi: --fix rewrites the file and the rescan passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "phi-"));
  const f = join(dir, "handoff.md");
  writeFileSync(f, "ok line\nDOB: 1972-05-14\n");
  const r = node("scan-phi.mjs", ["--fix", f]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(readFileSync(f, "utf8"), "ok line\nDOB: [REDACTED-DOB]\n");
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- check-mcp-config
test("mcp-config: the repo .mcp.json passes", () => {
  const r = node("check-mcp-config.mjs");
  assert.equal(r.status, 0, r.stdout);
});

test("mcp-config: inline token, url without type, scope key, literal secret env and site_config fail", () => {
  const bad = {
    mcpServers: {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer abcdef1234567890abcdef" } },
      jira: { url: "https://jira.example.com/mcp", scope: "project" },
      "spice-site": {
        type: "stdio",
        command: "node",
        args: ["mcp/spice-site-server/server.mjs", "--config", "/home/user/frappe-bench/sites/test.localhost/site_config.json"],
        env: { SPICE_SITE_API_SECRET: "4f2a9c1b7e8d0a3" },
      },
    },
  };
  const { errors } = checkMcpConfig(JSON.stringify(bad));
  assert.ok(errors.some((e) => /github\.headers\.Authorization: looks like an inline credential/.test(e)));
  assert.ok(errors.some((e) => /jira: has "url" but no "type"/.test(e)));
  assert.ok(errors.some((e) => /spice-site\.env\.SPICE_SITE_API_SECRET: credential-named variable must be a \$\{VAR\} reference/.test(e)));
  assert.ok(errors.some((e) => /spice-site: references site_config\.json/.test(e)));
});

test("mcp-config: plain http url fails, ${VAR:-https default} passes, empty ${VAR:-} secret passes", () => {
  const cfg = {
    mcpServers: {
      a: { type: "http", url: "http://internal/mcp" },
      b: { type: "http", url: "${JIRA_URL:-https://jira.example.com}/mcp", headers: { Authorization: "Bearer ${JIRA_TOKEN}" } },
      c: { type: "stdio", command: "node", args: ["s.mjs"], env: { X_API_SECRET: "${X_API_SECRET:-}" } },
    },
  };
  assert.deepEqual(checkMcpConfig(JSON.stringify(cfg)).errors, ["mcpServers.a: url must use https"]);
});
