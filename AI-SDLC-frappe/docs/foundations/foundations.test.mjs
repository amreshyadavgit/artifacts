// Tests for the module 01-foundations scripts (Frappe edition). Run from AI-SDLC-frappe/:
//   node --test docs/foundations/foundations.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContract, toAgentContract, bareHookCount, FIELDS } from "./validate-contract.mjs";
import { parseKey, grade, PRIMITIVES } from "./grade-classification.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const draft = readFileSync(join(HERE, "reviewer-contract-draft.md"), "utf8");
const firstAttempt = readFileSync(join(HERE, "reviewer-contract-first-attempt.md"), "utf8");
const template = readFileSync(join(ROOT, "agents", "CONTRACT_TEMPLATE.md"), "utf8");
const keyMd = readFileSync(join(HERE, "classification-answer-key.md"), "utf8");
const run = (script, args) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: "utf8" });

test("reviewer draft is a valid contract with no warnings", () => {
  const r = validateContract(draft);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
});

test("template passes template mode but fails as a filled contract", () => {
  assert.equal(validateContract(template, { template: true }).ok, true);
  const r = validateContract(template);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unreplaced <placeholder>")));
});

test("template headings are the schema fields in order", () => {
  const headings = template.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
  assert.deepEqual(headings, FIELDS);
});

test("first attempt reports exactly the five planted mistakes", () => {
  const r = validateContract(firstAttempt);
  assert.deepEqual(r.errors, [
    'tools: "DocTypeInspector" is not a Claude Code tool name',
    'tools: "bench ... console" must not be in a tool scope (arbitrary code as Administrator or destroys a site)',
    "must[4]: must end with [mechanism: ...] or [convention: ...]",
    "humanGate: name the real mechanism (plan mode, a permission ask rule, PR approval, or a Claude Code hook that exits 2)",
  ]);
  assert.deepEqual(r.warnings, ['must: 1 bare "hook" (say "Frappe hook" or "Claude Code hook", CLAUDE.md rule 5)']);
});

test("missing section is reported", () => {
  const r = validateContract(draft.replace("## humanGate", "## Human gate"));
  assert.ok(r.errors.includes('missing section "## humanGate"'));
  assert.ok(r.warnings.some((w) => w.includes('"## Human gate"')));
});

test("sections out of order are reported", () => {
  const swapped = draft.replace("## must\n", "## TMP\n").replace("## mustNot\n", "## must\n").replace("## TMP\n", "## mustNot\n");
  assert.ok(validateContract(swapped).errors.some((e) => e.startsWith("sections out of order")));
});

test("must rule without enforcement tag fails", () => {
  const bad = draft.replace("[convention: human reviewer reads the handoff]", "");
  assert.ok(validateContract(bad).errors.some((e) => /^must\[4\]/.test(e)));
});

test("bench execute and drop-site scopes fail; migrate needs the ask rule; negated scopes pass", () => {
  const withTool = (t) => validateContract(draft.replace("- Glob\n", `- Glob\n- ${t}\n`));
  assert.ok(withTool("Bash (`bench --site test.localhost execute spice_lite.demo.seed_demo`)").errors.some((e) => e.includes("execute")));
  assert.ok(withTool("Bash (`bench drop-site scratch.localhost`)").errors.some((e) => e.includes("drop-site")));
  assert.ok(withTool("Bash (`bench --site test.localhost migrate`)").errors.some((e) => e.includes("migrate")));
  assert.equal(withTool("Bash (`bench --site test.localhost migrate`, behind the `ask` rule)").ok, true);
  assert.equal(withTool("Bash (`bench --site test.localhost run-tests *`; never console or execute)").ok, true);
});

test("bare hook is a warning; Frappe hook and Claude Code hook are not", () => {
  assert.equal(bareHookCount("add a hook for this"), 1);
  assert.equal(bareHookCount("a Frappe hook in `hooks.py` and a Claude Code `PreToolUse` hook"), 0);
  assert.equal(bareHookCount("Claude Code hooks fire inside subagents"), 0);
});

