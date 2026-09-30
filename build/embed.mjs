#!/usr/bin/env node
// Refresh implementation[].content in module JSON files from the files on disk, so content is byte-identical.
// Usage: node build/embed.mjs content/modules/05-agent-roster.json [...more]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let missing = 0;
for (const f of process.argv.slice(2)) {
  const mod = JSON.parse(readFileSync(f, "utf8"));
  for (const x of mod.exercises || []) {
    for (const impl of x.implementation || []) {
      const p = join(ROOT, impl.path);
      if (!existsSync(p)) { console.error(`missing on disk: ${impl.path}`); missing++; continue; }
      impl.content = readFileSync(p, "utf8");
    }
  }
  writeFileSync(f, JSON.stringify(mod, null, 2) + "\n");
  console.log(`embedded ${f}`);
}
process.exit(missing ? 1 : 0);
