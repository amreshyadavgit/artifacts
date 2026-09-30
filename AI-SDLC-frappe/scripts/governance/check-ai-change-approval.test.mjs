#!/usr/bin/env node
// Runs check-ai-change-approval.mjs as a CLI against fixture PRs.
// Usage: node scripts/governance/check-ai-change-approval.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-ai-change-approval.mjs");
const dir = mkdtempSync(join(tmpdir(), "ai-gate-"));
const HEAD = "9f3c2e1";
const APP = "AI-SDLC-frappe/sample-app/spice_lite/spice_lite";
const cases = [
  { name: "API-only Python change needs no gate approval", changed: [`${APP}/api/fhir.py`, `${APP}/tests/test_fhir_api.py`], reviews: [], expect: 0 },
  { name: "agent change without review fails", changed: ["AI-SDLC-frappe/.claude/agents/developer.md"], reviews: [], expect: 1, grep: /\[missing\] AI agent configuration/ },
  { name: "author approving own PR does not count", changed: [".claude/settings.json"], reviews: [{ user: { login: "alice" }, state: "APPROVED", commit_id: HEAD }], expect: 1, grep: /alice: is the PR author/ },
  { name: "bot approval does not count", changed: [".claude/hooks/guard-bench.mjs"], reviews: [{ user: "github-actions[bot]", state: "APPROVED", commit_id: HEAD }], expect: 1, grep: /is a bot/ },
  { name: "approval of an older commit does not count", changed: ["AI-SDLC-frappe/.mcp.json"], reviews: [{ user: "bob", state: "APPROVED", commit_id: "1111111" }], expect: 1, grep: /approved an older commit/ },
  { name: "approval then changes requested by same reviewer fails", changed: ["AI-SDLC-frappe/skills/code-review/CHANGELOG.md"], reviews: [{ user: "bob", state: "APPROVED", commit_id: HEAD }, { user: "bob", state: "CHANGES_REQUESTED", commit_id: HEAD }], expect: 1, grep: /latest review is CHANGES_REQUESTED/ },
  { name: "DocType JSON change is governed as schema", changed: [`${APP}/clinical/doctype/sl_patient/sl_patient.json`], reviews: [], expect: 1, grep: /\[missing\] Frappe schema/ },
  { name: "patches.txt, patch module and hooks.py are schema", changed: [`${APP}/patches.txt`, `${APP}/patches/v0_2/add_national_id.py`, `${APP}/hooks.py`], reviews: [], expect: 1, grep: /patch list[\s\S]*patch module[\s\S]*Frappe hooks/ },
  { name: "country-app fixtures are schema", changed: ["apps/spice_ke/spice_ke/fixtures/custom_field.json"], reviews: [], expect: 1, grep: /fixtures \(Custom Field/ },
  { name: "schema approval passes when no list is configured", changed: [`${APP}/clinical/doctype/sl_observation/sl_observation.json`], reviews: [{ user: "bob", state: "APPROVED", commit_id: HEAD }], expect: 0, grep: /\[ok\]\s+Frappe schema.*bob/ },
  { name: "schema approver list is enforced separately from AI list", changed: [`${APP}/hooks.py`], reviews: [{ user: "carol", state: "APPROVED", commit_id: HEAD }], approvers: ["--ai-approvers", "bob,carol", "--schema-approvers", "dan,erin"], expect: 1, grep: /carol \(not on the schema approver list\)/ },
  { name: "mixed PR needs both groups", changed: [".claude/skills/code-review/SKILL.md", `${APP}/patches.txt`], reviews: [{ user: "carol", state: "APPROVED", commit_id: HEAD }], approvers: ["--ai-approvers", "bob,carol", "--schema-approvers", "dan,erin"], expect: 1, grep: /\[ok\]\s+AI agent configuration: approved by carol[\s\S]*\[missing\] Frappe schema/ },
  { name: "mixed PR passes with one approver from each group", changed: [".claude/skills/code-review/SKILL.md", `${APP}/patches.txt`], reviews: [{ user: "carol", state: "APPROVED", commit_id: HEAD }, { user: "dan", state: "APPROVED", commit_id: HEAD }], approvers: ["--ai-approvers", "bob,carol", "--schema-approvers", "dan,erin"], expect: 0 },
  { name: "changing the gate script itself is governed", changed: ["AI-SDLC-frappe/scripts/governance/check-ai-change-approval.mjs"], reviews: [], expect: 1 },
];

let failed = 0;
cases.forEach((c, i) => {
  const changed = join(dir, `changed-${i}.txt`);
  const reviews = join(dir, `reviews-${i}.json`);
  writeFileSync(changed, c.changed.join("\n") + "\n");
  // Alternate the two accepted review formats: JSON array and one object per line (gh --jq output).
  writeFileSync(reviews, i % 2 ? JSON.stringify(c.reviews) : c.reviews.map((r) => JSON.stringify(r)).join("\n"));
  const args = [script, "--changed", changed, "--reviews", reviews, "--author", "alice", "--head-sha", HEAD, ...(c.approvers || [])];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, AI_GOVERNANCE_APPROVERS: "", SCHEMA_APPROVERS: "" } });
  const ok = r.status === c.expect && (!c.grep || c.grep.test(r.stdout));
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})${ok ? "" : "\n" + r.stdout + r.stderr}`);
});
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
