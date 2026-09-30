#!/usr/bin/env node
// Validate the skill library: runtime skills (.claude/skills/<name>/SKILL.md) and their
// engineering assets (skills/<name>/README.md, CHANGELOG.md, tests/cases.json).
// Policy: skills/README.md.
//
// Usage: node scripts/governance/validate-skill-library.mjs [--root <AI-SDLC dir>] [--strict] [--json]
// Exit 0 = no errors (warnings allowed unless --strict), 1 = errors.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "./lib/frontmatter.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = resolve(arg("root", resolve(dirname(fileURLToPath(import.meta.url)), "../..")));
const STRICT = process.argv.includes("--strict");

// Skill frontmatter keys documented by Claude Code (skills docs). Anything else is silently
// ignored by Claude Code, which is exactly why a typo such as `allowedTools` must be reported.
const KNOWN_KEYS = new Set([
  "name", "description", "when_to_use", "argument-hint", "arguments", "disable-model-invocation",
  "user-invocable", "allowed-tools", "disallowed-tools", "model", "effort", "context", "agent",
  "background", "hooks", "paths", "shell", "metadata", "license", "compatibility",
]);
// Keys accepted by claude.ai uploads / the Skills API; anything else there is a hard error.
const PORTABLE_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const SEMVER = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s|$)/m;
const SEMVER_ALL = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s|$)/gm;

const findings = []; // {level, skill, message}
const add = (level, skill, message) => findings.push({ level, skill, message });
const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()).sort() : []);

const runtimeDir = join(ROOT, ".claude/skills");
const libraryDir = join(ROOT, "skills");
const runtime = dirs(runtimeDir);
const library = dirs(libraryDir);
const rows = new Map();
const row = (name) => rows.get(name) || rows.set(name, { name, skillMd: "-", version: "-", owner: "-", tests: "-", portable: "-" }).get(name);

// 1. Runtime skills
for (const name of runtime) {
  const r = row(name);
  const file = join(runtimeDir, name, "SKILL.md");
  if (!existsSync(file)) { add("error", name, `.claude/skills/${name}/ has no SKILL.md (work in progress, or remove the folder)`); r.skillMd = "missing"; continue; }
  const text = readFileSync(file, "utf8");
  const { frontmatter: fm, error } = splitFrontmatter(text);
  if (!fm) { add("error", name, `SKILL.md has no YAML front matter${error ? ` (${error})` : ""}`); r.skillMd = "no-frontmatter"; continue; }
  r.skillMd = "ok";
  if (!fm.name) add("error", name, "SKILL.md front matter is missing `name` (library policy requires it even though Claude Code defaults it to the folder name)");
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(fm.name))) add("error", name, `name "${fm.name}" must be lowercase kebab-case (no ":" or spaces)`);
    if (String(fm.name) !== name) add("warn", name, `name "${fm.name}" differs from folder "${name}"; the slash command becomes /${fm.name}`);
  }
  if (!fm.description) add("error", name, "SKILL.md front matter is missing `description` (Claude uses it to decide when to load the skill)");
  else {
    const len = String(fm.description).length + String(fm.when_to_use || "").length;
    if (len > 1536) add("warn", name, `description + when_to_use is ${len} chars; the skill listing truncates at 1,536`);
    if (String(fm.description).length < 40) add("warn", name, "description is under 40 chars; say what the skill does AND when to use it");
  }
  const keys = Object.keys(fm);
  for (const k of keys) if (!KNOWN_KEYS.has(k)) add("warn", name, `unknown front matter key "${k}" is silently ignored by Claude Code${/[A-Z]/.test(k) ? " (skill keys are hyphenated, e.g. allowed-tools)" : ""}`);
  r.portable = keys.every((k) => PORTABLE_KEYS.has(k)) ? "yes" : "no";
  const lines = text.split("\n").length;
  if (lines > 500) add("warn", name, `SKILL.md is ${lines} lines; keep it under 500 and move reference material to supporting files`);
  if (fm["disable-model-invocation"] === true && fm["user-invocable"] === false) add("error", name, "disable-model-invocation: true and user-invocable: false make the skill unreachable");
  if (!library.includes(name)) add("warn", name, `not in the library: add skills/${name}/ with README.md, CHANGELOG.md and tests/cases.json`);
}

