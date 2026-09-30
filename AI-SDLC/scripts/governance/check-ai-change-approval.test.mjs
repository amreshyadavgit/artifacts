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
const cases = [
  { name: "app-only change needs no AI approval", changed: ["AI-SDLC/sample-app/src/main/java/org/example/fhir/service/ObservationService.java"], reviews: [], expect: 0 },
  { name: "agent change without review fails", changed: ["AI-SDLC/.claude/agents/developer.md"], reviews: [], expect: 1 },
  { name: "author approving own PR does not count", changed: [".claude/settings.json"], reviews: [{ user: { login: "alice" }, state: "APPROVED", commit_id: HEAD }], expect: 1 },
  { name: "bot approval does not count", changed: [".claude/hooks/guard-outbound.mjs"], reviews: [{ user: "github-actions[bot]", state: "APPROVED", commit_id: HEAD }], expect: 1 },
  { name: "approval of an older commit does not count", changed: ["AI-SDLC/.mcp.json"], reviews: [{ user: "bob", state: "APPROVED", commit_id: "1111111" }], expect: 1 },
  { name: "approval then changes requested by same reviewer fails", changed: ["AI-SDLC/skills/code-review/CHANGELOG.md"], reviews: [{ user: "bob", state: "APPROVED", commit_id: HEAD }, { user: "bob", state: "CHANGES_REQUESTED", commit_id: HEAD }], expect: 1 },
  { name: "non-author human approval on head passes", changed: ["AI-SDLC/.claude/skills/code-review/SKILL.md", "AI-SDLC/sample-app/pom.xml"], reviews: [{ user: "bob", state: "APPROVED", commit_id: HEAD }], expect: 0 },
  { name: "approver list is enforced", changed: ["AI-SDLC/CLAUDE.md"], reviews: [{ user: "dave", state: "APPROVED", commit_id: HEAD }], approvers: "bob,carol", expect: 1 },
  { name: "listed approver passes", changed: ["AI-SDLC/company-ai/.claude-plugin/plugin.json"], reviews: [{ user: "carol", state: "APPROVED", commit_id: HEAD }], approvers: "bob,carol", expect: 0 },
  { name: "changing the gate script itself is governed", changed: ["AI-SDLC/scripts/governance/check-ai-change-approval.mjs"], reviews: [], expect: 1 },
];

let failed = 0;
cases.forEach((c, i) => {
  const changed = join(dir, `changed-${i}.txt`);
  const reviews = join(dir, `reviews-${i}.json`);
  writeFileSync(changed, c.changed.join("\n") + "\n");
  // Alternate the two accepted review formats: JSON array and one object per line (gh --jq output).
  writeFileSync(reviews, i % 2 ? JSON.stringify(c.reviews) : c.reviews.map((r) => JSON.stringify(r)).join("\n"));
  const args = [script, "--changed", changed, "--reviews", reviews, "--author", "alice", "--head-sha", HEAD];
  if (c.approvers) args.push("--approvers", c.approvers);
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, AI_GOVERNANCE_APPROVERS: "" } });
  const ok = r.status === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})${ok ? "" : "\n" + r.stdout + r.stderr}`);
});
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
