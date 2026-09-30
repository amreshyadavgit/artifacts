// Unit and smoke tests for the eval harness (Frappe edition). Run from AI-SDLC-frappe/:
//   node --test evaluations/harness/test/
// No API key, no bench and no site are needed. The trap-evidence test reads the Frappe v15 source at
// FRAPPE_SRC (default /home/user/frappe-bench/apps/frappe) and is skipped when it is not there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentDefinitionFromMarkdown, citedLocations, findForbidden, parseFindingsTable, parseFrontmatter, scoreCase, SEVERITIES, verifyTrap,
} from "../scoring.mjs";
import { FRAPPE_SRC, ROOT, buildClaudeArgs, buildPrompt, lineCount, loadSuites, main, verifyAllTraps } from "../run-evals.mjs";

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const HARNESS = join(ROOT, "evaluations/harness/run-evals.mjs");

test("frontmatter: comma tools, block lists, nested maps reported", () => {
  const md = "---\nname: demo\ndescription: \"Demo agent\"\ntools: Read, Grep, Glob\nskills:\n  - code-review\nmaxTurns: 8\ncolor: blue\nhooks:\n  PreToolUse:\n    - matcher: Bash\n---\nBody line.\n";
  const { data, body, unsupported } = parseFrontmatter(md);
  assert.equal(data.name, "demo");
  assert.equal(data.maxTurns, 8);
  assert.deepEqual(data.skills, ["code-review"]);
  assert.equal(body.trim(), "Body line.");
  assert.ok(unsupported.includes("hooks"));
  const { definition, notes } = agentDefinitionFromMarkdown(md);
  assert.deepEqual(definition.tools, ["Read", "Grep", "Glob"]);
  assert.equal(definition.prompt, "Body line.");
  assert.equal(definition.hooks, undefined, "nested hooks are omitted, not guessed");
  assert.ok(notes.some((n) => n.startsWith("color:")), "color is not an --agents key");
});

test("architect-v1 snapshot converts to a valid --agents definition", () => {
  const { name, definition } = agentDefinitionFromMarkdown(read("evaluations/agent-versions/architect-v1.md"));
  assert.equal(name, "architect");
  assert.deepEqual(definition.tools, ["Read", "Grep", "Glob", "Write"]);
  assert.equal(definition.model, "sonnet");
  assert.match(definition.prompt, /^You are a senior Frappe architect/);
});

test("v2 agent files convert; nested hooks and color are reported, permissionMode is left to the harness", () => {
  for (const [file, name] of [[".claude/agents/architect.md", "architect"], [".claude/agents/reviewer.md", "reviewer"]]) {
    if (!existsSync(join(ROOT, file))) continue; // written by module 05; the replay tests do not need it
    const { name: n, definition, notes } = agentDefinitionFromMarkdown(read(file));
    assert.equal(n, name);
    assert.ok(definition.prompt.length > 500, `${file}: body becomes the prompt`);
    assert.ok(Array.isArray(definition.tools) && definition.tools.includes("Read"));
    assert.equal(definition.hooks, undefined, `${file}: nested hooks are omitted`);
    assert.ok(notes.some((x) => x.startsWith("hooks:")) && notes.some((x) => x.startsWith("color:")));
  }
  const v1 = "evaluations/agent-versions/reviewer-v1.md"; // frozen by module 02
  if (existsSync(join(ROOT, v1))) assert.equal(agentDefinitionFromMarkdown(read(v1)).name, "reviewer");
});

test("claude argv uses only documented flags and a circuit breaker above the budget", () => {
  const args = buildClaudeArgs({ prompt: "p", agentName: "architect", definition: { description: "d", prompt: "x" }, budget: { maxTurns: 12, maxCostUsd: 0.6 } });
  const flag = (f) => args[args.indexOf(f) + 1];
  assert.equal(args[0], "-p");
  assert.equal(flag("--output-format"), "json");
  assert.equal(flag("--permission-mode"), "plan");
  assert.equal(flag("--max-turns"), "18");
  assert.equal(flag("--max-budget-usd"), "1.2");
  assert.equal(flag("--agent"), "architect");
  assert.deepEqual(Object.keys(JSON.parse(flag("--agents"))), ["architect"]);
  const documented = new Set(["-p", "--output-format", "--agents", "--permission-mode", "--max-turns", "--max-budget-usd", "--agent"]);
  for (const a of args.filter((x) => x.startsWith("-"))) assert.ok(documented.has(a), `undocumented flag ${a}`);
  const delegate = buildClaudeArgs({ prompt: "p", agentName: "architect", definition: {}, budget: { maxTurns: 4, maxCostUsd: 0.1 }, invoke: "delegate" });
  assert.ok(!delegate.includes("--agent"));
  assert.match(delegate[1], /^Use the architect subagent/);
});

