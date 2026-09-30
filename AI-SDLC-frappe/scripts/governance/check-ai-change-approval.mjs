#!/usr/bin/env node
// Human gate for two kinds of change that an agent can produce but must never merge on its own:
//   ai-config : the AI configuration of this repo (agents, skills, Claude Code hooks, settings,
//               MCP servers, CLAUDE.md, the skill library, the company-ai plugin, this gate).
//   schema    : Frappe schema and site-level behaviour (DocType JSON and controllers under
//               **/doctype/**, patches.txt and patch modules, hooks.py, fixtures, modules.txt).
// Used by docs/governance/ai-change-gate.yml.example as a required status check. For EACH category
// the PR touches, it needs an APPROVED review on the current head commit from a human who is not the
// PR author and (if that category's approver list is set) is on that list. One reviewer on both
// lists satisfies both categories.
//
// Usage:
//   node scripts/governance/check-ai-change-approval.mjs \
//     --changed changed.txt --reviews reviews.json --author alice --head-sha <sha> \
//     [--ai-approvers bob,carol] [--schema-approvers dan,erin]
//   changed.txt : one path per line (from GET /repos/{o}/{r}/pulls/{n}/files)
//   reviews.json: a JSON array or one JSON object per line, each {user, state, commit_id}
//                 (user may be a login string or {login}).
//   Approver lists default to the env vars AI_GOVERNANCE_APPROVERS and SCHEMA_APPROVERS.
// Exit 0 = gate satisfied, 1 = human approval missing, 2 = usage error.
import { readFileSync } from "node:fs";

