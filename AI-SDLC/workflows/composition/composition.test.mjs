#!/usr/bin/env node
// Tests for check-roster-flat.mjs and context-budget.mjs.
// Usage (from AI-SDLC/): node workflows/composition/composition.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lint, readAgent, splitTools } from "./check-roster-flat.mjs";
import { report } from "./context-budget.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const agent = (name, tools, extra = "") => ({ file: `${name}.md`, fm: readAgent(`---\nname: ${name}\ndescription: test\n${tools === null ? "" : `tools: ${tools}\n`}${extra}---\nbody\n`) });

const cases = [
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
  ["orchestrator with Bash is an error",
    () => lint([agent("orchestrator", "Agent(architect), Read, Bash")]).errors.some((e) => /must not have Bash/.test(e))],
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
  ["CLI lint of the real .claude/agents exits 0", () => spawnSync(process.execPath, [join(here, "check-roster-flat.mjs"), join(here, "..", "..", ".claude", "agents")], { encoding: "utf8" }).status === 0],
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
