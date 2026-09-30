#!/usr/bin/env node
// Tests for the deterministic automation scripts. Run: node --test scripts/automation/automation.test.mjs   (from AI-SDLC/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMigrations } from "./check-flyway-migrations.mjs";
import { scan, redact } from "./scan-phi.mjs";
import { checkMcpConfig } from "./check-mcp-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const V1 = "CREATE TABLE patient (id BIGINT PRIMARY KEY);\n";

function repoWithV1() {
  const root = mkdtempSync(join(tmpdir(), "flyway-"));
  const dir = join(root, "db", "migration");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "V1__init.sql"), V1);
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  g("init", "-q");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "v1");
  return { root, dir, done: () => rmSync(root, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------- check-flyway-migrations
test("flyway: the real sample-app migrations pass", () => {
  const r = spawnSync(process.execPath, [join(HERE, "check-flyway-migrations.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS: migrations valid against HEAD/);
});

test("flyway: unchanged V1 plus new V2 passes", () => {
  const t = repoWithV1();
  writeFileSync(join(t.dir, "V2__add_observation_effective_index.sql"), "CREATE INDEX ix ON observation (patient_id);\n");
  const r = checkMigrations({ dir: t.dir });
  assert.deepEqual(r.errors, []);
  assert.ok(r.info.includes("new V2__add_observation_effective_index.sql"));
  t.done();
});

test("flyway: editing an applied migration fails", () => {
  const t = repoWithV1();
  writeFileSync(join(t.dir, "V1__init.sql"), V1 + "ALTER TABLE patient ADD COLUMN note TEXT;\n");
  const r = checkMigrations({ dir: t.dir });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^immutability: applied migration V1__init.sql changed vs HEAD/);
  assert.match(r.errors[0], /Add a new V2__\*\.sql instead/);
  t.done();
});

test("flyway: deleting or renaming an applied migration fails", () => {
  const t = repoWithV1();
  renameSync(join(t.dir, "V1__init.sql"), join(t.dir, "V1__initial_schema.sql"));
  const r = checkMigrations({ dir: t.dir });
  assert.ok(r.errors.some((e) => /V1__init.sql was deleted/.test(e)));
  assert.ok(r.errors.some((e) => /^out-of-order: new migration V1__initial_schema.sql/.test(e)));
  t.done();
});

test("flyway: bad names fail", () => {
  const t = repoWithV1();
  for (const f of ["V2_add_index.sql", "v3__lowercase_v.sql", "V4__Add-Index.sql", "V5__notes.txt"]) writeFileSync(join(t.dir, f), "--\n");
  const r = checkMigrations({ dir: t.dir });
  assert.equal(r.errors.filter((e) => e.startsWith("naming")).length, 4);
  t.done();
});

test("flyway: duplicate versions and gaps fail", () => {
  const t = repoWithV1();
  writeFileSync(join(t.dir, "V3__skip_two.sql"), "--\n");
  let r = checkMigrations({ dir: t.dir });
  assert.ok(r.errors.some((e) => e === "gap: expected V2 before V3 (versions must be contiguous from V1)"));
  writeFileSync(join(t.dir, "V2__a.sql"), "--\n");
  writeFileSync(join(t.dir, "V2__b.sql"), "--\n");
  r = checkMigrations({ dir: t.dir });
  assert.ok(r.errors.some((e) => /^duplicate version V2: /.test(e)));
  t.done();
});

test("flyway: missing base ref is a usage error (exit 2)", () => {
  const t = repoWithV1();
  const r = spawnSync(process.execPath, [join(HERE, "check-flyway-migrations.mjs"), "--dir", t.dir, "--base", "origin/nope"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  t.done();
});

// ---------------------------------------------------------------- scan-phi
test("scan-phi: synthetic data is clean", () => {
  const text = "Subject Patient/42, MRN-000123, name: Test Patient, contact dev@example.org, LOINC 8867-4";
  assert.deepEqual(scan(text), []);
});

test("scan-phi: real-looking identifiers are found by kind", () => {
  const text = [
    "Reporter pasted MRN 48812345 from the ward",
    "Patient name: Maria Gonzalez, DOB: 1961-04-12",
    "SSN 123-45-6789, call 555-201-3344 or maria.g@hospital.net",
  ].join("\n");
  const kinds = scan(text).map((f) => f.kind).sort();
  assert.deepEqual(kinds, ["DOB", "EMAIL", "MRN", "NAME", "PHONE", "SSN"]);
});

test("scan-phi: redact removes every finding and keeps labels", () => {
  const text = "Patient name: Maria Gonzalez, DOB: 1961-04-12, MRN-448812";
  const out = redact(text);
  assert.deepEqual(scan(out), []);
  assert.match(out, /Patient name: \[REDACTED-NAME\]/);
  assert.match(out, /DOB: \[REDACTED-DOB\]/);
  assert.match(out, /\[REDACTED-MRN\]/);
});

test("scan-phi: CLI exits 1 and never prints the matched value", () => {
  const dir = mkdtempSync(join(tmpdir(), "phi-"));
  const f = join(dir, "handoff.md");
  writeFileSync(f, "ok line\nDOB: 1961-04-12\n");
  const r = spawnSync(process.execPath, [join(HERE, "scan-phi.mjs"), f], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /handoff\.md:2: DOB/);
  assert.doesNotMatch(r.stdout, /1961/);
  const fixed = spawnSync(process.execPath, [join(HERE, "scan-phi.mjs"), "--fix", f], { encoding: "utf8" });
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.equal(readFileSync(f, "utf8"), "ok line\nDOB: [REDACTED-DOB]\n");
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- check-mcp-config
test("mcp-config: the repo .mcp.json passes", () => {
  const r = spawnSync(process.execPath, [join(HERE, "check-mcp-config.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
});

test("mcp-config: inline token, url without type, and scope key fail", () => {
  const bad = {
    mcpServers: {
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer abcdef1234567890abcdef" } },
      jira: { url: "https://jira.example.com/mcp" },
      db: { command: "node", args: ["db.mjs"], scope: "project" },
    },
  };
  const { errors } = checkMcpConfig(JSON.stringify(bad));
  assert.ok(errors.some((e) => /github\.headers\.Authorization: looks like an inline credential/.test(e)));
  assert.ok(errors.some((e) => /jira: has "url" but no "type"/.test(e)));
  assert.ok(errors.some((e) => /db: "scope" is not an \.mcp\.json key/.test(e)));
});

test("mcp-config: plain http url fails, ${VAR} url with https default passes, unpinned npx warns", () => {
  const cfg = {
    mcpServers: {
      a: { type: "http", url: "http://internal/mcp" },
      b: { type: "http", url: "${JIRA_URL:-https://jira.example.com}/mcp", headers: { Authorization: "Bearer ${JIRA_TOKEN}" } },
      c: { type: "stdio", command: "npx", args: ["-y", "some-mcp-server"] },
    },
  };
  const { errors, warnings } = checkMcpConfig(JSON.stringify(cfg));
  assert.deepEqual(errors, ["mcpServers.a: url must use https"]);
  assert.ok(warnings.some((w) => /npx package "some-mcp-server" is not pinned/.test(w)));
});
