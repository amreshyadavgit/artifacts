#!/usr/bin/env node
// Tests for verify-system.mjs. Usage (from AI-SDLC/): node scripts/capstone/verify-system.test.mjs
// Builds a minimal, correctly wired project in a temp dir, breaks one thing per case, and runs the
// checker as a subprocess with --root and --json. The last cases run it against this repository.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "verify-system.mjs");
const repo = join(here, "..", "..");
const SPECIALISTS = ["architect", "developer", "reviewer", "tester", "security", "sre"];

function agentFile(name, { tools, skills = [], hooks = "" } = {}) {
  const t = tools ?? (name === "orchestrator" ? "Agent(architect, developer, reviewer, tester, security, sre), Read, Write" : "Read, Grep, Glob");
  const sk = skills.length ? `skills:\n${skills.map((s) => `  - ${s}`).join("\n")}\n` : "";
  const body = name === "orchestrator" ? "Follow `workflows/feature-delivery.md`." : "Write handoffs to .ai-sdlc/runs/ with status.";
  return `---\nname: ${name}\ndescription: ${name} agent for the fixture\ntools: ${t}\n${sk}${hooks}---\n\n${body}\n`;
}

function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "verify-system-"));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const files = {};
  for (const a of [...SPECIALISTS, "orchestrator"]) {
    files[`.claude/agents/${a}.md`] = agentFile(a, a === "tester" ? { skills: ["test-strategy"] } : {});
    files[`agents/${a}/CONTRACT.md`] = `# ${a} contract\n`;
  }
  files[".claude/agents/sre.md"] = agentFile("sre", {
    tools: "Read, Grep, Glob, Bash",
    skills: ["production-rca"],
    hooks: `hooks:\n  PreToolUse:\n    - matcher: "Bash"\n      hooks:\n        - type: command\n          command: "node \\"\${CLAUDE_PROJECT_DIR}/agents/tool-guard.mjs\\" bash-allow 'git log' 'node .claude/skills/production-rca/scripts/build-timeline.mjs'"\n`,
  });
  files["agents/tool-guard.mjs"] = "process.exit(0);\n";
  files[".claude/skills/test-strategy/SKILL.md"] = "---\nname: test-strategy\ndescription: plan tests\n---\nPlan.\n";
  files[".claude/skills/production-rca/SKILL.md"] = "---\nname: production-rca\ndescription: rca\n---\nRun `node .claude/skills/production-rca/scripts/build-timeline.mjs logs/*.log`.\n";
  files[".claude/skills/production-rca/scripts/build-timeline.mjs"] = "console.log('ok');\n";
  files[".claude/hooks/block-secrets.mjs"] = "process.exit(0);\n";
  files[".claude/settings.json"] = JSON.stringify({
    permissions: { allow: ["Bash(git diff *)"], ask: ["Bash(git push *)"], deny: ["Read(./.env)", "mcp__github__merge_pull_request"] },
    hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-secrets.mjs"' }] }] },
  }, null, 2);
  files["workflows/gates.settings.json"] = JSON.stringify({ permissions: { ask: ["Agent(developer)"] } });
  files["workflows/feature-delivery.md"] = "# Feature\n\n| step | file | agent | skill | gate |\n|---|---|---|---|---|\n| 01 | `01-requirements.md` | orchestrator | none | none |\n| 02 | `02-architect.md` | architect | none | none |\n| 05 | `05-tester.md` | tester | `test-strategy` | parallel |\n| G | none | human | none | gate |\n";
  files[".mcp.json"] = JSON.stringify({ mcpServers: {
    github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
    local: { type: "stdio", command: "node", args: ["${CLAUDE_PROJECT_DIR:-.}/mcp/server.mjs"] },
  } });
  files["mcp/server.mjs"] = "// server\n";
  files["context/overview.md"] = "# Overview\n";
  files["CLAUDE.md"] = "# Fixture\n\n- Architecture: @context/overview.md\n- Contact `@someone` in a code span is not an import.\n- Tests live in `workflows/`.\n";
  mutate(files, w);
  for (const [rel, text] of Object.entries(files)) if (text !== null) w(rel, text);
  return root;
}

