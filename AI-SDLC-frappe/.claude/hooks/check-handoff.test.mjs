#!/usr/bin/env node
// Tests for check-handoff.mjs (Frappe edition). Usage (from AI-SDLC-frappe/): node .claude/hooks/check-handoff.test.mjs
// Runs the hook as a real subprocess with SubagentStop payloads, exactly as Claude Code would.
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "check-handoff.mjs");
const examples = join(here, "..", "..", "workflows", "examples", "feature-observation-code-vocabulary");
const RUN = "2026-09-30-feat-observation-code-vocabulary";

const project = mkdtempSync(join(tmpdir(), "check-handoff-"));
const runDir = join(project, ".ai-sdlc", "runs", RUN);
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, "01-requirements.md"), "placeholder input file for existence checks\n");
writeFileSync(join(runDir, "04-developer.md"), "placeholder input file for existence checks\n");

function handoff({ runId = RUN, step = "08", agent = "reviewer", status = "complete", inputs = "[04-developer.md]", next = "human", findings, questions = "None." } = {}) {
  return `---
run_id: ${runId}
step: ${step}
agent: ${agent}
status: ${status}        # complete | blocked | needs-human
inputs: ${inputs}
next: ${next}
---
## Summary
Reviewed the vocabulary diff: DocType JSON, controller, patch, fixture and hooks.py together.

## Findings
${findings ?? `| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-1 | low | standards | sample-app/spice_lite/spice_lite/hooks.py:28 | \`fixtures = [{"dt": "SL Observation Code"}]\` | Filter the fixture export to the shipped codes. |`}

## Decisions
- No blocking findings.

## Open questions
${questions}