// 1b. Plugin-native skills (company-ai/skills/<name>/SKILL.md): same front matter rules.
const pluginSkillsDir = join(ROOT, "company-ai/skills");
for (const name of dirs(pluginSkillsDir)) {
  const file = join(pluginSkillsDir, name, "SKILL.md");
  const tag = `company-ai:${name}`;
  if (!existsSync(file)) { add("error", tag, `company-ai/skills/${name}/ has no SKILL.md`); continue; }
  const { frontmatter: fm } = splitFrontmatter(readFileSync(file, "utf8"));
  if (!fm?.name) add("error", tag, "SKILL.md front matter is missing `name`");
  if (!fm?.description) add("error", tag, "SKILL.md front matter is missing `description`");
  for (const k of Object.keys(fm || {})) if (!KNOWN_KEYS.has(k)) add("warn", tag, `unknown front matter key "${k}" is silently ignored by Claude Code`);
}

// 2. Library assets
const indexText = existsSync(join(libraryDir, "README.md")) ? readFileSync(join(libraryDir, "README.md"), "utf8") : "";
if (!indexText) add("error", "(library)", "skills/README.md (library index and policy) is missing");
for (const name of library) {
  const r = row(name);
  const base = join(libraryDir, name);
  if (!runtime.includes(name)) add("error", name, `skills/${name}/ has no runtime skill at .claude/skills/${name}/SKILL.md`);
  const readmeFile = join(base, "README.md");
  const changelogFile = join(base, "CHANGELOG.md");
  let readmeVersion = null;
  if (!existsSync(readmeFile)) add("error", name, `skills/${name}/README.md is missing`);
  else {
    const readme = readFileSync(readmeFile, "utf8");
    const owner = /\bowner\b[*_]*\s*[:|]\s*[*_]*\s*([^\s|*]+)/i.exec(readme);
    const version = /\bversion\b[*_]*\s*[:|]\s*[*_`]*\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i.exec(readme);
    if (owner) r.owner = owner[1]; else add("warn", name, "README.md does not declare an Owner (e.g. `Owner: @example-org/fhir-platform`)");
    if (version) readmeVersion = version[1]; else add("warn", name, "README.md does not declare a Version (e.g. `Version: 1.0.0`)");
  }
  if (!existsSync(changelogFile)) add("error", name, `skills/${name}/CHANGELOG.md is missing`);
  else {
    const cl = readFileSync(changelogFile, "utf8");
    const m = SEMVER.exec(cl);
    if (!m) add("error", name, "CHANGELOG.md has no semver heading (expected e.g. `## [1.0.0] - 2026-09-30`)");
    else {
      r.version = m[1];
      if (readmeVersion && readmeVersion !== m[1]) add("error", name, `README.md says Version ${readmeVersion} but the latest CHANGELOG.md entry is ${m[1]}`);
      const all = [...cl.matchAll(SEMVER_ALL)].map((x) => x[1].split("-")[0].split(".").map(Number));
      for (let i = 1; i < all.length; i++) {
        const [a, b] = [all[i - 1], all[i]];
        const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
        if (newer <= 0) { add("warn", name, `CHANGELOG.md versions are not in descending order (${a.join(".")} before ${b.join(".")})`); break; }
      }
    }
  }
  const casesFile = join(base, "tests/cases.json");
  if (!existsSync(casesFile)) { add("warn", name, `skills/${name}/tests/cases.json is missing (golden cases for the skill)`); r.tests = "missing"; }
  else {
    try {
      const data = JSON.parse(readFileSync(casesFile, "utf8"));
      const n = Array.isArray(data) ? data.length : Array.isArray(data.cases) ? data.cases.length : 0;
      r.tests = String(n);
      if (n < 3) add("warn", name, `tests/cases.json has ${n} case(s); the policy asks for at least 3`);
    } catch (e) {
      add("error", name, `tests/cases.json is not valid JSON: ${e.message}`);
      r.tests = "invalid";
    }
  }
  if (indexText && !indexText.includes(`\`${name}\``) && !indexText.includes(`skills/${name}/`)) add("warn", name, "not listed in the skills/README.md index");
}

const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ root: ROOT, skills: [...rows.values()], findings }, null, 2));
} else {
  const head = ["skill", "SKILL.md", "version", "owner", "tests", "portable"];
  const data = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.name, r.skillMd, r.version, r.owner, r.tests, r.portable]);
  const w = head.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)));
  const fmt = (r) => r.map((c, i) => c.padEnd(w[i])).join("  ");
  console.log(`Skill library report for ${ROOT}\n`);
  console.log(fmt(head));
  for (const d of data) console.log(fmt(d));
  console.log("");
  for (const f of [...errors, ...warns]) console.log(`${f.level === "error" ? "ERROR" : "WARN "}  ${f.skill}: ${f.message}`);
  console.log(`\n${runtime.length} runtime skill(s), ${library.length} library entr${library.length === 1 ? "y" : "ies"}: ${errors.length} error(s), ${warns.length} warning(s)`);
}
process.exit(errors.length || (STRICT && warns.length) ? 1 : 0);
