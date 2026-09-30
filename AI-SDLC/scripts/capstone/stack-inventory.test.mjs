#!/usr/bin/env node
// Tests for stack-inventory.mjs. Usage (from AI-SDLC/): node scripts/capstone/stack-inventory.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "stack-inventory.mjs");
const root = mkdtempSync(join(tmpdir(), "stack-inventory-"));
const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
w("CLAUDE.md", "# Repo\nTest: `cd sample-app && mvn -q -B test`. FHIR Patient API.\n");
w("context/domain/glossary.md", "Patient and Observation. MRN is PHI.\n");
w(".claude/agents/sre.md", "---\nname: sre\n---\nUse kubectl get pods.\n");
w("workflows/feature-delivery.md", "# Feature\nNo stack terms here.\n");
w("sample-app/src/Main.java", "class Main { /* FHIR Patient mvn */ }\n");
w("evaluations/recordings/x.json", "{\"note\": \"FHIR Patient\"}\n");
w("terms.json", JSON.stringify({ node: ["\\bnpm\\b"], retail: ["\\bOrder\\b"] }));

const run = (args) => {
  const r = spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" });
  let data = null;
  try { data = JSON.parse(r.stdout); } catch { /* table output */ }
  return { ...r, data };
};
const group = (d, name) => d.groups.find((g) => g.component === name);

const cases = [
  { name: "counts stack and domain hits in CLAUDE.md under memory", run: () => run(["--json"]),
    check: (r) => r.status === 0 && group(r.data, "memory").hits.stack === 1 && group(r.data, "memory").hits.domain === 2 },
  { name: "context and agents groups find domain and platform terms", run: () => run(["--json"]),
    check: (r) => group(r.data, "context").hits.domain === 4 && group(r.data, "agents").hits.platform === 1 },
  { name: "a file without terms is counted but not listed as matching", run: () => run(["--json"]),
    check: (r) => group(r.data, "workflows").files === 1 && group(r.data, "workflows").matching.length === 0 },
  { name: "sample-app/ and eval recordings are not scanned", run: () => run(["--json"]),
    check: (r) => !JSON.stringify(r.data).includes("Main.java") && group(r.data, "evals").files === 0 },
  { name: "--max below the number of matching files exits 1", run: () => run(["--max", "2"]), check: (r) => r.status === 1 && /3 file\(s\) encode/.test(r.stdout) },
  { name: "--max at the number of matching files exits 0", run: () => run(["--max", "3"]), check: (r) => r.status === 0 },
  { name: "--terms replaces the term sets (after a swap to another stack)", run: () => run(["--json", "--terms", join(root, "terms.json")]),
    check: (r) => r.status === 0 && Object.keys(group(r.data, "memory").hits).join(",") === "node,retail" && r.data.groups.every((g) => g.matching.length === 0) },
  { name: "--files prints a section per component with matches", run: () => run(["--files"]), check: (r) => /### memory\n- CLAUDE\.md \(stack 1, domain 2\)/.test(r.stdout) },
  { name: "unknown option is a usage error (exit 2)", run: () => run(["--bogus"]), check: (r) => r.status === 2 && /unknown option/.test(r.stderr) },
];

let failed = 0;
for (const c of cases) {
  const r = c.run();
  const ok = c.check(r);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 1200), r.stderr); }
  console.log(`${ok ? "ok  " : "FAIL"}  ${c.name}`);
}
rmSync(root, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