function run(root, extra = []) {
  const r = spawnSync(process.execPath, [script, "--root", root, "--json", ...extra], { encoding: "utf8" });
  let rows = [];
  try { rows = JSON.parse(r.stdout).rows; } catch { /* usage errors print no JSON */ }
  return { status: r.status, rows, stdout: r.stdout, stderr: r.stderr };
}
const fails = (res, check) => res.rows.filter((r) => r.status === "FAIL" && (!check || r.check === check));

const HANDOFF = `---\nrun_id: 2026-09-22-inc-fixture\nstep: 01\nagent: orchestrator\nstatus: complete\ninputs: [incident:INC-1]\nnext: sre\n---\n## Summary\nx\n\n## Findings\nNo findings.\n\n## Decisions\n- x\n\n## Open questions\nNone.\n\n## Artifacts\n- x\n`;

const cases = [
  { name: "correctly wired fixture: exit 0, no FAIL rows",
    run: () => run(fixture()), check: (r) => r.status === 0 && fails(r).length === 0 && r.rows.some((x) => x.check === "roster" && x.status === "PASS") },
  { name: "missing Agent Contract fails the roster check",
    run: () => run(fixture((f) => { f["agents/reviewer/CONTRACT.md"] = null; })), check: (r) => r.status === 1 && fails(r, "roster").some((x) => /reviewer: agents\/reviewer\/CONTRACT.md missing/.test(x.detail)) },
  { name: "agent file whose name does not match fails",
    run: () => run(fixture((f) => { f[".claude/agents/tester.md"] = f[".claude/agents/tester.md"].replace("name: tester", "name: qa"); })), check: (r) => fails(r, "roster").some((x) => /tester: name is "qa"/.test(x.detail)) },
  { name: "preloaded skill that does not exist fails agent-skills",
    run: () => run(fixture((f) => { f[".claude/skills/test-strategy/SKILL.md"] = null; })), check: (r) => fails(r, "agent-skills").some((x) => /tester: test-strategy \(no/.test(x.detail)) },
  { name: "preloaded skill with disable-model-invocation: true fails",
    run: () => run(fixture((f) => { f[".claude/skills/test-strategy/SKILL.md"] = "---\nname: test-strategy\ndisable-model-invocation: true\n---\nx\n"; })), check: (r) => fails(r, "agent-skills").some((x) => /cannot be preloaded/.test(x.detail)) },
  { name: "specialist that lists Agent in tools fails delegation",
    run: () => run(fixture((f) => { f[".claude/agents/reviewer.md"] = agentFile("reviewer", { tools: "Read, Agent" }); })), check: (r) => fails(r, "delegation").some((x) => /reviewer/.test(x.detail)) },
  { name: "orchestrator Agent(...) list missing sre fails delegation",
    run: () => run(fixture((f) => { f[".claude/agents/orchestrator.md"] = agentFile("orchestrator", { tools: "Agent(architect, developer, reviewer, tester, security), Read" }); })), check: (r) => fails(r, "delegation").some((x) => /missing \[sre\]/.test(x.detail)) },
  { name: "settings.json that is not JSON fails",
    run: () => run(fixture((f) => { f[".claude/settings.json"] = "{ permissions: }"; })), check: (r) => fails(r, "settings").some((x) => /not valid JSON/.test(x.detail)) },
  { name: "settings hook pointing at a missing script fails",
    run: () => run(fixture((f) => { f[".claude/hooks/block-secrets.mjs"] = null; })), check: (r) => fails(r, "settings").some((x) => /\.claude\/hooks\/block-secrets\.mjs does not exist/.test(x.detail)) },
  { name: "invented hook event name fails",
    run: () => run(fixture((f) => { const s = JSON.parse(f[".claude/settings.json"]); s.hooks.PreCommit = []; f[".claude/settings.json"] = JSON.stringify(s); })), check: (r) => fails(r, "settings").some((x) => /unknown hook event "PreCommit"/.test(x.detail)) },
  { name: "agent frontmatter hook script that does not exist fails hook-paths",
    run: () => run(fixture((f) => { f["agents/tool-guard.mjs"] = null; })), check: (r) => fails(r, "hook-paths").some((x) => /agents\/tool-guard\.mjs does not exist/.test(x.detail)) },
  { name: "gates.settings.json without the Agent(developer) ask fails",
    run: () => run(fixture((f) => { f["workflows/gates.settings.json"] = JSON.stringify({ permissions: { ask: [] } }); })), check: (r) => fails(r, "gate-settings").length === 1 },
  { name: ".mcp.json entry with url but no type fails",
    run: () => run(fixture((f) => { f[".mcp.json"] = JSON.stringify({ mcpServers: { jira: { url: "https://example.com/mcp" } } }); })), check: (r) => fails(r, "mcp").some((x) => /jira: has url but no type/.test(x.detail)) },
  { name: "stdio MCP server whose script is missing fails",
    run: () => run(fixture((f) => { f["mcp/server.mjs"] = null; })), check: (r) => fails(r, "mcp").some((x) => /mcp\/server\.mjs does not exist/.test(x.detail)) },
  { name: "workflow step naming a non-roster agent fails",
    run: () => run(fixture((f) => { f["workflows/feature-delivery.md"] += "| 09 | `09-qa.md` | qa-bot | none | none |\n"; })), check: (r) => fails(r, "workflows").some((x) => /"qa-bot" is not a roster agent/.test(x.detail)) },
  { name: "workflow step naming a skill that does not exist fails",
    run: () => run(fixture((f) => { f["workflows/feature-delivery.md"] += "| 06 | `06-security.md` | security | `security-review` | none |\n"; })), check: (r) => fails(r, "workflows").some((x) => /skill security-review not in/.test(x.detail)) },
  { name: "unresolved CLAUDE.md @import fails; code-span @ is ignored",
    run: () => run(fixture((f) => { f["CLAUDE.md"] += "- Glossary: @context/glossary.md\n"; })), check: (r) => { const d = fails(r, "claude-md").map((x) => x.detail).join(" "); return /@context\/glossary\.md/.test(d) && !/someone/.test(d); } },
  { name: "skill script outside the agent's Bash guard fails guard-reach",
    run: () => run(fixture((f) => { f[".claude/skills/production-rca/SKILL.md"] += "Then `node .claude/skills/production-rca/scripts/render.mjs out.json`.\n"; })), check: (r) => fails(r, "guard-reach").some((x) => /production-rca\/scripts\/render\.mjs/.test(x.detail)) },
  { name: "invalid handoff in a committed example run fails (check-handoff.mjs spawned)",
    setup: true,
    check: (r) => fails(r, "handoffs").some((x) => /docs\/capstone\/example-runs\/bad/.test(x.detail)) },
  { name: "usage error exits 2",
    run: () => { const r = spawnSync(process.execPath, [script, "--bogus"], { encoding: "utf8" }); return { status: r.status, rows: [], stderr: r.stderr }; }, check: (r) => r.status === 2 && /unknown option/.test(r.stderr) },
  { name: "this repository: prints the table and exit code agrees with the FAIL rows",
    run: () => { const r = spawnSync(process.execPath, [script, "--no-spawn"], { encoding: "utf8", cwd: repo }); return { status: r.status, stdout: r.stdout }; },
    check: (r) => /^STATUS\s+CHECK\s+DETAIL/.test(r.stdout) && /verify-system: \d+ pass/.test(r.stdout) && (r.status === (/^FAIL /m.test(r.stdout) ? 1 : 0)) },
  { name: "this repository: all seven roster agents and their contracts are present",
    run: () => run(repo, ["--no-spawn"]), check: (r) => r.rows.filter((x) => x.check === "roster" && x.status === "PASS").length === 7 },
];

// The handoff case needs the real validator inside the fixture.
const realChecker = join(repo, ".claude", "hooks", "check-handoff.mjs");
let failed = 0;
for (const c of cases) {
  let res;
  if (c.setup) {
    const root = fixture((f) => { f["docs/capstone/example-runs/bad/01-incident-brief.md"] = HANDOFF.replace("status: complete", "status: done"); });
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    copyFileSync(realChecker, join(root, ".claude", "hooks", "check-handoff.mjs"));
    res = run(root);
    rmSync(root, { recursive: true, force: true });
  } else res = c.run();
  const ok = c.check(res);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${c.name}`);
  if (!ok) console.log((res.stdout || "").slice(0, 1500), res.stderr || "");
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
