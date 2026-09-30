#!/usr/bin/env node
// context-budget.mjs: estimate the start-up context each subagent pays before its task message.
// Per the docs a subagent receives its file body (system prompt), the CLAUDE.md hierarchy, git
// status, and the full content of every skill listed in `skills:`. This script sums what it can
// measure from the repo: agent body + preloaded SKILL.md files + CLAUDE.md with its @imports.
// Tokens are estimated as characters / 4 (a rough rule of thumb, not a tokenizer).
// Usage: node workflows/composition/context-budget.mjs [project-dir]   (default .)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const est = (chars) => Math.round(chars / 4);

/** CLAUDE.md plus @imports (one level, outside code spans), as loaded for every agent. */
export function claudeMdChars(projectDir) {
  const p = join(projectDir, "CLAUDE.md");
  if (!existsSync(p)) return 0;
  const text = readFileSync(p, "utf8");
  let total = text.length;
  for (const line of text.split("\n")) {
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/(?:^|\s)@([\w./-]+)/g)) {
      const imp = join(dirname(p), m[1]);
      if (existsSync(imp)) total += readFileSync(imp, "utf8").length;
    }
  }
  return total;
}

export function agentBudget(projectDir, file) {
  const text = readFileSync(file, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const front = m ? m[1] : "";
  const body = m ? m[2] : text;
  const name = (front.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || file;
  const skills = [];
  const inline = front.match(/^skills:[ \t]*(\S.*)$/m);
  if (inline) skills.push(...inline[1].replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean));
  else {
    const block = front.match(/^skills:[ \t]*\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
    if (block) skills.push(...block[1].split("\n").map((l) => l.replace(/^\s+-\s+/, "").trim()).filter(Boolean));
  }
  let skillChars = 0;
  const missing = [];
  for (const s of skills) {
    const sp = join(projectDir, ".claude", "skills", s, "SKILL.md");
    if (existsSync(sp)) skillChars += readFileSync(sp, "utf8").length; else missing.push(s);
  }
  return { name, bodyChars: body.length, skills, skillChars, missing };
}

export function report(projectDir) {
  const dir = join(projectDir, ".claude", "agents");
  const shared = claudeMdChars(projectDir);
  const rows = readdirSync(dir).filter((n) => n.endsWith(".md")).sort().map((n) => agentBudget(projectDir, join(dir, n)));
  return { shared, rows: rows.map((r) => ({ ...r, totalTokens: est(shared + r.bodyChars + r.skillChars) })) };
}

if (process.argv[1] && new URL(import.meta.url).pathname === (await import("node:path")).resolve(process.argv[1])) {
  const projectDir = process.argv[2] || ".";
  const { shared, rows } = report(projectDir);
  console.log(`CLAUDE.md + imports (every agent): ~${est(shared)} tokens`);
  console.log(["agent".padEnd(14), "body".padStart(6), "skills".padStart(7), "total".padStart(7), "  preloaded skills"].join(""));
  for (const r of rows) {
    console.log([r.name.padEnd(14), String(est(r.bodyChars)).padStart(6), String(est(r.skillChars)).padStart(7), String(r.totalTokens).padStart(7),
      "  " + (r.skills.join(", ") || "-") + (r.missing.length ? `  (missing: ${r.missing.join(", ")})` : "")].join(""));
  }
}
