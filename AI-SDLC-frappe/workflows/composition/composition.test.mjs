#!/usr/bin/env node
// Tests for check-roster-flat.mjs, context-budget.mjs and security-scope.mjs (Frappe edition).
// Usage (from AI-SDLC-frappe/): node workflows/composition/composition.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lint, readAgent, splitTools } from "./check-roster-flat.mjs";
import { report } from "./context-budget.mjs";
import { classify, parseDiff } from "./security-scope.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");
const example = (name) => readFileSync(join(here, "..", "examples", "feature-observation-code-vocabulary", "patches", name), "utf8");
const agent = (name, tools, extra = "") => ({ file: `${name}.md`, fm: readAgent(`---\nname: ${name}\ndescription: test\n${tools === null ? "" : `tools: ${tools}\n`}${extra}---\nbody\n`) });
const rules = (text) => [...new Set(classify(parseDiff(text)).reasons.map((r) => r.rule))].sort().join(",");
const newFile = (path, lines) => `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => "+" + l).join("\n")}\n`;

const cases = [
  // ---- topology lint -------------------------------------------------------------------
  ["splitTools keeps the Agent(...) list together",
    () => JSON.stringify(splitTools("Agent(architect, developer), Read, Bash(git diff *)")) === JSON.stringify(["Agent(architect, developer)", "Read", "Bash(git diff *)"])],
  ["YAML list form of tools is read",
    () => readAgent("---\nname: tester\ntools:\n  - Read\n  - Grep\n---\n").tools === "Read, Grep"],
  ["flat roster + orchestrator passes",
    () => lint([agent("orchestrator", "Agent(architect, developer, reviewer, tester, security, sre), Read, Write, Grep, Glob, Skill"), agent("reviewer", "Read, Grep, Glob, Bash"), agent("security", "Read, Grep, Glob")]).errors.length === 0],
  ["roster agent listing Agent is an error",
    () => lint([agent("architect", "Read, Grep, Glob, Agent")]).errors.some((e) => /can spawn subagents/.test(e))],
  ["roster agent that omits tools inherits Agent: error",
    () => lint([agent("developer", null)]).errors.some((e) => /inherits every tool including Agent/.test(e))],
  ["omitted tools but disallowedTools: Agent is accepted",
    () => lint([agent("developer", null, "disallowedTools: Agent\n")]).errors.length === 0],
  ["Agent(type) list in a subagent definition raises the 'ignored' warning",
    () => lint([agent("sre", "Read, Agent(Explore)")]).warnings.some((w) => /type list is ignored/.test(w))],
  ["orchestrator delegating to a non-roster type is an error",
    () => lint([agent("orchestrator", "Agent(architect, general-purpose), Read")]).errors.some((e) => /general-purpose/.test(e))],
  ["orchestrator with Bash is an error (it must never run bench)",
    () => lint([agent("orchestrator", "Agent(architect), Read, Bash")]).errors.some((e) => /must not have Bash/.test(e))],
  ["CLI lint of the real .claude/agents exits 0",
    () => spawnSync(process.execPath, [join(here, "check-roster-flat.mjs"), join(here, "..", "..", ".claude", "agents")], { encoding: "utf8" }).status === 0],
  // ---- context budget ------------------------------------------------------------------
  ["context budget counts body, preloaded skill and CLAUDE.md import", () => {
    const p = mkdtempSync(join(tmpdir(), "budget-"));
    try {
      mkdirSync(join(p, ".claude", "agents"), { recursive: true });
      mkdirSync(join(p, ".claude", "skills", "code-review"), { recursive: true });
      mkdirSync(join(p, "context"), { recursive: true });
      writeFileSync(join(p, "CLAUDE.md"), "rules\n- @context/a.md\n");          // 22 chars
      writeFileSync(join(p, "context", "a.md"), "x".repeat(378));              // 378 chars
      writeFileSync(join(p, ".claude", "skills", "code-review", "SKILL.md"), "y".repeat(800));
      writeFileSync(join(p, ".claude", "agents", "reviewer.md"), "---\nname: reviewer\nskills:\n  - code-review\n---\n" + "z".repeat(400));
      const r = report(p).rows[0];
      return r.name === "reviewer" && r.skillChars === 800 && r.bodyChars === 400 && r.totalTokens === Math.round((22 + 378 + 800 + 400) / 4);
    } finally { rmSync(p, { recursive: true, force: true }); }
  }],
  // ---- security scope (conditional security step) --------------------------------------
  ["whitelist-count.patch is MANDATORY (rule 2 whitelist, rule 5 frappe.db.count)",
    () => rules(fixture("whitelist-count.patch")) === "2,5"],
  ["encounter-refactor.patch (controller only) is SKIP",
    () => classify(parseDiff(fixture("encounter-refactor.patch"))).mandatory === false],
  ["tests-only patch is SKIP (test files are excluded from rules 2, 4 and 5)",
    () => classify(parseDiff(fixture("whitelist-count-tests.patch"))).mandatory === false],
  ["example 04-developer.patch triggers rules 1, 3, 4, 5",
    () => rules(example("04-developer.patch")) === "1,3,4,5"],
  ["example 07-developer.patch (Clinician DocPerm row narrowed) triggers rule 1",
    () => rules(example("07-developer.patch")) === "1"],
  ["a DocField change without permission keys is not rule 1",
    () => rules("diff --git a/x/doctype/sl_patient/sl_patient.json b/x/doctype/sl_patient/sl_patient.json\n--- a/x/doctype/sl_patient/sl_patient.json\n+++ b/x/doctype/sl_patient/sl_patient.json\n@@ -10,3 +10,3 @@\n   \"fieldname\": \"last_name\",\n-  \"in_list_view\": 1,\n+  \"in_list_view\": 0,\n") === ""],
  ["a field permlevel change is rule 1",
    () => rules("diff --git a/x/doctype/sl_patient/sl_patient.json b/x/doctype/sl_patient/sl_patient.json\n--- a/x/doctype/sl_patient/sl_patient.json\n+++ b/x/doctype/sl_patient/sl_patient.json\n@@ -10,2 +10,3 @@\n   \"fieldname\": \"mrn\",\n+  \"permlevel\": 1,\n") === "1"],
  ["removing ignore_permissions is still rule 4 (a permission decision changed)",
    () => rules("diff --git a/a/install.py b/a/install.py\n--- a/a/install.py\n+++ b/a/install.py\n@@ -5,1 +5,1 @@\n-\tdoc.insert(ignore_permissions=True)\n+\tdoc.insert()\n") === "4"],
  ["a fixture shipping Custom DocPerm records is rule 6",
    () => rules(newFile("sample-app/spice_lite/spice_lite/fixtures/custom_docperm.json", ["[", " {", "  \"doctype\": \"Custom DocPerm\",", "  \"role\": \"Clinician\"", " }", "]"])) === "6"],
  ["CLI prints MANDATORY with file:line evidence", () => {
    const r = spawnSync(process.execPath, [join(here, "security-scope.mjs"), join(here, "fixtures", "whitelist-count.patch")], { encoding: "utf8" });
    return r.status === 0 && /^SECURITY STEP: MANDATORY \(rules 2, 5\)\n- rule 2 sample-app\/spice_lite\/spice_lite\/api\/fhir\.py:140:/.test(r.stdout);
  }],
  ["CLI without arguments is a usage error (exit 2)",
    () => spawnSync(process.execPath, [join(here, "security-scope.mjs")], { encoding: "utf8" }).status === 2],
];

let failed = 0;
for (const [name, fn] of cases) {
  let ok = false;
  try { ok = fn(); } catch (e) { console.log(`      ${e.message}`); }
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
