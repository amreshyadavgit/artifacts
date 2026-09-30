// Tests for the module 01-foundations scripts. Run from AI-SDLC/:
//   node --test docs/foundations/foundations.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContract, toAgentContract, FIELDS } from "./validate-contract.mjs";
import { parseKey, grade, PRIMITIVES } from "./grade-classification.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const draft = readFileSync(join(HERE, "reviewer-contract-draft.md"), "utf8");
const template = readFileSync(join(ROOT, "agents", "CONTRACT_TEMPLATE.md"), "utf8");
const keyMd = readFileSync(join(HERE, "classification-answer-key.md"), "utf8");
const run = (script, args) => spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: "utf8" });

test("reviewer draft is a valid contract", () => {
  const r = validateContract(draft);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test("template passes template mode but fails as a filled contract", () => {
  assert.equal(validateContract(template, { template: true }).ok, true);
  const r = validateContract(template);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unreplaced <placeholder>")));
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
  assert.ok(validateContract(bad).errors.some((e) => /^must\[3\]/.test(e)));
});

test("invented tool name fails", () => {
  const bad = draft.replace("- Glob\n", "- CodeSearch\n");
  assert.ok(validateContract(bad).errors.includes('tools: "CodeSearch" is not a Claude Code tool name'));
});

test("MCP tool names are accepted", () => {
  const ok = draft.replace("- Glob\n", "- Glob\n- mcp__fhir-lite__search_observations\n");
  assert.equal(validateContract(ok).ok, true);
});

test("humanGate without a real mechanism fails", () => {
  const i = draft.indexOf("## humanGate");
  const bad = draft.slice(0, i) + "## humanGate\n\nA senior engineer looks at the output when they have time.\n";
  assert.ok(validateContract(bad).errors.some((e) => e.startsWith("humanGate:")));
});

test("agent outside the roster fails", () => {
  const bad = draft.replace("# Agent Contract: reviewer", "# Agent Contract: code-reviewer");
  assert.ok(validateContract(bad).errors.some((e) => e.includes("not in the roster")));
});

test("toAgentContract yields every schema field with the right types", () => {
  const c = toAgentContract(draft);
  assert.deepEqual(Object.keys(c), ["agent", ...FIELDS]);
  assert.equal(c.agent, "reviewer");
  for (const f of ["inputs", "outputs", "tools", "must", "mustNot", "failureConditions"]) assert.ok(Array.isArray(c[f]) && c[f].length > 0, f);
  for (const f of ["purpose", "permissions", "validation", "handoffFormat", "humanGate"]) assert.equal(typeof c[f], "string");
  assert.deepEqual(c.tools, ["Read", "Grep", "Glob", "Bash (only `git diff`, `git log`, `git status`)"]);
});

test("validator CLI exit codes: 0 valid, 1 invalid, 2 usage", () => {
  assert.equal(run("validate-contract.mjs", [join(HERE, "reviewer-contract-draft.md")]).status, 0);
  assert.equal(run("validate-contract.mjs", [join(ROOT, "agents", "CONTRACT_TEMPLATE.md")]).status, 1);
  assert.equal(run("validate-contract.mjs", []).status, 2);
});

test("answer key parses ten needs with valid primitives", () => {
  const key = parseKey(keyMd);
  assert.equal(key.size, 10);
  for (const k of key.values()) {
    assert.ok(PRIMITIVES.includes(k.answer));
    for (const a of k.accepted) assert.ok(PRIMITIVES.includes(a));
  }
  assert.equal(key.get("N01").answer, "hook");
  assert.deepEqual(key.get("N09").accepted, ["skill"]);
});

test("grader scores correct, accepted, wrong and missing answers", () => {
  const key = parseKey(keyMd);
  const r = grade(key, { N01: "hook", N04: { answer: "skill", why: "reuse" }, N09: { answer: "skill", why: "production-rca inside the sre agent" } });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x.verdict]));
  assert.equal(by.N01, "CORRECT");
  assert.equal(by.N04, "WRONG");
  assert.equal(by.N09, "ACCEPTED");
  assert.equal(by.N02, "MISSING");
  assert.equal(r.score, 2);
});

test("grader CLI passes the example answers at 8/10", () => {
  const r = run("grade-classification.mjs", [join(HERE, "example-answers.json")]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /SCORE 8\/10 \(pass mark 8\) PASS/);
  assert.equal(run("grade-classification.mjs", [join(HERE, "example-answers.json"), "--pass", "9"]).status, 1);
});
