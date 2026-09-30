#!/usr/bin/env node
// Deterministic Flyway migration gate. No AI: every rule here has one right answer.
//
// Fails (exit 1) when:
//   1. a file in the migration dir does not follow the naming rule  V<version>__<snake_case>.sql
//      (or R__<snake_case>.sql for repeatable migrations);
//   2. two files share a version, or versions have a gap (team rule: contiguous 1..n);
//   3. a versioned migration that exists at the base git ref (= already applied somewhere) was
//      modified or deleted in the working tree, or a new migration sorts below the highest
//      applied version (out-of-order insertion).
// Exit 0 = all good, exit 1 = rule violation, exit 2 = usage / environment error.
//
// Usage (from AI-SDLC/):
//   node scripts/automation/check-flyway-migrations.mjs                       # base ref HEAD
//   node scripts/automation/check-flyway-migrations.mjs --base origin/main    # in CI on a PR branch
//   node scripts/automation/check-flyway-migrations.mjs --dir path/to/migration --json
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_DIR = join(ROOT, "sample-app", "src", "main", "resources", "db", "migration");
const VERSIONED = /^V(\d+)__([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const REPEATABLE = /^R__([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
}

/** Returns { errors: [...], info: [...] } without printing; exported for tests. */
export function checkMigrations({ dir = DEFAULT_DIR, base = "HEAD" } = {}) {
  const errors = [];
  const info = [];
  if (!existsSync(dir)) return { errors: [`migration dir not found: ${dir}`], info, usage: true };

  // --- 1. naming
  const files = readdirSync(dir).filter((f) => !f.startsWith("."));
  const versions = new Map(); // version -> [files]
  for (const f of files) {
    const v = VERSIONED.exec(f);
    if (v) {
      const n = Number(v[1]);
      versions.set(n, [...(versions.get(n) || []), f]);
    } else if (!REPEATABLE.test(f)) {
      errors.push(`naming: "${f}" must match V<version>__<snake_case>.sql or R__<snake_case>.sql`);
    }
  }

  // --- 2. duplicates and gaps
  const sorted = [...versions.keys()].sort((a, b) => a - b);
  for (const [n, fs] of versions) if (fs.length > 1) errors.push(`duplicate version V${n}: ${fs.join(", ")}`);
  sorted.forEach((n, i) => {
    if (n !== i + 1) errors.push(`gap: expected V${i + 1} before V${n} (versions must be contiguous from V1)`);
  });
  if (errors.some((e) => e.startsWith("gap"))) {
    // report the first gap only; later ones are consequences
    const first = errors.findIndex((e) => e.startsWith("gap"));
    for (let i = errors.length - 1; i > first; i--) if (errors[i].startsWith("gap")) errors.splice(i, 1);
  }

  // --- 3. immutability against the base ref
  let top;
  try {
    top = git(dir, ["rev-parse", "--show-toplevel"]).toString().trim();
    git(dir, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch {
    return { errors: [...errors, `git: "${dir}" is not in a git repository or base ref "${base}" does not exist`], info, usage: true };
  }
  const rel = relative(top, resolve(dir)).split("\\").join("/");
  const applied = git(top, ["ls-tree", "--name-only", base, `${rel}/`])
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((p) => p.slice(rel.length + 1))
    .filter((f) => VERSIONED.test(f));
  const maxApplied = Math.max(0, ...applied.map((f) => Number(VERSIONED.exec(f)[1])));

  for (const f of applied) {
    const committed = git(top, ["show", `${base}:${rel}/${f}`]);
    const path = join(dir, f);
    if (!existsSync(path)) {
      errors.push(`immutability: applied migration ${f} was deleted (it exists at ${base})`);
      continue;
    }
    const current = readFileSync(path);
    if (!current.equals(committed)) {
      errors.push(
        `immutability: applied migration ${f} changed vs ${base} ` +
          `(crc32 ${crc32(committed).toString(16)} -> ${crc32(current).toString(16)}). Add a new V${maxApplied + 1}__*.sql instead.`
      );
    } else {
      info.push(`unchanged ${f} crc32=${crc32(current).toString(16)}`);
    }
  }
  for (const n of sorted) {
    for (const f of versions.get(n)) {
      if (applied.includes(f)) continue;
      if (n <= maxApplied) errors.push(`out-of-order: new migration ${f} has version <= highest applied V${maxApplied}`);
      else info.push(`new ${f}`);
    }
  }
  return { errors, info, base, dir: relative(ROOT, dir) || "." };
}

function main(argv) {
  const opt = { dir: DEFAULT_DIR, base: "HEAD", json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") opt.dir = resolve(argv[++i]);
    else if (argv[i] === "--base") opt.base = argv[++i];
    else if (argv[i] === "--json") opt.json = true;
    else {
      console.error(`unknown argument: ${argv[i]}\nusage: check-flyway-migrations.mjs [--dir DIR] [--base REF] [--json]`);
      return 2;
    }
  }
  const r = checkMigrations(opt);
  if (opt.json) console.log(JSON.stringify({ ok: r.errors.length === 0, ...r }, null, 2));
  else {
    for (const line of r.info) console.log(`OK     ${line}`);
    for (const line of r.errors) console.log(`ERROR  ${line}`);
    console.log(r.errors.length ? `FAIL: ${r.errors.length} migration rule violation(s)` : `PASS: migrations valid against ${opt.base}`);
  }
  return r.usage ? 2 : r.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