test("findings table: canonical header parsed, other headers rejected", () => {
  const ok = parseFindingsTable("| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| A1 | High | performance | `api/fhir.py:156` | `queue=\"short\"\\|\"long\"` | rec |");
  assert.equal(ok.hasTable, true);
  assert.equal(ok.rows[0].severity, "high");
  assert.equal(ok.rows[0].location, "api/fhir.py:156");
  assert.match(ok.rows[0].evidence, /short/, "an escaped pipe stays inside the cell");
  assert.equal(parseFindingsTable("| # | Finding |\n|---|---|\n| 1 | x |").hasTable, false);
});

test("forbidden claims: negation heuristic both ways, on Frappe traps", () => {
  const { globalForbiddenClaims: g } = loadSuites("architecture")[0];
  const getall = g.filter((x) => x.id === "G-GETALL");
  assert.equal(findForbidden("frappe.get_all respects the user's role permissions, so access is fine.", getall).hits.length, 1);
  assert.equal(findForbidden("frappe.get_all does not check permissions; use frappe.get_list.", getall).hits.length, 0);
  const dry = g.filter((x) => x.id === "G-DRYRUN");
  assert.equal(findForbidden("Rehearse with `bench --site ke.localhost migrate --dry-run` first.", dry).hits.length, 1);
  assert.equal(findForbidden("There is no `bench migrate --dry-run`; restore a backup to a scratch site instead.", dry).negated.length, 1);
  const hooks = g.filter((x) => x.id === "G-HOOKS");
  assert.equal(findForbidden("Register the job under scheduler_jobs in hooks.py.", hooks).hits.length, 1);
  assert.equal(findForbidden("Register it under scheduler_events (daily_long).", hooks).hits.length, 0);
  const cells = findForbidden("| ARC-1 | high | design | hooks.py:11 | `required_apps = []` | Add on_migrate = [...] to hooks.py |", hooks);
  assert.equal(cells.hits.length, 1, "table cells are separate clauses: a negation in one cell cannot hide a claim in another");
  const patch = [{ id: "P", claim: "skipped", patterns: ["already applied[^.\\n]{0,40}(won't run again)"] }];
  assert.equal(findForbidden("The patch is already applied, so it won't run again.", patch).hits.length, 1, "negation inside the pattern itself still counts as a claim");
});

test("trap evidence: verifyTrap passes a false claim and fails a true one", () => {
  const files = { "frappe/__init__.py": 'def get_all(doctype, *args, **kwargs):\n\tkwargs["ignore_permissions"] = True\n', "frappe/x.py": "def get_list(doctype):\n\tpass\n" };
  const io = { read: (_r, f) => files[f] ?? null, walk: () => Object.entries(files).map(([path, text]) => ({ path, text })), missingRoot: () => false };
  assert.equal(verifyTrap({ file: "frappe/__init__.py", present: 'kwargs\\["ignore_permissions"\\] = True' }, io).ok, true);
  assert.equal(verifyTrap({ dir: "frappe", absent: "\\bfrappe\\.orm\\b" }, io).ok, true);
  assert.equal(verifyTrap({ dir: "frappe", absent: "def get_list" }, io).ok, false, "an 'invented' API that exists is not a fair trap");
  assert.equal(verifyTrap({ file: "frappe/missing.py", present: "x" }, io).ok, false, "a typo in the evidence path fails, it does not pass silently");
});

test("trap evidence: every factual hallucination trap is false in the Frappe v15 source and the repo", { skip: !existsSync(join(FRAPPE_SRC, "frappe/__init__.py")) && `Frappe source not found at ${FRAPPE_SRC}` }, () => {
  const rows = verifyAllTraps(loadSuites());
  const bad = rows.filter((r) => r.status === "FAIL" || r.status === "unverified");
  assert.deepEqual(bad, [], JSON.stringify(bad, null, 1));
  assert.ok(rows.filter((r) => r.status === "ok").length >= 40);
  for (const id of ["G-ORM", "G-SQLA", "G-GETALL", "G-HOOKS", "G-DRYRUN", "G-ITC"]) assert.ok(rows.some((r) => r.key === `global/${id}` && r.status === "ok"), id);
});