## Artifacts
- none (read-only review)
`;
}

function hookRun(payload, { active, dir = project } = {}) {
  mkdirSync(join(dir, ".ai-sdlc", "runs"), { recursive: true });
  if (active === undefined) rmSync(join(dir, ".ai-sdlc", "runs", ".active"), { force: true });
  else writeFileSync(join(dir, ".ai-sdlc", "runs", ".active"), active + "\n");
  const input = JSON.stringify({
    session_id: "test-session", transcript_path: "/tmp/t.jsonl", cwd: dir, permission_mode: "default",
    hook_event_name: "SubagentStop", stop_hook_active: false, agent_id: "a1b2c3", agent_type: payload.agent_type,
    agent_transcript_path: "/tmp/agent-a1b2c3.jsonl", last_assistant_message: payload.message,
  });
  return spawnSync(process.execPath, [hook], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
}

const PASSING = "bench --site test.localhost run-tests --app spice_lite:\n\n```text\nRan 53 tests in 3.304s\n\nOK\n```";
const devHandoff = (o = {}) => handoff({ step: "06", agent: "developer", inputs: "[04-developer.md]", next: "reviewer", findings: "No findings.", ...o })
  .replace("## Findings", (o.summary ?? PASSING) + "\n\n## Findings");

/** A git project with a committed spice_lite skeleton, then one working-tree change. */
function gitProject(change) {
  const dir = mkdtempSync(join(tmpdir(), "check-handoff-git-"));
  const app = join(dir, "sample-app", "spice_lite", "spice_lite");
  mkdirSync(join(app, "clinical", "doctype", "sl_encounter"), { recursive: true });
  writeFileSync(join(app, "hooks.py"), 'app_name = "spice_lite"\nrequired_apps = []\n');
  writeFileSync(join(app, "clinical", "doctype", "sl_encounter", "sl_encounter.py"), "class SLEncounter:\n\tpass\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
  change(app);
  mkdirSync(join(dir, ".ai-sdlc", "runs", RUN), { recursive: true });
  writeFileSync(join(dir, ".ai-sdlc", "runs", RUN, "04-developer.md"), "placeholder input file for existence checks\n");
  return dir;
}
const scopeFile = (dir) => join(dir, ".ai-sdlc", "runs", RUN, "security-scope.txt");

const cases = [
  { name: "CLI: every example handoff in workflows/examples/feature-observation-code-vocabulary is valid",
    run: () => spawnSync(process.execPath, [hook, examples], { encoding: "utf8" }), expect: 0 },
  { name: "built-in Explore subagent is ignored",
    run: () => hookRun({ agent_type: "Explore", message: "Found 3 files." }, { active: RUN }), expect: 0 },
  { name: "valid inline reviewer handoff passes",
    run: () => hookRun({ agent_type: "reviewer", message: "Review done.\n\n" + handoff() }, { active: RUN }), expect: 0 },
  { name: "inline handoff wrapped in a markdown fence passes",
    run: () => hookRun({ agent_type: "reviewer", message: "```markdown\n" + handoff() + "```" }, { active: RUN }), expect: 0 },
  { name: "roster agent outside a workflow run (no .active marker) passes without a handoff",
    run: () => hookRun({ agent_type: "reviewer", message: "Looks fine to me." }), expect: 0 },
  { name: ".active marker set to none counts as no active run",
    run: () => hookRun({ agent_type: "reviewer", message: "Looks fine to me." }, { active: "none" }), expect: 0 },
  { name: "active run but no handoff in the final message is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: "I reviewed the diff and it looks fine." }, { active: RUN }), expect: 2, stderr: /no handoff found/ },
  { name: "invalid status value is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ status: "done" }) }, { active: RUN }), expect: 2, stderr: /status "done"/ },
  { name: "agent field that does not match agent_type is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ agent: "developer" }) }, { active: RUN }), expect: 2, stderr: /does not match the subagent/ },
  { name: "severity outside critical|high|medium|low|info is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ findings: "| id | severity | category | location | evidence | recommendation |\n|---|---|---|---|---|---|\n| CR-1 | blocker | correctness | a.java:1 | x | y |" }) }, { active: RUN }), expect: 2, stderr: /severity "blocker"/ },
  { name: "findings table without the evidence column is blocked",
    run: () => hookRun({ agent_type: "security", message: handoff({ agent: "security", findings: "| id | severity | category | location | recommendation |\n|---|---|---|---|---|\n| SEC-1 | medium | security | a.java:1 | cap it |" }) }, { active: RUN }), expect: 2, stderr: /missing column\(s\): evidence/ },
  { name: "input that does not exist in the run folder is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ inputs: "[07-developer.md]" }) }, { active: RUN }), expect: 2, stderr: /07-developer.md" does not exist/ },
  { name: "needs-human without open questions is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ status: "needs-human" }) }, { active: RUN }), expect: 2, stderr: /requires at least one concrete item/ },
  { name: "missing section is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff().replace("## Decisions\n- No blocking findings.\n\n", "") }, { active: RUN }), expect: 2, stderr: /## Decisions" is missing/ },
  { name: "malformed run_id is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ runId: "pagination-run" }) }, { active: RUN }), expect: 2, stderr: /run_id "pagination-run"/ },
  { name: "inline handoff with an ad hoc run id outside a workflow run passes (not enforced)",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ runId: "adhoc-2026-09-30", step: "00", inputs: "[]" }) }), expect: 0 },
  { name: "inline handoff for a different run than .active is blocked",
    run: () => hookRun({ agent_type: "reviewer", message: handoff({ runId: "2026-09-29-feat-other" }) }, { active: RUN }), expect: 2, stderr: /is not the active run/ },
  { name: "developer that wrote its own valid file (no inline, no pointer) passes via the latest-file fallback",
    run: () => { writeFileSync(join(runDir, "06-developer.md"), devHandoff()); return hookRun({ agent_type: "developer", message: "Implemented the plan; tests pass." }, { active: RUN }); }, expect: 0 },
  { name: "developer whose newest own file is invalid is blocked",
    run: () => { writeFileSync(join(runDir, "07-developer.md"), devHandoff({ step: "07", status: "finished", inputs: "[06-developer.md]" })); return hookRun({ agent_type: "developer", message: "Rework done." }, { active: RUN }); }, expect: 2, stderr: /07-developer.md[\s\S]*status "finished"/ },
  { name: "tester with no inline handoff and no own file in the active run is blocked",
    run: () => hookRun({ agent_type: "tester", message: "All tests pass." }, { active: RUN }), expect: 2, stderr: /NN-tester.md/ },
  { name: "HANDOFF pointer to a valid file in the run folder passes",
    run: () => { writeFileSync(join(runDir, "08-code-review.md"), handoff()); return hookRun({ agent_type: "reviewer", message: `Done.\nHANDOFF: .ai-sdlc/runs/${RUN}/08-code-review.md` }, { active: RUN }); }, expect: 0 },
  { name: "HANDOFF pointer whose run_id differs from its folder is blocked",
    run: () => { writeFileSync(join(runDir, "08-code-review.md"), handoff({ runId: "2026-09-29-feat-other" })); return hookRun({ agent_type: "reviewer", message: `HANDOFF: .ai-sdlc/runs/${RUN}/08-code-review.md` }, { active: RUN }); }, expect: 2, stderr: /does not match its run folder/ },
  { name: "HANDOFF pointer whose file prefix differs from step is blocked",
    run: () => { writeFileSync(join(runDir, "09-code-review.md"), handoff()); return hookRun({ agent_type: "reviewer", message: `HANDOFF: .ai-sdlc/runs/${RUN}/09-code-review.md` }, { active: RUN }); }, expect: 2, stderr: /prefix 09 does not match step 08/ },
  { name: "HANDOFF pointer outside .ai-sdlc/runs is blocked",
    run: () => hookRun({ agent_type: "developer", message: "HANDOFF: sample-app/README.md" }, { active: RUN }), expect: 2, stderr: /must be under .ai-sdlc\/runs/ },
  { name: "HANDOFF pointer to a missing file is blocked",
    run: () => hookRun({ agent_type: "developer", message: `HANDOFF: .ai-sdlc/runs/${RUN}/04-missing.md` }, { active: RUN }), expect: 2, stderr: /does not exist/ },
  // ---- Frappe-specific rules -------------------------------------------------------------
  { name: "developer complete without a quoted bench summary is blocked",
    run: () => hookRun({ agent_type: "developer", message: devHandoff({ summary: "Implemented the plan. bench run-tests exited 0." }) }, { active: RUN }), expect: 2, stderr: /quoted bench summary/ },
  { name: "developer complete that quotes Ran 0 tests / OK (wrong --test name) is blocked",
    run: () => hookRun({ agent_type: "developer", message: devHandoff({ summary: "Ran 0 tests in 0.000s\n\nOK" }) }, { active: RUN }), expect: 2, stderr: /Ran 0 tests/ },
  { name: "tester complete that quotes FAILED ( is blocked",
    run: () => hookRun({ agent_type: "tester", message: devHandoff({ agent: "tester", summary: "Ran 56 tests in 4.418s\n\nFAILED (failures=1, errors=1)\n\nOK for the other 54" }) }, { active: RUN }), expect: 2, stderr: /quotes "FAILED \("/ },
  { name: "tester blocked with a FAILED summary and an open question passes",
    run: () => hookRun({ agent_type: "tester", message: devHandoff({ agent: "tester", status: "blocked", next: "developer", summary: "Ran 56 tests in 4.418s\n\nFAILED (failures=1, errors=1)", questions: "- TST-1 blocks the run." }) }, { active: RUN }), expect: 0 },
  { name: "developer complete with Ran N tests and OK passes (not a git checkout: no scope file, no crash)",
    run: () => hookRun({ agent_type: "developer", message: devHandoff() }, { active: RUN }), expect: 0 },
  { name: "developer stop records SECURITY STEP: MANDATORY when hooks.py changed", run: () => {
      const dir = gitProject((app) => writeFileSync(join(app, "hooks.py"), 'app_name = "spice_lite"\nrequired_apps = []\nfixtures = [{"dt": "SL Observation Code"}]\n'));
      try {
        const r = hookRun({ agent_type: "developer", message: devHandoff() }, { active: RUN, dir });
        const txt = existsSync(scopeFile(dir)) ? readFileSync(scopeFile(dir), "utf8") : "";
        return { ...r, status: /^SECURITY STEP: MANDATORY \(rules 3\)/.test(txt) ? r.status : 99 };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, expect: 0 },
  { name: "developer stop records SECURITY STEP: SKIP for a controller-only change", run: () => {
      const dir = gitProject((app) => writeFileSync(join(app, "clinical", "doctype", "sl_encounter", "sl_encounter.py"), "class SLEncounter:\n\tdef validate(self):\n\t\tpass\n"));
      try {
        const r = hookRun({ agent_type: "developer", message: devHandoff() }, { active: RUN, dir });
        const txt = existsSync(scopeFile(dir)) ? readFileSync(scopeFile(dir), "utf8") : "";
        return { ...r, status: /^SECURITY STEP: SKIP .*sl_encounter\.py/.test(txt) ? r.status : 99 };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, expect: 0 },
  { name: "new DocType JSON with a permissions array (untracked file) is MANDATORY rule 1", run: () => {
      const dir = gitProject((app) => {
        mkdirSync(join(app, "clinical", "doctype", "sl_observation_code"), { recursive: true });
        writeFileSync(join(app, "clinical", "doctype", "sl_observation_code", "sl_observation_code.json"), '{\n "name": "SL Observation Code",\n "permissions": [\n  {\n   "read": 1,\n   "role": "Clinician"\n  }\n ]\n}\n');
      });
      try {
        const r = hookRun({ agent_type: "developer", message: devHandoff() }, { active: RUN, dir });
        const txt = existsSync(scopeFile(dir)) ? readFileSync(scopeFile(dir), "utf8") : "";
        return { ...r, status: /MANDATORY \(rules 1\)[\s\S]*sl_observation_code\.json:3/.test(txt) ? r.status : 99 };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, expect: 0 },
  { name: "invalid developer handoff does not write a scope file", run: () => {
      const dir = gitProject((app) => writeFileSync(join(app, "hooks.py"), "x = 1\n"));
      try {
        const r = hookRun({ agent_type: "developer", message: devHandoff({ status: "finished" }) }, { active: RUN, dir });
        return { ...r, status: existsSync(scopeFile(dir)) ? 99 : r.status };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, expect: 2, stderr: /status "finished"/ },
];

let failed = 0;
for (const c of cases) {
  const r = c.run();
  const ok = r.status === c.expect && (!c.stderr || c.stderr.test(r.stderr));
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})`);
  if (!ok) console.log(`      stdout: ${r.stdout.trim()}\n      stderr: ${r.stderr.trim()}`);
}
rmSync(project, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
