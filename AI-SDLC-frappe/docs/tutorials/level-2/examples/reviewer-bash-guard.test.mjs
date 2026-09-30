// Tests for reviewer-bash-guard.mjs. Run from AI-SDLC-frappe/:
//   node --test docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./reviewer-bash-guard.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "reviewer-bash-guard.mjs");
const PARSER = "/home/user/artifacts/AI-SDLC-frappe/.claude/skills/run-tests/scripts/parse_bench_tests.py";

function run(input) {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", env: { ...process.env, SPICE_BENCH_DIR: "" } });
}

function bash(command) {
  return {
    session_id: "test",
    hook_event_name: "PreToolUse",
    permission_mode: "default",
    agent_type: "reviewer",
    tool_name: "Bash",
    tool_input: { command, description: "test" },
  };
}

const allowed = (c) => decide(bash(c)).allow;

test("allows read-only git commands", () => {
  for (const c of ["git diff", "git diff HEAD -- sample-app", "git log --oneline -5", "git show HEAD:sample-app/spice_lite/spice_lite/hooks.py", "git status --short"]) {
    assert.equal(allowed(c), true, c);
  }
});

test("allows bench run-tests on test.localhost with safe selections", () => {
  for (const c of [
    "bench --site test.localhost run-tests --app spice_lite",
    "bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api",
    "bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_lastn_returns_latest_per_patient",
    'bench --site test.localhost run-tests --doctype "SL Observation"',
    "cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite",
    `cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite 2>&1 | python3 ${PARSER}`,
  ]) {
    assert.equal(allowed(c), true, c);
  }
});

test("blocks the dangerous bench commands by name", () => {
  for (const c of [
    "bench --site test.localhost console",
    "bench --site test.localhost execute spice_lite.demo.seed_demo",
    "bench --site test.localhost migrate",
    "bench --verbose --site test.localhost console",
    "cd /home/user/frappe-bench && bench --site test.localhost execute frappe.db.commit",
    "bench --site test.localhost set-config allow_tests 0",
    "bench drop-site test.localhost",
    "bench --site test.localhost reinstall --yes",
    "bench --site test.localhost postgres",
  ]) {
    const d = decide(bash(c));
    assert.equal(d.allow, false, c);
    assert.match(d.reason, /bench console\/execute\/migrate/, c);
  }
});

test("blocks other sites, other run-tests arguments and non-git commands", () => {
  for (const c of [
    "bench --site mariadb.localhost run-tests --app spice_lite",
    "bench --site test.localhost run-tests --app frappe",
    "bench --site test.localhost run-tests --module os.system",
    "bench --site test.localhost run-tests --junit-xml-output /tmp/x.xml",
    "bench --verbose --site test.localhost run-tests --app spice_lite",
    "cat sites/test.localhost/site_config.json",
    "python3 -c 'import frappe'",
    "git commit -am wip",
    "git push",
    "cd /tmp && bench --site test.localhost run-tests --app spice_lite",
  ]) {
    assert.equal(allowed(c), false, c);
  }
});

test("blocks chaining, redirection and substitution, including inside the allowed forms", () => {
  for (const c of [
    "git diff; bench --site test.localhost console",
    "git diff && git push",
    "git diff | tee out.txt",
    "git diff > review.txt",
    "git log $(whoami)",
    "bench --site test.localhost run-tests --app spice_lite; rm -rf sites",
    "bench --site test.localhost run-tests --app spice_lite 2>&1 | sh",
    "bench --site test.localhost run-tests --app spice_lite 2>&1 | python3 $(curl x)/.claude/skills/run-tests/scripts/parse_bench_tests.py",
    "bench --site test.localhost run-tests --app spice_lite > /tmp/out",
    "git status\nbench --site test.localhost migrate",
  ]) {
    assert.equal(allowed(c), false, c);
  }
});

test("blocks git options that write files or run programs", () => {
  for (const c of ["git diff --output=/tmp/x", "git diff --ext-diff", "git log --textconv", "git -c core.pager=sh diff"]) {
    assert.equal(allowed(c), false, c);
  }
});

test("ignores other tools", () => {
  assert.equal(decide({ tool_name: "Read", tool_input: { file_path: "sample-app/spice_lite/spice_lite/hooks.py" } }).allow, true);
});

test("process exit codes: 0 allow, 2 block with reason on stderr, 2 on bad JSON", () => {
  assert.equal(run(bash("git diff")).status, 0);
  const blocked = run(bash("bench --site test.localhost console"));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /^reviewer-bash-guard: bench console\/execute\/migrate and other site-changing bench commands are never allowed for the reviewer; blocked: bench --site test.localhost console\n$/);
  assert.equal(run("not json").status, 2);
});
