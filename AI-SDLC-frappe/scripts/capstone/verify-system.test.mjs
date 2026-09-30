#!/usr/bin/env node
// Tests for verify-system.mjs (Frappe edition). Usage (from AI-SDLC-frappe/): node scripts/capstone/verify-system.test.mjs
// Builds a minimal, correctly wired project (roster, skills, settings, a tiny Frappe app, a fake bench) in a temp
// dir, breaks one seam per case, and runs the checker as a subprocess with --root and --json. The real
// agents/tool-guard.mjs and .claude/hooks/check-handoff.mjs are copied into the fixture, so guard-reach and
// handoffs are judged by the same code the Claude Code hooks run. The last cases run against this repository.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "verify-system.mjs");
const repo = join(here, "..", "..");
const SPECIALISTS = ["architect", "developer", "reviewer", "tester", "security", "sre"];
const APP = "sample-app/spice_lite/spice_lite";
const SRE_GUARD = "'git log' 'node .claude/skills/production-rca/scripts/** ...'";

function agentFile(name, { tools, skills = [], hooks = "" } = {}) {
  const t = tools ?? (name === "orchestrator" ? "Agent(architect, developer, reviewer, tester, security, sre), Read, Write, Grep, Glob" : "Read, Grep, Glob");
  const sk = skills.length ? `skills:\n${skills.map((s) => `  - ${s}`).join("\n")}\n` : "";
  const body = name === "orchestrator" ? "Follow `workflows/feature-delivery.md`." : "Write handoffs to .ai-sdlc/runs/ with status.";
  return `---\nname: ${name}\ndescription: ${name} agent for the fixture\ntools: ${t}\n${sk}${hooks}---\n\n${body}\n`;
}
const guardHook = (entries) => `hooks:\n  PreToolUse:\n    - matcher: "Bash"\n      hooks:\n        - type: command\n          command: "node \\"\${CLAUDE_PROJECT_DIR}/agents/tool-guard.mjs\\" bash-allow ${entries}"\n`;

