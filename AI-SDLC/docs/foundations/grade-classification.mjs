#!/usr/bin/env node
// Grade a learner's primitive classification against docs/foundations/classification-answer-key.md.
// Zero dependencies, Node 22.
//
// Usage: node docs/foundations/grade-classification.mjs <answers.json> [--key <answer-key.md>] [--pass <n>]
// answers.json: { "N01": { "answer": "hook", "why": "..." }, ... }  (a bare string "hook" is also accepted)
// Exit codes: 0 score >= pass mark (default 8), 1 below pass mark, 2 usage or I/O error.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRIMITIVES = ["prompt", "skill", "agent", "workflow", "mcp", "hook"];
const DEFAULT_KEY = join(dirname(fileURLToPath(import.meta.url)), "classification-answer-key.md");

// Split a markdown table row on pipes that are not escaped as \|
function cells(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

export function parseKey(markdown) {
  const key = new Map();
  for (const line of markdown.split("\n")) {
    if (!/^\| N\d{2} \|/.test(line)) continue;
    const [id, need, answer, accepted, justification] = cells(line);
    if (!PRIMITIVES.includes(answer)) throw new Error(`${id}: answer "${answer}" is not a primitive`);
    const alt = accepted === "none" ? [] : accepted.split(/,\s*/);
    key.set(id, { need, answer, accepted: alt, justification });
  }
  return key;
}

export function grade(key, answers) {
  const rows = [];
  let score = 0;
  for (const [id, k] of key) {
    const raw = answers[id];
    const given = String((raw && typeof raw === "object" ? raw.answer : raw) || "").trim().toLowerCase();
    const why = raw && typeof raw === "object" ? String(raw.why || "").trim() : "";
    let verdict;
    if (!given) verdict = "MISSING";
    else if (!PRIMITIVES.includes(given)) verdict = "INVALID";
    else if (given === k.answer) verdict = "CORRECT";
    else if (k.accepted.includes(given)) verdict = "ACCEPTED";
    else verdict = "WRONG";
    const points = verdict === "CORRECT" || verdict === "ACCEPTED" ? 1 : 0;
    score += points;
    rows.push({ id, given: given || "-", expected: k.answer, verdict, points, noWhy: points === 1 && why.length < 20 });
  }
  return { score, total: key.size, rows };
}

function main(argv) {
  const args = [...argv];
  const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
  const keyPath = opt("--key", DEFAULT_KEY);
  const pass = Number(opt("--pass", "8"));
  const [answersPath] = args;
  if (!answersPath) { process.stderr.write("usage: grade-classification.mjs <answers.json> [--key <md>] [--pass <n>]\n"); return 2; }
  let key, answers;
  try {
    key = parseKey(readFileSync(keyPath, "utf8"));
    answers = JSON.parse(readFileSync(answersPath, "utf8"));
  } catch (e) { process.stderr.write(`ERROR ${e.message}\n`); return 2; }
  const r = grade(key, answers);
  for (const row of r.rows) {
    let line = `${row.id}  ${row.verdict.padEnd(8)} given=${row.given.padEnd(8)} key=${row.expected}`;
    if (row.verdict === "WRONG") line += `  -> ${key.get(row.id).justification}`;
    if (row.verdict === "ACCEPTED") line += "  (alternative answer: check the justification names the agent it runs in)";
    if (row.noWhy) line += "  (warning: justification missing or under 20 characters)";
    process.stdout.write(line + "\n");
  }
  const ok = r.score >= pass;
  process.stdout.write(`SCORE ${r.score}/${r.total} (pass mark ${pass}) ${ok ? "PASS" : "FAIL"}\n`);
  return ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
