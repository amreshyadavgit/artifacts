// Tests for reviewer-bash-guard.mjs. Run from AI-SDLC/:
//   node --test docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./reviewer-bash-guard.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "reviewer-bash-guard.mjs");

function run(input) {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });
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

test("allows read-only git commands", () => {
  for (const c of ["git diff", "git diff HEAD -- sample-app", "git log --oneline -5", "git show HEAD:sample-app/pom.xml", "git status --short"]) {
    assert.equal(decide(bash(c)).allow, true, c);
  }
});

test("blocks non-git and mutating commands", () => {
  for (const c of ["mvn -q -B test", "rm -rf sample-app", "git commit -am wip", "git push", "git checkout -- .", "cat .env", "gitdiff"]) {
    assert.equal(decide(bash(c)).allow, false, c);
  }
});

test("blocks chaining, redirection and substitution", () => {
  for (const c of ["git diff; rm -rf /tmp/x", "git diff && git push", "git diff | tee out.txt", "git diff > review.txt", "git log $(whoami)", "git diff `id`", "git status\nrm x"]) {
    assert.equal(decide(bash(c)).allow, false, c);
  }
});

test("blocks git options that write files or run programs", () => {
  for (const c of ["git diff --output=/tmp/x", "git diff --output /tmp/x", "git diff --ext-diff", "git log --textconv", "git -c core.pager=sh diff"]) {
    assert.equal(decide(bash(c)).allow, false, c);
  }
});

test("ignores other tools", () => {
  assert.equal(decide({ tool_name: "Read", tool_input: { file_path: "sample-app/pom.xml" } }).allow, true);
});

test("process exit codes: 0 allow, 2 block with reason on stderr, 2 on bad JSON", () => {
  assert.equal(run(bash("git diff")).status, 0);
  const blocked = run(bash("git push origin main"));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /reviewer may only run git diff, git log, git show or git status; blocked: git push origin main/);
  assert.equal(run("not json").status, 2);
});