// Paths are matched after stripping an optional leading "AI-SDLC-frappe/" so the gate works whether
// AI-SDLC-frappe is the repository root or a folder inside it.
export const GOVERNED = [
  // AI configuration
  [/(^|\/)\.claude\//, "ai-config", "Claude Code config (.claude/**)"],
  [/^\.mcp\.json$/, "ai-config", "MCP servers (.mcp.json)"],
  [/(^|\/)CLAUDE(\.local)?\.md$/, "ai-config", "project memory (CLAUDE.md)"],
  [/^skills\//, "ai-config", "skill library (skills/**)"],
  [/^company-ai\//, "ai-config", "company-ai plugin (company-ai/**)"],
  [/(^|\/)\.claude-plugin\//, "ai-config", "plugin manifest (.claude-plugin/**)"],
  [/^agents\/.+\/CONTRACT\.md$/, "ai-config", "Agent Contracts (agents/*/CONTRACT.md)"],
  [/^scripts\/governance\//, "ai-config", "governance scripts (scripts/governance/**)"],
  [/^\.github\/(workflows\/ai-change-gate\.yml|CODEOWNERS)$/, "ai-config", "the gate itself"],
  // Frappe schema and site behaviour
  [/(^|\/)doctype\/.+/, "schema", "DocType definition or controller (**/doctype/**)"],
  [/(^|\/)patches\.txt$/, "schema", "patch list (patches.txt)"],
  [/(^|\/)patches\/.+\.py$/, "schema", "patch module (patches/**)"],
  [/(^|\/)hooks\.py$/, "schema", "Frappe hooks (hooks.py)"],
  [/(^|\/)fixtures\/.+\.json$/, "schema", "fixtures (Custom Field, Property Setter, Role, ...)"],
  [/(^|\/)modules\.txt$/, "schema", "module list (modules.txt)"],
];

export const CATEGORY_LABEL = { "ai-config": "AI agent configuration", schema: "Frappe schema / hooks.py / patches / fixtures" };

export function governedChanges(paths) {
  const out = [];
  for (const raw of paths) {
    const p = raw.trim().replace(/^AI-SDLC-frappe\//, "");
    if (!p) continue;
    const hit = GOVERNED.find(([re]) => re.test(p));
    if (hit) out.push({ path: raw.trim(), category: hit[1], why: hit[2] });
  }
  return out;
}

export function parseReviews(text) {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) return JSON.parse(t);
  return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const toSet = (list) => new Set((list || []).map((a) => a.trim().toLowerCase()).filter(Boolean));

export function evaluateGate({ changed, reviews, author, headSha, approvers = {} }) {
  const governed = governedChanges(changed);
  if (!governed.length) return { ok: true, governed, message: "No governed paths changed (AI config or Frappe schema); gate not required." };
  // GitHub returns reviews oldest first; the latest non-comment review per user is the one that counts.
  const latest = new Map();
  for (const r of reviews) {
    const login = typeof r.user === "string" ? r.user : r.user?.login;
    if (!login || r.state === "COMMENTED") continue;
    latest.set(login, r);
  }
  // A review is "valid" (a non-author human approval of the head commit) independent of category.
  const valid = [];
  const rejected = [];
  for (const [login, r] of latest) {
    const reasons = [];
    if (r.state !== "APPROVED") reasons.push(`latest review is ${r.state}`);
    if (login.toLowerCase() === String(author).toLowerCase()) reasons.push("is the PR author");
    if (/\[bot\]$/i.test(login)) reasons.push("is a bot");
    if (headSha && r.commit_id && r.commit_id !== headSha) reasons.push("approved an older commit");
    (reasons.length ? rejected : valid).push({ login, reasons });
  }
  const categories = [...new Set(governed.map((g) => g.category))];
  const lines = [];
  let ok = true;
  for (const cat of categories) {
    const allowed = toSet(approvers[cat]);
    const approvedBy = valid.filter((v) => !allowed.size || allowed.has(v.login.toLowerCase())).map((v) => v.login);
    const files = governed.filter((g) => g.category === cat).map((g) => `    - ${g.path} (${g.why})`).join("\n");
    if (approvedBy.length) {
      lines.push(`  [ok]      ${CATEGORY_LABEL[cat]}: approved by ${approvedBy.join(", ")}\n${files}`);
    } else {
      ok = false;
      const notListed = valid.filter((v) => allowed.size && !allowed.has(v.login.toLowerCase())).map((v) => `${v.login} (not on the ${cat} approver list)`);
      lines.push(`  [missing] ${CATEGORY_LABEL[cat]}: needs a non-author human approval on the head commit${allowed.size ? ` from one of: ${[...allowed].join(", ")}` : ""}${notListed.length ? `; does not count: ${notListed.join(", ")}` : ""}\n${files}`);
    }
  }
  const why = rejected.length ? "\nReviews that do not count:\n" + rejected.map((r) => `  - ${r.login}: ${r.reasons.join(", ")}`).join("\n") : "";
  const head = ok ? "Governed changes are approved:" : "Human approval required for governed changes:";
  const tail = ok ? "" : "\nAsk the owning group (see docs/governance/CODEOWNERS.example) to review and approve the current head commit.";
  return { ok, governed, message: `${head}\n${lines.join("\n")}${why}${tail}` };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && process.argv[1].endsWith("check-ai-change-approval.mjs")) {
  const changedFile = arg("changed");
  const reviewsFile = arg("reviews");
  if (!changedFile || !reviewsFile || !arg("author")) {
    console.error("usage: check-ai-change-approval.mjs --changed <file> --reviews <file> --author <login> [--head-sha <sha>] [--ai-approvers a,b] [--schema-approvers c,d]");
    process.exit(2);
  }
  const result = evaluateGate({
    changed: readFileSync(changedFile, "utf8").split("\n"),
    reviews: parseReviews(readFileSync(reviewsFile, "utf8")),
    author: arg("author"),
    headSha: arg("head-sha"),
    approvers: {
      "ai-config": (arg("ai-approvers") ?? process.env.AI_GOVERNANCE_APPROVERS ?? "").split(","),
      schema: (arg("schema-approvers") ?? process.env.SCHEMA_APPROVERS ?? "").split(","),
    },
  });
  console.log(`${result.ok ? "PASS" : "FAIL"}  ai-change-gate\n${result.message}`);
  process.exit(result.ok ? 0 : 1);
}
