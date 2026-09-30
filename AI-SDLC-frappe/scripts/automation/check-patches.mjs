#!/usr/bin/env node
// Deterministic patches.txt gate for a Frappe v15 app. No AI: every rule has one right answer.
//
// How Frappe reads patches.txt (apps/frappe/frappe/modules/patch_handler.py, version-15):
//   - configparser with allow_no_value=True and delimiters="\n": each line in [pre_model_sync] or
//     [post_model_sync] is one patch. `bench migrate` asks for each section by name and throws
//     "Patch type ... not found in patches.txt" if one is missing.
//   - configparser is strict: the same line twice in a section raises DuplicateOptionError and migrate stops.
//   - If the first non-comment line is not a section header, the WHOLE file is read in the old one-patch-per-line
//     format, so "[post_model_sync]" itself would be treated as a patch name.
//   - An indented line is read as a continuation of the previous line; on a value-less patch line that crashes
//     the parser (AttributeError, checked with Python 3.11 configparser).
//   - A patch is recorded in Patch Log by its exact line text: editing a line (even a trailing "#comment")
//     makes the patch run again on every site. A dotted entry imports `<line up to the first space>.execute`.
//
// Errors (exit 1):
//   structure   unknown section, missing section, entries before the first section, indented line
//   duplicate   the same entry twice in one section
//   module      a dotted entry whose module file does not exist or has no `def execute(`
//   order       within a section, patches.vX_Y folders must not go backwards (v0_2 before v0_1)
//   applied     vs the base git ref: an existing line was edited or removed, or a new line was inserted
//               above an existing one (fresh sites and old sites would then run patches in different orders)
// Warnings: execute: one-liners, patch modules under patches/ that no line references.
// Exit 0 = pass, 1 = rule violation, 2 = usage or git error.
//
// Usage (from AI-SDLC-frappe/):
//   node scripts/automation/check-patches.mjs                          # app sample-app/spice_lite/spice_lite, base HEAD
//   node scripts/automation/check-patches.mjs --base origin/main       # in CI on a PR branch
//   node scripts/automation/check-patches.mjs --app path/to/app/app --json
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_APP = join(ROOT, "sample-app", "spice_lite", "spice_lite");
const SECTIONS = ["pre_model_sync", "post_model_sync"];

/** Parse patches.txt text the way Frappe's configparser does. Returns { entries, errors }. */
export function parsePatches(text) {
  const errors = [];
  const entries = []; // { section, line, text }
  let section = null;
  const seen = new Map();
  text.split("\n").forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || /^\s*[#;]/.test(line)) return;
    if (/^\s/.test(line)) {
      errors.push(`structure: line ${lineNo} is indented; configparser reads it as a continuation of the previous line and fails (AttributeError)`);
      return;
    }
    const header = /^\[(.*)\]\s*$/.exec(line);
    if (header) {
      section = header[1];
      if (!SECTIONS.includes(section)) errors.push(`structure: line ${lineNo} unknown section [${section}] (Frappe reads only [pre_model_sync] and [post_model_sync])`);
      if (seen.has(`[${section}]`)) errors.push(`structure: line ${lineNo} section [${section}] appears twice`);
      seen.set(`[${section}]`, lineNo);
      return;
    }
    if (section === null) {
      errors.push(`structure: line ${lineNo} "${line}" comes before the first [section]; Frappe would then read the whole file in the old format`);
      return;
    }
    const key = `${section}\u0000${line}`;
    if (seen.has(key)) errors.push(`duplicate: [${section}] lists "${line}" twice (lines ${seen.get(key)} and ${lineNo}); bench migrate stops with DuplicateOptionError`);
    else seen.set(key, lineNo);
    entries.push({ section, line: lineNo, text: line });
  });
  const hasSections = [...seen.keys()].some((k) => k.startsWith("["));
  if (hasSections) for (const s of SECTIONS) if (!seen.has(`[${s}]`)) errors.push(`structure: section [${s}] is missing; bench migrate throws "Patch type ${s} not found"`);
  return { entries, errors };
}

function moduleOf(text) {
  if (text.startsWith("execute:")) return null;
  return text.replace(/^finally:/, "").split(/\s+/)[0];
}