function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "verify-system-frappe-"));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const f = {};
  for (const a of [...SPECIALISTS, "orchestrator"]) {
    f[`.claude/agents/${a}.md`] = agentFile(a, a === "tester" ? { skills: ["test-strategy"] } : {});
    f[`agents/${a}/CONTRACT.md`] = `# ${a} contract\n`;
  }
  f[".claude/agents/sre.md"] = agentFile("sre", { tools: "Read, Grep, Glob, Bash", skills: ["production-rca"], hooks: guardHook(SRE_GUARD) });
  f[".claude/skills/test-strategy/SKILL.md"] = "---\nname: test-strategy\ndescription: plan tests\n---\nPlan.\n";
  f[".claude/skills/production-rca/SKILL.md"] = "---\nname: production-rca\ndescription: rca\nallowed-tools: Read Bash(node ${CLAUDE_SKILL_DIR}/scripts/build-timeline.mjs *) Bash(git log *)\n---\nRun:\n\n```bash\nnode ${CLAUDE_SKILL_DIR}/scripts/build-timeline.mjs $0/*.log --collapse\n```\n";
  f[".claude/skills/production-rca/scripts/build-timeline.mjs"] = "console.log('ok');\n";
  f[".claude/hooks/block-secrets.mjs"] = "process.exit(0);\n";
  f[".claude/settings.json"] = JSON.stringify({
    permissions: {
      allow: ["Bash(bench --site test.localhost run-tests *)", "Bash(git diff *)"],
      ask: ["Bash(bench --site * migrate)", "Bash(git push *)"],
      deny: ["Read(**/site_config.json)", "Read(**/common_site_config.json)", "Bash(bench drop-site *)", "Bash(bench --site * reinstall *)", "mcp__github__merge_pull_request"],
    },
    hooks: { PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-secrets.mjs"' }] }] },
  }, null, 2);
  f["workflows/gates.settings.json"] = JSON.stringify({ permissions: { ask: ["Agent(developer)"] } });
  f["workflows/feature-delivery.md"] = "# Feature\n\n| step | file | agent | skill | gate |\n|---|---|---|---|---|\n| 01 | `01-requirements.md` | orchestrator | none | none |\n| 02 | `02-architect.md` | architect | none | none |\n| 05 | `05-tester.md` | tester | `test-strategy` | parallel |\n| G | none | human | none | gate |\n";
  f[".mcp.json"] = JSON.stringify({ mcpServers: {
    github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
    "spice-site": { type: "stdio", command: "node", args: ["${CLAUDE_PROJECT_DIR:-.}/mcp/server.mjs"] },
  } });
  f["mcp/server.mjs"] = "// server\n";
  f["context/overview.md"] = "# Overview\n";
  f["CLAUDE.md"] = "# Fixture\n\n- Default bench: `/opt/fixture-bench`, site `test.localhost`.\n- Architecture: @context/overview.md\n- Contact `@someone` in a code span is not an import.\n- Specs live in `workflows/`.\n";
  // a tiny Frappe app in the standard layout
  f["sample-app/spice_lite/pyproject.toml"] = "[project]\nname = \"spice_lite\"\n";
  f[`${APP}/__init__.py`] = "__version__ = \"0.1.0\"\n";
  f[`${APP}/hooks.py`] = "app_name = \"spice_lite\"\nrequired_apps = []\nafter_install = \"spice_lite.install.after_install\"\n# before_tests = \"spice_lite.install.before_tests\"\n";
  f[`${APP}/install.py`] = "def after_install():\n    pass\n";
  f[`${APP}/modules.txt`] = "Clinical\n";
  f[`${APP}/patches.txt`] = "[pre_model_sync]\n# comment\n\n[post_model_sync]\nspice_lite.patches.v0_1.backfill\nexecute:frappe.db.set_default(\"x\", 1)\n";
  f[`${APP}/patches/__init__.py`] = "";
  f[`${APP}/patches/v0_1/__init__.py`] = "";
  f[`${APP}/patches/v0_1/backfill.py`] = "import frappe\n\n\ndef execute():\n    pass\n";
  f[`${APP}/clinical/__init__.py`] = "";
  f[`${APP}/clinical/doctype/__init__.py`] = "";
  f[`${APP}/clinical/doctype/sl_patient/__init__.py`] = "";
  f[`${APP}/clinical/doctype/sl_patient/sl_patient.json`] = JSON.stringify({ doctype: "DocType", name: "SL Patient", module: "Clinical", fields: [] });
  f[`${APP}/clinical/doctype/sl_patient/sl_patient.py`] = "from frappe.model.document import Document\n\n\nclass SLPatient(Document):\n    pass\n";
  f[`${APP}/clinical/doctype/sl_patient/test_sl_patient.py`] = "from frappe.tests.utils import FrappeTestCase\n\n\nclass TestSLPatient(FrappeTestCase):\n    pass\n";
  mutate(f, root);
  for (const [rel, text] of Object.entries(f)) if (text !== null) w(rel, text);
  // the real guard, so guard-reach uses the same checkBash the PreToolUse hook runs
  mkdirSync(join(root, "agents"), { recursive: true });
  if (f["agents/tool-guard.mjs"] !== null) copyFileSync(join(repo, "agents", "tool-guard.mjs"), join(root, "agents", "tool-guard.mjs"));
  return root;
}

function fakeBench(root, { listed = ["frappe", "spice_lite"], appsTxt = true } = {}) {
  const b = join(root, "..", `${root.split("/").pop()}-bench`);
  mkdirSync(join(b, "sites", "test.localhost"), { recursive: true });
  mkdirSync(join(b, "apps"), { recursive: true });
  symlinkSync(join(root, "sample-app", "spice_lite"), join(b, "apps", "spice_lite"));
  writeFileSync(join(b, "sites", "apps.txt"), appsTxt ? "frappe\nspice_lite\n" : "frappe\n");
  const bin = join(b, "fake-bench.sh");
  writeFileSync(bin, `#!/bin/sh\n[ "$1 $2 $3" = "--site test.localhost list-apps" ] || { echo "unexpected: $*" >&2; exit 3; }\n${listed.map((a) => `echo "${a.padEnd(10)} 0.1.0 main"`).join("\n")}\n`);
  chmodSync(bin, 0o755);
  return { b, bin };
}

function run(root, extra = []) {
  const r = spawnSync(process.execPath, [script, "--root", root, "--json", ...extra], { encoding: "utf8" });
  let rows = [];
  try { rows = JSON.parse(r.stdout).rows; } catch { /* usage errors print no JSON */ }
  return { status: r.status, rows, stdout: r.stdout, stderr: r.stderr };
}
const by = (res, status, check) => res.rows.filter((r) => r.status === status && (!check || r.check === check));
const fails = (res, check) => by(res, "FAIL", check);
const has = (res, status, check, re) => by(res, status, check).some((x) => re.test(x.detail));

const HANDOFF = `---\nrun_id: 2026-09-22-inc-fixture\nstep: 01\nagent: orchestrator\nstatus: complete\ninputs: [incident:INC-1]\nnext: sre\n---\n## Summary\nx\n\n## Findings\nNo findings.\n\n## Decisions\n- x\n\n## Open questions\nNone.\n\n## Artifacts\n- x\n`;
const cleanup = [];
const fx = (m) => { const r = fixture(m); cleanup.push(r); return r; };

