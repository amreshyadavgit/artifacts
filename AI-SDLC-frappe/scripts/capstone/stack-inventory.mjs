#!/usr/bin/env node
// stack-inventory.mjs (Frappe edition): list every file of the AI-SDLC system that still encodes the course's
// reference app, bench or invented deployment, grouped by component, so you know what to edit when you move the
// system from spice_lite on /home/user/frappe-bench to your own spice_next_core-style bench.
// Zero dependencies, Node 22. Course tooling (module 11-capstone, exercise 11-move-to-your-bench).
//
//   node scripts/capstone/stack-inventory.mjs                    Markdown table, default term sets
//   node scripts/capstone/stack-inventory.mjs --files            also list the matching files per component
//   node scripts/capstone/stack-inventory.mjs --terms terms.json custom term sets {"name": ["regex", ...]}
//   node scripts/capstone/stack-inventory.mjs --max N            exit 1 if more than N files still match (use after a swap)
//   node scripts/capstone/stack-inventory.mjs --root DIR --json  another root, machine-readable
// Exit codes: 0 ok (or within --max), 1 more matching files than --max, 2 usage error.
//
// sample-app/ is not scanned: it is the app being replaced, not the system around it.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// What the course's reference system assumes. None of it is true on your bench.
export const DEFAULT_TERMS = {
  app: ["\\bspice_lite\\b", "\\bSL (Patient|Encounter|Observation|Country)\\b", "\\bsl_(patient|encounter|observation|country)\\b", "\\bSL[PEO]-\\d", "\\bapi\\.fhir\\b", "\\blastn\\b"],
  bench: ["test\\.localhost", "/home/user/frappe-bench", "setup-bench\\.sh"],
  platform: ["\\bspice[-_]ke\\b", "ke\\.spice\\.example", "\\bspice_telephony\\b", "\\bKE-C-017\\b"],
};

// Component groups in the order you should change them (see docs/capstone/personalize-checklist.md).
export const COMPONENTS = [
  ["memory", ["CLAUDE.md", ".claude/rules"]],
  ["context", ["context"]],
  ["agents", [".claude/agents", "agents"]],
  ["skills", [".claude/skills", "skills", "company-ai"]],
  ["workflows", ["workflows"]],
  ["mcp", [".mcp.json", "mcp", "docs/mcp", "scripts/automation"]],
  ["governance", [".claude/settings.json", ".claude/hooks", "docs/governance", "scripts/governance"]],
  ["evals", ["evaluations"]],
  ["docs", ["docs/adr", "docs/foundations", "docs/tutorials", "docs/capstone", "README.md"]],
];
const TEXT = /\.(md|mjs|js|json|ya?ml|sh|patch|txt|log|py)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".ai-sdlc", "recordings", "reports"]);

function filesUnder(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  const out = [];
  for (const n of readdirSync(abs)) {
    if (SKIP_DIRS.has(n)) continue;
    const r = join(rel, n);
    if (statSync(join(root, r)).isDirectory()) out.push(...filesUnder(root, r));
    else if (TEXT.test(n)) out.push(r);
  }
  return out;
}

export function inventory(root, terms = DEFAULT_TERMS) {
  const compiled = Object.fromEntries(Object.entries(terms).map(([k, list]) => [k, list.map((t) => new RegExp(t))]));
  const seen = new Set();
  const groups = [];
  for (const [name, paths] of COMPONENTS) {
    const g = { component: name, files: 0, matching: [], hits: Object.fromEntries(Object.keys(terms).map((k) => [k, 0])) };
    for (const p of paths) {
      for (const f of filesUnder(root, p)) {
        const key = f.split(sep).join("/");
        if (seen.has(key)) continue; // a file belongs to the first component that lists it
        seen.add(key);
        g.files++;
        const text = readFileSync(join(root, f), "utf8");
        const perSet = {};
        for (const [set, res] of Object.entries(compiled)) {
          const n = res.reduce((acc, re) => acc + (text.match(new RegExp(re.source, "g")) || []).length, 0);
          if (n) perSet[set] = n;
          g.hits[set] += n;
        }
        if (Object.keys(perSet).length) g.matching.push({ file: key, ...perSet });
      }
    }
    g.matching.sort((a, b) => sum(b) - sum(a));
    groups.push(g);
  }
  return groups;
}
const sum = (m) => Object.entries(m).filter(([k]) => k !== "file").reduce((a, [, v]) => a + v, 0);

export function render(groups, { files = false } = {}) {
  const sets = Object.keys(groups[0]?.hits || {});
  const out = [`| component | files | files with matches | ${sets.join(" | ")} | top files |`, `|---|---|---|${sets.map(() => "---|").join("")}---|`];
  for (const g of groups) {
    const top = g.matching.slice(0, 3).map((m) => `\`${m.file}\``).join(", ") || "-";
    out.push(`| ${g.component} | ${g.files} | ${g.matching.length} | ${sets.map((s) => g.hits[s]).join(" | ")} | ${top} |`);
  }
  const total = groups.reduce((a, g) => a + g.matching.length, 0);
  out.push("", `stack-inventory: ${total} file(s) encode a reference-system assumption`);
  if (files) for (const g of groups) if (g.matching.length) {
    out.push("", `### ${g.component}`);
    for (const m of g.matching) out.push(`- ${m.file} (${Object.entries(m).filter(([k]) => k !== "file").map(([k, v]) => `${k} ${v}`).join(", ")})`);
  }
  return out.join("\n");
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let terms = DEFAULT_TERMS, json = false, files = false, max = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    try {
      if (a === "--root") root = resolve(next());
      else if (a === "--terms") terms = JSON.parse(readFileSync(next(), "utf8"));
      else if (a === "--json") json = true;
      else if (a === "--files") files = true;
      else if (a === "--max") { max = Number(next()); if (!Number.isInteger(max) || max < 0) throw new Error("--max needs a non-negative integer"); }
      else throw new Error(`unknown option ${a}`);
    } catch (e) { console.error(`stack-inventory: ${e.message}`); return 2; }
  }
  if (!existsSync(root)) { console.error(`stack-inventory: no such directory ${root}`); return 2; }
  const groups = inventory(root, terms);
  console.log(json ? JSON.stringify({ root, groups }, null, 2) : render(groups, { files }));
  const total = groups.reduce((a, g) => a + g.matching.length, 0);
  return max !== null && total > max ? 1 : 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));
