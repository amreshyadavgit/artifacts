#!/usr/bin/env node
// Tests for check-handoff.mjs. Usage (from AI-SDLC/): node .claude/hooks/check-handoff.test.mjs
// Runs the hook as a real subprocess with SubagentStop payloads, exactly as Claude Code would.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "check-handoff.mjs");
const examples = join(here, "..", "..", "workflows", "examples", "feature-patient-pagination");
const RUN = "2026-09-30-feat-patient-pagination";

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
Reviewed the pagination diff in PatientController and PatientService.

## Findings
${findings ?? `| id | severity | category | location | evidence | recommendation |
|---|---|---|---|---|---|
| CR-1 | low | readability | sample-app/src/main/java/org/example/fhir/api/PatientController.java:45 | \`int offset\` | Name it \`offset\` consistently with \`_offset\`. |`}

## Decisions
- No blocking findings.

## Open questions
${questions}

## Artifacts
- none (read-only review)
`;
}

function hookRun(payload, { active } = {}) {
  if (active === undefined) rmSync(join(project, ".ai-sdlc", "runs", ".active"), { force: true });
  else writeFileSync(join(project, ".ai-sdlc", "runs", ".active"), active + "\n");
  const input = JSON.stringify({
    session_id: "test-session", transcript_path: "/tmp/t.jsonl", cwd: project, permission_mode: "default",
    hook_event_name: "SubagentStop", stop_hook_active: false, agent_id: "a1b2c3", agent_type: payload.agent_type,
    agent_transcript_path: "/tmp/agent-a1b2c3.jsonl", last_assistant_message: payload.message,
  });
  return spawnSync(process.execPath, [hook], { input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
}

const cases = [
  { name: "CLI: every example handoff in workflows/examples/feature-patient-pagination is valid",
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
    run: () => { writeFileSync(join(runDir, "06-developer.md"), handoff({ step: "06", agent: "developer", inputs: "[04-developer.md]", next: "reviewer", findings: "No findings." })); return hookRun({ agent_type: "developer", message: "Implemented the plan; tests pass." }, { active: RUN }); }, expect: 0 },
  { name: "developer whose newest own file is invalid is blocked",
    run: () => { writeFileSync(join(runDir, "07-developer.md"), handoff({ step: "07", agent: "developer", status: "finished", inputs: "[06-developer.md]", next: "reviewer", findings: "No findings." })); return hookRun({ agent_type: "developer", message: "Rework done." }, { active: RUN }); }, expect: 2, stderr: /07-developer.md[\s\S]*status "finished"/ },
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