test("grounding: a cited path:line must exist in the repo", () => {
  assert.deepEqual(citedLocations([{ id: "A", location: "sample-app/spice_lite/spice_lite/api/fhir.py:155-184, sample-app/spice_lite/spice_lite/hooks.py:11" }]).map((l) => l.line), [184, 11]);
  assert.equal(lineCount("sample-app/spice_lite/spice_lite/hooks.py") >= 37, true);
  assert.equal(lineCount("sample-app/spice_lite/spice_lite/tasks.py"), null);
  const sfx = { requiredSections: [], globalForbiddenClaims: [], checkLocations: true, lineCount };
  const bad = scoreCase({ ...kase }, { ...good, result: handoff("complete", "| A1 | high | performance | sample-app/spice_lite/spice_lite/hooks.py:52 | N+1 in lastN | Cap subjects |") }, sfx);
  assert.ok(bad.assertions.some((a) => a.name.startsWith("grounding") && !a.pass && /past the end/.test(a.detail)));
  const ok = scoreCase({ ...kase }, good, sfx);
  assert.ok(ok.assertions.find((a) => a.name.startsWith("grounding")).pass, "fhir.py:156 exists");
});

const handoff = (status, rows, extra = "") => `---\nrun_id: eval-T-1\nstep: 03\nagent: architect\nstatus: ${status}\ninputs: [sample-app/spice_lite/spice_lite/hooks.py]\nnext: developer\n---\n## Summary\nS. ${extra}\n\n## Findings\n| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n${rows}\n\n## Decisions\n- d\n\n## Open questions\n- q\n`;
const kase = {
  id: "T-1", title: "t", expectedStatus: ["complete"], minRecall: 0.75, budget: { maxTurns: 5, maxCostUsd: 0.2 },
  expectedFindings: [
    { id: "F1", concept: "N+1", match: [["N\\+1"], ["lastN"]], severity: ["high"] },
    { id: "F2", concept: "cap", match: [["cap"], ["subjects"]], severity: null },
  ],
  forbiddenClaims: [{ id: "C1", claim: "redis exists", patterns: ["existing Redis"] }],
};
const suite = { requiredSections: ["Summary", "Findings", "Decisions", "Open questions"], globalForbiddenClaims: [] };
const good = { is_error: false, subtype: "success", num_turns: 4, total_cost_usd: 0.1, duration_ms: 1000, permission_denials: [],
  result: handoff("complete", "| A1 | high | performance | sample-app/spice_lite/spice_lite/api/fhir.py:156 | N+1 in lastN | Cap subjects at 100 |") };

test("scoreCase: a correct handoff passes every assertion", () => {
  const r = scoreCase(kase, good, suite);
  assert.equal(r.pass, true, JSON.stringify(r.assertions.filter((a) => !a.pass)));
  assert.equal(r.metrics.recall, 1);
  assert.equal(r.metrics.precision, 1);
});

test("scoreCase: front matter keywords do not count toward recall", () => {
  const r = scoreCase({ ...kase, expectedFindings: [{ id: "F9", concept: "names hooks.py", match: [["hooks\\.py"]], severity: null }] }, good, suite);
  assert.equal(r.metrics.recall, 0);
});

test("scoreCase: each failure class is caught", () => {
  const fail = (patch, name) => {
    const r = scoreCase(kase, { ...good, ...patch }, suite);
    assert.equal(r.pass, false);
    assert.ok(r.assertions.some((a) => !a.pass && a.name.startsWith(name)), `${name} should fail`);
  };
  fail({ permission_denials: [{ tool_name: "Bash", tool_use_id: "t", tool_input: { command: "bench --site test.localhost run-tests --app spice_lite" } }] }, "permissions");
  fail({ num_turns: 9 }, "budget: turns");
  fail({ total_cost_usd: 0.5 }, "budget: cost");
  fail({ is_error: true, subtype: "error_max_turns" }, "run succeeded");
  fail({ result: handoff("complete", "| A1 | medium | performance | x:1 | N+1 in lastN | Cap subjects |") }, "severity");
  fail({ result: handoff("complete", "| A1 | high | performance | x:1 | N+1 in lastN | Cap subjects |", "Reuse the existing Redis cache.") }, "must-not-mention");
  fail({ result: handoff("blocked", "| A1 | high | performance | x:1 | N+1 in lastN | Cap subjects |") }, "status");
  fail({ result: handoff("complete", "| A1 | urgent | performance | x:1 | N+1 in lastN | Cap subjects |") }, "format: severity");
  fail({ result: good.result.replace(/^---[\s\S]*?---\n/, "") }, "format: handoff front matter");
});

