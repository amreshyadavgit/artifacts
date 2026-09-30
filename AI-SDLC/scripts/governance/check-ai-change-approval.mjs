#!/usr/bin/env node
// Human gate for changes to the AI configuration of this repo (agents, skills, hooks, settings,
// MCP servers, CLAUDE.md, the skill library and this gate itself).
// Used by docs/governance/ai-change-gate.yml.example as a required status check. It passes when
// either no governed path changed, or the PR has an APPROVED review on the current head commit
// from a human who is not the PR author (and, if configured, is on the approver list).
//
// Usage:
//   node scripts/governance/check-ai-change-approval.mjs \
//     --changed changed.txt --reviews reviews.json --author alice --head-sha <sha> [--approvers bob,carol]
//   changed.txt : one path per line (from GET /repos/{o}/{r}/pulls/{n}/files)
//   reviews.json: a JSON array or one JSON object per line, each {user, state, commit_id}
//                 (user may be a login string or {login}).
// Exit 0 = gate satisfied, 1 = human approval missing, 2 = usage error.
import { readFileSync } from "node:fs";

// Paths are matched after stripping an optional leading "AI-SDLC/" so the gate works whether
// AI-SDLC is the repository root or a folder inside it.
export const GOVERNED = [
  [/^\.claude\//, "Claude Code project config (.claude/**)"],
  [/(^|\/)\.claude\//, "nested Claude Code config (**/.claude/**)"],
  [/^\.mcp\.json$/, "MCP servers (.mcp.json)"],
  [/(^|\/)CLAUDE(\.local)?\.md$/, "project memory (CLAUDE.md)"],
  [/^skills\//, "skill library (skills/**)"],
  [/^company-ai\//, "company-ai plugin (company-ai/**)"],
  [/(^|\/)\.claude-plugin\//, "plugin manifest (.claude-plugin/**)"],
  [/^agents\/.+\/CONTRACT\.md$/, "Agent Contracts (agents/*/CONTRACT.md)"],
  [/^scripts\/governance\//, "governance scripts (scripts/governance/**)"],
  [/^\.github\/(workflows\/ai-change-gate\.yml|CODEOWNERS)$/, "the gate itself"],
];

export function governedChanges(paths) {
  const out = [];
  for (const raw of paths) {
    const p = raw.trim().replace(/^AI-SDLC\//, "");
    if (!p) continue;
    const hit = GOVERNED.find(([re]) => re.test(p));
    if (hit) out.push({ path: raw.trim(), why: hit[1] });
  }
  return out;
}

export function parseReviews(text) {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) return JSON.parse(t);
  return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function evaluateGate({ changed, reviews, author, headSha, approvers = [] }) {
  const governed = governedChanges(changed);
  if (!governed.length) return { ok: true, governed, message: "No governed AI config paths changed; gate not required." };
  // GitHub returns reviews oldest first; the latest review per user is the one that counts.
  const latest = new Map();
  for (const r of reviews) {
    const login = typeof r.user === "string" ? r.user : r.user?.login;
    if (!login || r.state === "COMMENTED") continue;
    latest.set(login, r);
  }
  const allowed = new Set(approvers.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const valid = [];
  const rejected = [];
  for (const [login, r] of latest) {
    const reasons = [];
    if (r.state !== "APPROVED") reasons.push(`latest review is ${r.state}`);
    if (login.toLowerCase() === String(author).toLowerCase()) reasons.push("is the PR author");
    if (/\[bot\]$/i.test(login)) reasons.push("is a bot");
    if (allowed.size && !allowed.has(login.toLowerCase())) reasons.push("is not on the approver list");
    if (headSha && r.commit_id && r.commit_id !== headSha) reasons.push("approved an older commit");
    (reasons.length ? rejected : valid).push({ login, reasons });
  }
  const changedList = governed.map((g) => `  - ${g.path} (${g.why})`).join("\n");
  if (valid.length) {
    return { ok: true, governed, message: `Governed AI config changed and was approved by ${valid.map((v) => v.login).join(", ")}:\n${changedList}` };
  }
  const why = rejected.length ? "\nReviews that do not count:\n" + rejected.map((r) => `  - ${r.login}: ${r.reasons.join(", ")}`).join("\n") : "\nNo reviews yet.";
  return {
    ok: false,
    governed,
    message: `Human approval required: this PR changes AI agent configuration.\n${changedList}${why}\n` +
      `Ask a member of the AI governance group to review and approve the current head commit.`,
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && process.argv[1].endsWith("check-ai-change-approval.mjs")) {
  const changedFile = arg("changed");
  const reviewsFile = arg("reviews");
  if (!changedFile || !reviewsFile || !arg("author")) {
    console.error("usage: check-ai-change-approval.mjs --changed <file> --reviews <file> --author <login> [--head-sha <sha>] [--approvers a,b]");
    process.exit(2);
  }
  const result = evaluateGate({
    changed: readFileSync(changedFile, "utf8").split("\n"),
    reviews: parseReviews(readFileSync(reviewsFile, "utf8")),
    author: arg("author"),
    headSha: arg("head-sha"),
    approvers: (arg("approvers") || process.env.AI_GOVERNANCE_APPROVERS || "").split(","),
  });
  console.log(`${result.ok ? "PASS" : "FAIL"}  ai-change-gate\n${result.message}`);
  process.exit(result.ok ? 0 : 1);
}