function versionOf(mod) {
  const m = /\.patches\.v(\d+)_(\d+)(?:_(\d+))?\./.exec(mod || "");
  if (!m) return null;
  const v = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  v.label = `v${m[1]}_${m[2]}${m[3] ? `_${m[3]}` : ""}`;
  return v;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Returns { errors, warnings, info } without printing; exported for tests. */
export function checkPatches({ app = DEFAULT_APP, base = "HEAD" } = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  const file = join(app, "patches.txt");
  if (!existsSync(file)) return { errors: [`patches.txt not found in ${app}`], warnings, info, usage: true };
  const appName = basename(app);
  const appParent = dirname(app); // dotted paths start with the app package name
  const { entries, errors: parseErrors } = parsePatches(readFileSync(file, "utf8"));
  errors.push(...parseErrors);

  // --- module existence
  const referenced = new Set();
  for (const e of entries) {
    const mod = moduleOf(e.text);
    if (mod === null) {
      warnings.push(`execute: line ${e.line} runs inline Python ("${e.text.slice(0, 40)}..."); prefer a patch module with a docstring and a test`);
      continue;
    }
    referenced.add(mod);
    if (!mod.startsWith(`${appName}.`)) {
      errors.push(`module: line ${e.line} "${mod}" does not start with the app name "${appName}."`);
      continue;
    }
    const path = join(appParent, ...mod.split(".")) + ".py";
    if (!existsSync(path)) errors.push(`module: line ${e.line} "${mod}" has no file ${relative(appParent, path)}`);
    else if (!/^def execute\s*\(/m.test(readFileSync(path, "utf8"))) errors.push(`module: line ${e.line} "${mod}" has no top-level def execute()`);
    else info.push(`ok ${e.section} ${mod}`);
  }

  // --- version folders must not go backwards within a section
  for (const s of SECTIONS) {
    let prev = null;
    for (const e of entries.filter((x) => x.section === s)) {
      const v = versionOf(moduleOf(e.text));
      if (!v) continue;
      if (prev && cmp(v, prev.v) < 0) errors.push(`order: line ${e.line} ${v.label} comes after ${prev.v.label} (line ${prev.line}) in [${s}]; append new patches at the end`);
      else prev = { v, line: e.line };
    }
  }

  // --- orphans: patch modules nobody runs
  const patchesDir = join(app, "patches");
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : f.endsWith(".py") && f !== "__init__.py" ? [p] : [];
    });
  if (existsSync(patchesDir)) {
    for (const p of walk(patchesDir)) {
      const mod = [appName, ...relative(app, p).replace(/\.py$/, "").split(/[\\/]/)].join(".");
      if (!referenced.has(mod) && /^def execute\s*\(/m.test(readFileSync(p, "utf8"))) warnings.push(`orphan: ${mod} defines execute() but no patches.txt line runs it`);
    }
  }

  // --- applied lines vs the base ref
  let top;
  try {
    top = git(app, ["rev-parse", "--show-toplevel"]).trim();
    git(app, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch {
    return { errors: [...errors, `git: "${app}" is not in a git repository or base ref "${base}" does not exist`], warnings, info, usage: true };
  }
  const rel = relative(top, file).split("\\").join("/");
  let baseText = null;
  try {
    baseText = git(top, ["show", `${base}:${rel}`]);
  } catch {
    info.push(`patches.txt does not exist at ${base}: every line is new`);
  }
  if (baseText !== null) {
    const old = parsePatches(baseText).entries;
    for (const s of SECTIONS) {
      const before = old.filter((e) => e.section === s).map((e) => e.text);
      const now = entries.filter((e) => e.section === s);
      const nowTexts = now.map((e) => e.text);
      for (const t of before) {
        if (!nowTexts.includes(t)) {
          const mod = moduleOf(t);
          const edited = mod && now.find((e) => moduleOf(e.text) === mod);
          if (edited) errors.push(`applied: [${s}] line ${edited.line} changed "${t}" to "${edited.text}"; Patch Log matches the exact text, so every site would run it again. Add a new patch instead`);
          else errors.push(`applied: [${s}] "${t}" was removed; sites that have not migrated yet would silently skip it`);
        }
      }
      // new lines must all come after the last line that already existed at base
      const lastOld = Math.max(-1, ...now.map((e, i) => (before.includes(e.text) ? i : -1)));
      now.forEach((e, i) => {
        if (before.includes(e.text) || moduleOf(e.text) && before.some((t) => moduleOf(t) === moduleOf(e.text))) return;
        if (i < lastOld) errors.push(`applied: [${s}] new line ${e.line} "${e.text}" is inserted above existing patches; append it at the end of the section`);
        else info.push(`new ${s} ${e.text}`);
      });
    }
  }
  return { errors, warnings, info, base, app: relative(ROOT, app) || "." };
}

function main(argv) {
  const opt = { app: DEFAULT_APP, base: "HEAD", json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") opt.app = resolve(argv[++i]);
    else if (argv[i] === "--base") opt.base = argv[++i];
    else if (argv[i] === "--json") opt.json = true;
    else {
      console.error(`unknown argument: ${argv[i]}\nusage: check-patches.mjs [--app APP_PACKAGE_DIR] [--base REF] [--json]`);
      return 2;
    }
  }
  const r = checkPatches(opt);
  if (opt.json) console.log(JSON.stringify({ ok: r.errors.length === 0, ...r }, null, 2));
  else {
    for (const line of r.info) console.log(`OK     ${line}`);
    for (const line of r.warnings) console.log(`WARN   ${line}`);
    for (const line of r.errors) console.log(`ERROR  ${line}`);
    console.log(r.errors.length ? `FAIL: ${r.errors.length} patches.txt rule violation(s)` : `PASS: patches.txt valid against ${opt.base}`);
  }
  return r.usage ? 2 : r.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