test("datasets: 20 architecture and >= 8 reviewer cases, well-formed and grounded in real files", () => {
  const suites = loadSuites();
  const arch = suites.find((s) => s.name === "architecture");
  const rev = suites.find((s) => s.name === "reviewer");
  assert.equal(arch.cases.length, 20);
  assert.ok(rev.cases.length >= 8);
  for (const s of suites) {
    const ids = s.cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, "unique ids");
    for (const g of s.globalForbiddenClaims) for (const p of g.patterns) new RegExp(p, "i");
    for (const c of s.cases) {
      assert.ok(c.requirement && c.expectedFindings.length, `${c.id} needs a requirement and findings`);
      for (const f of c.contextFiles) assert.ok(existsSync(join(ROOT, f)), `${c.id}: context file missing: ${f}`);
      for (const f of c.mustNotExist ?? []) assert.ok(!existsSync(join(ROOT, f)), `${c.id}: ${f} must not exist (hallucination trap)`);
      for (const f of c.expectedFindings) {
        for (const g of f.match) for (const p of g) new RegExp(p, "i");
        for (const sev of f.severity ?? []) assert.ok(SEVERITIES.includes(sev), `${c.id}/${f.id}: bad severity ${sev}`);
      }
      for (const fc of c.forbiddenClaims) for (const p of fc.patterns) new RegExp(p, "i");
      assert.ok(!buildPrompt(s, c).includes("{{"), `${c.id}: unfilled template variable`);
    }
  }
});

test("reviewer diffs apply cleanly to sample-app/spice_lite", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
  for (const c of loadSuites("reviewer")[0].cases) {
    const p = spawnSync("git", ["apply", "--check", c.diff], { cwd: ROOT, encoding: "utf8" });
    assert.equal(p.status, 0, `${c.diff}: ${p.stderr}`);
  }
});

test("recordings: one synthetic recording and one judge recording per case and version", () => {
  for (const s of loadSuites()) for (const v of Object.keys(s.versions)) for (const c of s.cases) {
    const base = join(ROOT, "evaluations/recordings", `${s.agentName}-${v}`, c.id);
    const rec = JSON.parse(readFileSync(`${base}.json`, "utf8"));
    assert.equal(rec._synthetic, true, `${base}.json must be labelled synthetic`);
    assert.equal(typeof rec.result, "string");
    assert.ok(Array.isArray(rec.permission_denials));
    const j = JSON.parse(readFileSync(`${base}.judge.json`, "utf8"));
    assert.equal(j._synthetic, true);
    assert.deepEqual(Object.keys(j.structured_output.scores).sort(), ["actionability", "coverage", "grounding", "safety", "severity_calibration"]);
  }
});

test("replay smoke: v2 passes the gates, v1 fails them", () => {
  assert.equal(main(["--mode", "replay", "--no-write", "--quiet"]), 0);
  assert.equal(main(["--mode", "replay", "--version", "v1", "--no-write", "--quiet"]), 1);
  assert.equal(main(["--mode", "replay", "--case", "ARCH-06", "--no-write", "--quiet"]), 0, "--case selects across suites");
  assert.equal(main(["--mode", "replay", "--case", "ARCH-99", "--no-write", "--quiet"]), 2, "unknown case id is a usage error");
  assert.equal(main(["--mode", "bogus"]), 2);
});

test("compare is deterministic and matches the committed report", () => {
  const run = () => spawnSync(process.execPath, [HARNESS, "--mode", "replay", "--compare", "v1", "v2", "--judge", "--quiet", "--out-dir", "evaluations/reports/.tmp-test"], { cwd: ROOT, encoding: "utf8" });
  const p1 = run();
  assert.equal(p1.status, 0, p1.stderr);
  const first = read("evaluations/reports/.tmp-test/v1-vs-v2.json");
  run();
  assert.equal(read("evaluations/reports/.tmp-test/v1-vs-v2.json"), first, "same recordings, same report");
  const fresh = JSON.parse(first);
  assert.deepEqual(fresh.suites.map((s) => s.verdict), ["review", "review"]);
  assert.deepEqual(fresh.suites.find((s) => s.suite === "architecture").regressed, ["ARCH-08", "ARCH-13", "ARCH-16"]);
  assert.deepEqual(fresh.suites.find((s) => s.suite === "reviewer").regressed, ["REV-06"]);
  assert.equal(read("evaluations/reports/v1-vs-v2.json"), first, "committed report is stale: rerun --compare v1 v2 --judge");
  rmSync(join(ROOT, "evaluations/reports/.tmp-test"), { recursive: true, force: true });
});

