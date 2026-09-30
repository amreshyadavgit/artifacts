// Unit and smoke tests for the eval harness. Run from AI-SDLC/:  node --test evaluations/harness/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentDefinitionFromMarkdown, findForbidden, parseFindingsTable, parseFrontmatter, scoreCase, SEVERITIES,
} from "../scoring.mjs";
import { ROOT, buildClaudeArgs, buildPrompt, loadSuites, main } from "../run-evals.mjs";

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
  assert.match(definition.prompt, /^You are a senior software architect/);
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
  const ok = parseFindingsTable("| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| A1 | High | performance | `x.java:1` | ev | rec |");
  assert.equal(ok.hasTable, true);
  assert.equal(ok.rows[0].severity, "high");
  assert.equal(ok.rows[0].location, "x.java:1");
  assert.equal(parseFindingsTable("| # | Finding |\n|---|---|\n| 1 | x |").hasTable, false);
});

test("forbidden claims: negation heuristic both ways", () => {
  const hapi = [{ id: "H", claim: "uses HAPI", patterns: ["\\b(uses|built on) (the )?HAPI"] }];
  assert.equal(findForbidden("The service is built on HAPI FHIR structures.", hapi).hits.length, 1);
  assert.equal(findForbidden("The app never uses HAPI FHIR (ADR-0001).", hapi).hits.length, 0);
  const batch = [{ id: "B", claim: "batch", patterns: ["Spring Batch[^.\\n]{0,40}\\b(already|on the classpath)\\b"] }];
  assert.equal(findForbidden("Spring Batch is not on the classpath.", batch).negated.length, 1);
  const ts = [{ id: "T", claim: "thread safety", patterns: ["static final[^.\\n]{0,40}(not thread-safe)"] }];
  assert.equal(findForbidden("`PATIENT_PREFIX` static final String is not thread-safe.", ts).hits.length, 1, "negation inside the pattern itself still counts as a claim");
});

const handoff = (status, rows, extra = "") => `---\nrun_id: eval-T-1\nstep: 03\nagent: architect\nstatus: ${status}\ninputs: [SecurityConfig.java]\nnext: developer\n---\n## Summary\nS. ${extra}\n\n## Findings\n| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n${rows}\n\n## Decisions\n- d\n\n## Open questions\n- q\n`;
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
  result: handoff("complete", "| A1 | high | performance | ObservationService.java:69 | N+1 in lastN | Cap subjects at 100 |") };

test("scoreCase: a correct handoff passes every assertion", () => {
  const r = scoreCase(kase, good, suite);
  assert.equal(r.pass, true, JSON.stringify(r.assertions.filter((a) => !a.pass)));
  assert.equal(r.metrics.recall, 1);
  assert.equal(r.metrics.precision, 1);
});

test("scoreCase: front matter keywords do not count toward recall", () => {
  const r = scoreCase({ ...kase, expectedFindings: [{ id: "F9", concept: "names SecurityConfig", match: [["SecurityConfig"]], severity: null }] }, good, suite);
  assert.equal(r.metrics.recall, 0);
});

test("scoreCase: each failure class is caught", () => {
  const fail = (patch, name) => {
    const r = scoreCase(kase, { ...good, ...patch }, suite);
    assert.equal(r.pass, false);
    assert.ok(r.assertions.some((a) => !a.pass && a.name.startsWith(name)), `${name} should fail`);
  };
  fail({ permission_denials: [{ tool_name: "Write", tool_use_id: "t", tool_input: { file_path: "docs/adr/x.md" } }] }, "permissions");
  fail({ num_turns: 9 }, "budget: turns");
  fail({ total_cost_usd: 0.5 }, "budget: cost");
  fail({ is_error: true, subtype: "error_max_turns" }, "run succeeded");
  fail({ result: handoff("complete", "| A1 | medium | performance | x:1 | N+1 in lastN | Cap subjects |") }, "severity");
  fail({ result: handoff("complete", "| A1 | high | performance | x:1 | N+1 in lastN | Cap subjects |", "Reuse the existing Redis cache.") }, "must-not-mention");
  fail({ result: handoff("blocked", "| A1 | high | performance | x:1 | N+1 in lastN | Cap subjects |") }, "status");
  fail({ result: handoff("complete", "| A1 | urgent | performance | x:1 | N+1 in lastN | Cap subjects |") }, "format: severity");
  fail({ result: good.result.replace(/^---[\s\S]*?---\n/, "") }, "format: handoff front matter");
});

test("datasets: 20 architecture and >= 6 reviewer cases, well-formed and grounded in real files", () => {
  const suites = loadSuites();
  const arch = suites.find((s) => s.name === "architecture");
  const rev = suites.find((s) => s.name === "reviewer");
  assert.equal(arch.cases.length, 20);
  assert.ok(rev.cases.length >= 6);
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

test("reviewer diffs apply cleanly to sample-app", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
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
  assert.deepEqual(fresh.suites.find((s) => s.suite === "architecture").regressed, ["ARCH-13", "ARCH-16"]);
  assert.deepEqual(fresh.suites.find((s) => s.suite === "reviewer").regressed, ["REV-07"]);
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
  assert.match(agents.architect.prompt, /senior software architect/);
  assert.match(line.args[1], /ARCH-17-ticket\.md/);
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