test("MCP tool names are accepted, invented names are not", () => {
  assert.equal(validateContract(draft.replace("- Glob\n", "- Glob\n- mcp__spice-site__observation_counts\n")).ok, true);
  assert.ok(validateContract(draft.replace("- Glob\n", "- BenchConsole\n")).errors.includes('tools: "BenchConsole" is not a Claude Code tool name'));
});

test("agent outside the roster fails", () => {
  const bad = draft.replace("# Agent Contract: reviewer", "# Agent Contract: frappe-reviewer");
  assert.ok(validateContract(bad).errors.some((e) => e.includes("not in the roster")));
});

test("toAgentContract yields every schema field with the right types", () => {
  const c = toAgentContract(draft);
  assert.deepEqual(Object.keys(c), ["agent", ...FIELDS]);
  assert.equal(c.agent, "reviewer");
  for (const f of ["inputs", "outputs", "tools", "must", "mustNot", "failureConditions"]) assert.ok(Array.isArray(c[f]) && c[f].length > 0, f);
  for (const f of ["purpose", "permissions", "validation", "handoffFormat", "humanGate"]) assert.equal(typeof c[f], "string");
  assert.deepEqual(c.tools, ["Read", "Grep", "Glob", "Bash (only `git diff`, `git log`, `git status`)"]);
  assert.equal(c.mustNot.filter((x) => x.includes("[mechanism:")).length, 4);
});

test("validator CLI exit codes: 0 valid, 1 invalid, 2 usage", () => {
  assert.equal(run("validate-contract.mjs", [join(HERE, "reviewer-contract-draft.md")]).status, 0);
  assert.equal(run("validate-contract.mjs", [join(HERE, "reviewer-contract-first-attempt.md")]).status, 1);
  assert.equal(run("validate-contract.mjs", [join(ROOT, "agents", "CONTRACT_TEMPLATE.md")]).status, 1);
  assert.equal(run("validate-contract.mjs", ["--template", join(ROOT, "agents", "CONTRACT_TEMPLATE.md")]).status, 0);
  assert.equal(run("validate-contract.mjs", []).status, 2);
});

test("answer key parses twelve needs with valid answers, two of them frappe-hook traps", () => {
  const key = parseKey(keyMd);
  assert.equal(key.size, 12);
  for (const k of key.values()) {
    assert.ok(PRIMITIVES.includes(k.answer));
    for (const a of k.accepted) assert.ok(PRIMITIVES.includes(a));
  }
  assert.equal(key.get("N01").answer, "claude-code-hook");
  assert.equal(key.get("N11").answer, "frappe-hook");
  assert.equal(key.get("N12").answer, "claude-code-hook");
  assert.deepEqual(key.get("N09").accepted, ["skill"]);
});

test("grader scores correct, accepted, wrong, ambiguous and missing answers", () => {
  const key = parseKey(keyMd);
  const r = grade(key, {
    N01: "claude-code-hook",
    N04: { answer: "skill", why: "reuse" },
    N08: "hook",
    N09: { answer: "skill", why: "production-rca inside the sre agent" },
    N11: "frappe-hook",
  });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x.verdict]));
  assert.equal(by.N01, "CORRECT");
  assert.equal(by.N04, "WRONG");
  assert.equal(by.N08, "AMBIGUOUS");
  assert.equal(by.N09, "ACCEPTED");
  assert.equal(by.N11, "CORRECT");
  assert.equal(by.N02, "MISSING");
  assert.equal(r.score, 3);
});

test("grader CLI passes the example answers at 10/12", () => {
  const r = run("grade-classification.mjs", [join(HERE, "example-answers.json")]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /SCORE 10\/12 \(pass mark 10\) PASS/);
  assert.equal(run("grade-classification.mjs", [join(HERE, "example-answers.json"), "--pass", "11"]).status, 1);
});