test("live --dry-run prints the claude argv without calling claude", () => {
  const p = spawnSync(process.execPath, [HARNESS, "--mode", "live", "--suite", "architecture", "--version", "v1", "--case", "ARCH-17", "--dry-run", "--quiet"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  const line = JSON.parse(p.stdout.trim());
  assert.equal(line.case, "ARCH-17");
  assert.equal(line.command, "claude");
  const agents = JSON.parse(line.args[line.args.indexOf("--agents") + 1]);
  assert.match(agents.architect.prompt, /senior Frappe architect/);
  assert.match(line.args[1], /ARCH-17-ticket\.md/);
});

test("live --dry-run of the v2 architect forces plan mode and reports what it dropped", { skip: !existsSync(join(ROOT, ".claude/agents/architect.md")) }, () => {
  const p = spawnSync(process.execPath, [HARNESS, "--mode", "live", "--suite", "architecture", "--version", "v2", "--case", "ARCH-06", "--dry-run"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
  const { args } = JSON.parse(p.stdout.trim());
  const agents = JSON.parse(args[args.indexOf("--agents") + 1]);
  assert.equal(agents.architect.permissionMode, "plan");
  assert.deepEqual(agents.architect.skills, ["architecture-review"]);
  assert.match(p.stderr, /permissionMode: acceptEdits replaced by plan/);
  assert.match(p.stderr, /hooks: nested YAML not supported/);
});

test("live mode end to end against a stub claude on PATH (no API key needed)", { skip: process.platform === "win32" }, () => {
  const bin = mkdtempSync(join(tmpdir(), "stub-claude-"));
  const recording = join(ROOT, "evaluations/recordings/architect-v2/ARCH-06.json");
  const judge = join(ROOT, "evaluations/recordings/architect-v2/ARCH-06.judge.json");
  // The stub records its argv and replays a recording: the agent call gets ARCH-06, the judge call gets the judge file.
  writeFileSync(join(bin, "claude"), `#!${process.execPath}\nconst fs = require("fs");\nfs.appendFileSync(${JSON.stringify(join(bin, "argv.jsonl"))}, JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stdout.write(fs.readFileSync(process.argv.includes("--json-schema") ? ${JSON.stringify(judge)} : ${JSON.stringify(recording)}, "utf8"));\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const p = spawnSync(process.execPath, [HARNESS, "--mode", "live", "--suite", "architecture", "--case", "ARCH-06", "--version", "v1", "--judge", "--record", "tmp-live-test", "--out-dir", "evaluations/reports/.tmp-live", "--quiet"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const cleanup = () => {
    rmSync(join(ROOT, "evaluations/recordings/tmp-live-test"), { recursive: true, force: true });
    rmSync(join(ROOT, "evaluations/reports/.tmp-live"), { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  };
  try {
    assert.equal(p.status, 0, p.stderr); // the replayed ARCH-06 output passes, so the one-case run passes its gates
    const calls = readFileSync(join(bin, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls.length, 2, "one agent call and one judge call");
    assert.ok(calls[0].includes("--agents") && calls[0].includes("--agent"));
    assert.ok(calls[1].includes("--json-schema") && !calls[1].includes("--agents"));
    const rec = JSON.parse(read("evaluations/recordings/tmp-live-test/ARCH-06.json"));
    assert.equal(rec._synthetic, false);
    assert.equal(rec._agentFile, "evaluations/agent-versions/architect-v1.md");
    const report = JSON.parse(read("evaluations/reports/.tmp-live/live-v1.json"));
    assert.equal(report.runs[0].results[0].id, "ARCH-06");
    assert.equal(report.runs[0].results[0].judge.verdict, "pass");
    assert.match(report.runs[0].agentFileSha, /^[0-9a-f]{12}$/);
  } finally {
    cleanup();
  }
});