const cases = [
  { name: "correctly wired fixture: exit 0, no FAIL, Frappe rows PASS",
    run: () => run(fx()), check: (r) => r.status === 0 && fails(r).length === 0 && ["app-layout", "hooks-py", "modules", "patches", "doctypes", "bench-rules", "guard-reach"].every((c) => by(r, "PASS", c).length) },
  { name: "missing Agent Contract fails roster",
    run: () => run(fx((f) => { f["agents/reviewer/CONTRACT.md"] = null; })), check: (r) => r.status === 1 && has(r, "FAIL", "roster", /reviewer: agents\/reviewer\/CONTRACT.md missing/) },
  { name: "agent file whose name does not match fails roster",
    run: () => run(fx((f) => { f[".claude/agents/tester.md"] = f[".claude/agents/tester.md"].replace("name: tester", "name: qa"); })), check: (r) => has(r, "FAIL", "roster", /tester: name is "qa"/) },
  { name: "preloaded skill that does not exist fails agent-skills",
    run: () => run(fx((f) => { f[".claude/skills/test-strategy/SKILL.md"] = null; })), check: (r) => has(r, "FAIL", "agent-skills", /tester: test-strategy \(no/) },
  { name: "preloaded skill with disable-model-invocation: true fails agent-skills",
    run: () => run(fx((f) => { f[".claude/skills/test-strategy/SKILL.md"] = "---\nname: test-strategy\ndisable-model-invocation: true\n---\nx\n"; })), check: (r) => has(r, "FAIL", "agent-skills", /cannot be preloaded/) },
  { name: "specialist that lists Agent fails delegation",
    run: () => run(fx((f) => { f[".claude/agents/reviewer.md"] = agentFile("reviewer", { tools: "Read, Agent" }); })), check: (r) => has(r, "FAIL", "delegation", /reviewer/) },
  { name: "orchestrator Agent(...) list missing sre fails delegation",
    run: () => run(fx((f) => { f[".claude/agents/orchestrator.md"] = agentFile("orchestrator", { tools: "Agent(architect, developer, reviewer, tester, security), Read" }); })), check: (r) => has(r, "FAIL", "delegation", /missing \[sre\]/) },
  { name: "orchestrator with Bash fails delegation (it must never run bench)",
    run: () => run(fx((f) => { f[".claude/agents/orchestrator.md"] = agentFile("orchestrator", { tools: "Agent(architect, developer, reviewer, tester, security, sre), Read, Bash" }); })), check: (r) => has(r, "FAIL", "delegation", /orchestrator lists Bash/) },
  { name: "settings.json that is not JSON fails",
    run: () => run(fx((f) => { f[".claude/settings.json"] = "{ permissions: }"; })), check: (r) => has(r, "FAIL", "settings", /not valid JSON/) },
  { name: "settings hook pointing at a missing script fails",
    run: () => run(fx((f) => { f[".claude/hooks/block-secrets.mjs"] = null; })), check: (r) => has(r, "FAIL", "settings", /\.claude\/hooks\/block-secrets\.mjs does not exist/) },
  { name: "invented hook event PreCommit fails settings",
    run: () => run(fx((f) => { const s = JSON.parse(f[".claude/settings.json"]); s.hooks.PreCommit = []; f[".claude/settings.json"] = JSON.stringify(s); })), check: (r) => has(r, "FAIL", "settings", /unknown hook event "PreCommit"/) },
  { name: "no deny rule for common_site_config.json fails bench-rules",
    run: () => run(fx((f) => { const s = JSON.parse(f[".claude/settings.json"]); s.permissions.deny = s.permissions.deny.filter((x) => !x.includes("common_site_config")); f[".claude/settings.json"] = JSON.stringify(s); })), check: (r) => has(r, "FAIL", "bench-rules", /common_site_config\.json/) },
  { name: "an allow rule for bench console fails bench-rules",
    run: () => run(fx((f) => { const s = JSON.parse(f[".claude/settings.json"]); s.permissions.allow.push("Bash(bench --site * console)"); f[".claude/settings.json"] = JSON.stringify(s); })), check: (r) => has(r, "FAIL", "bench-rules", /console/) },
  { name: "agent frontmatter hook script that does not exist fails hook-paths",
    run: () => run(fx((f) => { f["agents/tool-guard.mjs"] = null; })), check: (r) => has(r, "FAIL", "hook-paths", /agents\/tool-guard\.mjs does not exist/) },
  { name: "gates.settings.json without the Agent(developer) ask fails",
    run: () => run(fx((f) => { f["workflows/gates.settings.json"] = JSON.stringify({ permissions: { ask: [] } }); })), check: (r) => fails(r, "gate-settings").length === 1 },
  { name: ".mcp.json entry with url but no type fails",
    run: () => run(fx((f) => { f[".mcp.json"] = JSON.stringify({ mcpServers: { jira: { url: "https://example.com/mcp" } } }); })), check: (r) => has(r, "FAIL", "mcp", /jira: has url but no type/) },
  { name: "stdio MCP server whose script is missing fails",
    run: () => run(fx((f) => { f["mcp/server.mjs"] = null; })), check: (r) => has(r, "FAIL", "mcp", /mcp\/server\.mjs does not exist/) },
  { name: "workflow step naming a non-roster agent fails",
    run: () => run(fx((f) => { f["workflows/feature-delivery.md"] += "| 09 | `09-qa.md` | qa-bot | none | none |\n"; })), check: (r) => has(r, "FAIL", "workflows", /"qa-bot" is not a roster agent/) },
  { name: "workflow step naming a skill that does not exist fails",
    run: () => run(fx((f) => { f["workflows/feature-delivery.md"] += "| 06 | `06-security.md` | security | `security-review` | none |\n"; })), check: (r) => has(r, "FAIL", "workflows", /skill security-review not in/) },
  { name: "unresolved CLAUDE.md @import fails; a code-span @ is ignored",
    run: () => run(fx((f) => { f["CLAUDE.md"] += "- Glossary: @context/glossary.md\n"; })), check: (r) => { const d = fails(r, "claude-md").map((x) => x.detail).join(" "); return /@context\/glossary\.md/.test(d) && !/someone/.test(d); } },
  { name: "skill script outside the sre's Bash guard fails guard-reach (real tool-guard.mjs)",
    run: () => run(fx((f) => { f[".claude/agents/sre.md"] = agentFile("sre", { tools: "Read, Grep, Glob, Bash", skills: ["production-rca"], hooks: guardHook("'git log' 'node .claude/skills/performance-review/scripts/** ...'") }); })),
    check: (r) => has(r, "FAIL", "guard-reach", /sre: preloaded skill production-rca runs scripts\/build-timeline\.mjs but the agent's Bash guard blocks it/) },
  { name: "skill allowed-tools rule the agent's guard blocks is a WARN, not a FAIL",
    run: () => run(fx((f) => { f[".claude/skills/production-rca/SKILL.md"] = f[".claude/skills/production-rca/SKILL.md"].replace("Bash(git log *)", "Bash(git log *) Bash(bench --site test.localhost run-tests *)"); })),
    check: (r) => r.status === 0 && has(r, "WARN", "guard-reach", /pre-approves Bash\(bench --site test\.localhost run-tests \*\) but sre's guard blocks/) },
  { name: "missing modules.txt fails app-layout; hooks.py app_name mismatch fails",
    run: () => ({ a: run(fx((f) => { f[`${APP}/modules.txt`] = null; })), b: run(fx((f) => { f[`${APP}/hooks.py`] = f[`${APP}/hooks.py`].replace('app_name = "spice_lite"', 'app_name = "spice"'); })) }),
    check: (r) => has(r.a, "FAIL", "app-layout", /missing spice_lite\/modules\.txt/) && has(r.b, "FAIL", "app-layout", /app_name is "spice"/) },
  { name: "hooks.py dotted path to a missing function fails hooks-py; commented lines are ignored",
    run: () => run(fx((f) => { f[`${APP}/install.py`] = "def install():\n    pass\n"; })),
    check: (r) => has(r, "FAIL", "hooks-py", /spice_lite\.install\.after_install \(spice_lite\/install\.py has no def after_install\)/) && !fails(r, "hooks-py").some((x) => /before_tests/.test(x.detail)) },
  { name: "modules.txt line without a package fails modules",
    run: () => run(fx((f) => { f[`${APP}/modules.txt`] = "Clinical\nBilling\n"; })), check: (r) => has(r, "FAIL", "modules", /"Billing" -> .*billing\/__init__\.py missing/) },
  { name: "patches.txt entry without a module, and one without def execute, fail patches",
    run: () => run(fx((f) => { f[`${APP}/patches.txt`] += "spice_lite.patches.v0_2.gone\nspice_lite.patches.v0_1.noexec\n"; f[`${APP}/patches/v0_1/noexec.py`] = "def run():\n    pass\n"; })),
    check: (r) => has(r, "FAIL", "patches", /v0_2\.gone \(no module/) && has(r, "FAIL", "patches", /noexec\.py has no def execute/) },
  { name: "DocType folder without its test file, or with the wrong class, fails doctypes",
    run: () => ({ a: run(fx((f) => { f[`${APP}/clinical/doctype/sl_patient/test_sl_patient.py`] = null; })), b: run(fx((f) => { f[`${APP}/clinical/doctype/sl_patient/sl_patient.py`] = "class Patient(Document):\n    pass\n"; })) }),
    check: (r) => has(r.a, "FAIL", "doctypes", /sl_patient: missing test_sl_patient\.py/) && has(r.b, "FAIL", "doctypes", /no class SLPatient/) },
  { name: "invalid handoff in a committed example run fails (check-handoff.mjs spawned)",
    run: () => {
      const root = fx((f) => { f["docs/capstone/example-runs/bad/01-incident-brief.md"] = HANDOFF.replace("status: complete", "status: done"); });
      mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
      mkdirSync(join(root, "workflows", "composition"), { recursive: true });
      copyFileSync(join(repo, ".claude", "hooks", "check-handoff.mjs"), join(root, ".claude", "hooks", "check-handoff.mjs"));
      copyFileSync(join(repo, "workflows", "composition", "security-scope.mjs"), join(root, "workflows", "composition", "security-scope.mjs"));
      return run(root);
    },
    check: (r) => has(r, "FAIL", "handoffs", /docs\/capstone\/example-runs\/bad/) },
  { name: "--bench with a bench that lists spice_lite passes; CLAUDE.md naming another bench warns",
    run: () => { const root = fx(); const { b, bin } = fakeBench(root); cleanup.push(b); return run(root, ["--bench", b, "--bench-bin", bin, "--no-lock"]); },
    check: (r) => r.status === 0 && has(r, "PASS", "bench", /apps\/spice_lite -> sample-app\/spice_lite; .*list-apps.*: frappe, spice_lite/) && has(r, "WARN", "bench", /CLAUDE\.md names bench \/opt\/fixture-bench/) },
  { name: "--bench where the site does not have spice_lite installed fails bench",
    run: () => { const root = fx(); const { b, bin } = fakeBench(root, { listed: ["frappe"] }); cleanup.push(b); return run(root, ["--bench", b, "--bench-bin", bin, "--no-lock"]); },
    check: (r) => r.status === 1 && has(r, "FAIL", "bench", /missing spice_lite/) },
  { name: "--bench with spice_lite missing from sites/apps.txt fails without calling bench",
    run: () => { const root = fx(); const { b, bin } = fakeBench(root, { appsTxt: false }); cleanup.push(b); return run(root, ["--bench", b, "--bench-bin", bin, "--no-lock"]); },
    check: (r) => has(r, "FAIL", "bench", /sites\/apps\.txt does not list spice_lite/) && !has(r, "FAIL", "bench", /list-apps/) },
  { name: "usage errors exit 2 (unknown option; --site without --bench)",
    run: () => [spawnSync(process.execPath, [script, "--bogus"], { encoding: "utf8" }), spawnSync(process.execPath, [script, "--site", "x.localhost"], { encoding: "utf8" })],
    check: (r) => r[0].status === 2 && /unknown option/.test(r[0].stderr) && r[1].status === 2 && /need --bench/.test(r[1].stderr) },
  { name: "this repository: prints the table and the exit code agrees with the FAIL rows",
    run: () => { const r = spawnSync(process.execPath, [script, "--no-spawn"], { encoding: "utf8", cwd: repo }); return { status: r.status, stdout: r.stdout }; },
    check: (r) => /^STATUS\s+CHECK\s+DETAIL/.test(r.stdout) && /verify-system: \d+ pass/.test(r.stdout) && r.status === (/^FAIL /m.test(r.stdout) ? 1 : 0) },
  { name: "this repository: 7 roster agents with contracts, and the spice_lite app layout, DocTypes and patches resolve",
    run: () => run(repo, ["--no-spawn"]),
    check: (r) => by(r, "PASS", "roster").length === 7 && ["app-layout", "hooks-py", "modules", "patches", "doctypes"].every((c) => by(r, "PASS", c).length === 1) },
];

let failed = 0;
for (const c of cases) {
  let res, ok;
  try { res = c.run(); ok = c.check(res); } catch (e) { ok = false; res = { stdout: String(e.stack) }; }
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${c.name}`);
  if (!ok) console.log(JSON.stringify(res, null, 1).slice(0, 2500));
}
for (const d of cleanup) rmSync(d, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
