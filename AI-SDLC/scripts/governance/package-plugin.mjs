#!/usr/bin/env node
// Package library skills (and optionally roster agents) from this repository into the company-ai
// Claude Code plugin. Source of truth stays in .claude/skills/ and skills/; the plugin is a build
// output that other repositories install.
//
// Usage:
//   node scripts/governance/package-plugin.mjs --out <dir> [--skills a,b] [--agents x,y] [--version 0.2.0]
//   --skills  default: every skill with skills/<name>/CHANGELOG.md (i.e. released library skills)
//   --agents  default: none. Plugin agents IGNORE permissionMode, hooks and mcpServers, so an agent
//             that relies on them loses those controls when shipped in a plugin; this script warns.
// Then: claude plugin validate <dir>   and   claude --plugin-dir <dir>
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "./lib/frontmatter.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const outArg = arg("out");
if (!outArg) { console.error("usage: package-plugin.mjs --out <dir> [--skills a,b] [--agents x,y] [--version x.y.z]"); process.exit(2); }
const OUT = resolve(outArg);
if (OUT === ROOT || OUT === join(ROOT, "company-ai") || ROOT.startsWith(OUT + "/")) { console.error("refusing to write into the repository source tree; choose a build directory"); process.exit(2); }

const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const released = existsSync(join(ROOT, "skills"))
  ? readdirSync(join(ROOT, "skills")).filter((d) => existsSync(join(ROOT, "skills", d, "CHANGELOG.md")))
  : [];
const skills = list(arg("skills")) || released;
const agents = list(arg("agents")) || [];
const warnings = [];
const errors = [];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
// 1. Plugin skeleton: manifest, README, CHANGELOG, plugin-native skills.
cpSync(join(ROOT, "company-ai"), OUT, { recursive: true });

// 2. Library skills: runtime folder + the library CHANGELOG/README travel with the skill.
const packaged = [];
for (const name of skills) {
  const src = join(ROOT, ".claude/skills", name);
  if (!existsSync(join(src, "SKILL.md"))) { errors.push(`skill ${name}: .claude/skills/${name}/SKILL.md not found`); continue; }
  const text = readFileSync(join(src, "SKILL.md"), "utf8");
  const { frontmatter: fm } = splitFrontmatter(text);
  if (!fm?.name || !fm?.description) { errors.push(`skill ${name}: SKILL.md needs name and description`); continue; }
  if (/(^|[\s`"'(])\.claude\/skills\//.test(text)) {
    warnings.push(`skill ${name}: SKILL.md uses project-relative paths (.claude/skills/...). In a plugin use \${CLAUDE_SKILL_DIR} or \${CLAUDE_PLUGIN_ROOT} instead.`);
  }
  if (/scripts\/(automation|governance)\//.test(text)) warnings.push(`skill ${name}: depends on repository scripts (scripts/...) that are not shipped in the plugin.`);
  const dest = join(OUT, "skills", name);
  cpSync(src, dest, { recursive: true });
  for (const f of ["README.md", "CHANGELOG.md"]) {
    const p = join(ROOT, "skills", name, f);
    if (existsSync(p)) cpSync(p, join(dest, `LIBRARY-${f}`));
  }
  const cl = existsSync(join(ROOT, "skills", name, "CHANGELOG.md")) ? readFileSync(join(ROOT, "skills", name, "CHANGELOG.md"), "utf8") : "";
  const v = /^##\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?/m.exec(cl);
  packaged.push(`${name}@${v ? v[1] : "unreleased"}`);
}

// 3. Agents (opt-in).
for (const name of agents) {
  const src = join(ROOT, ".claude/agents", `${name}.md`);
  if (!existsSync(src)) { errors.push(`agent ${name}: .claude/agents/${name}.md not found`); continue; }
  const { frontmatter: fm } = splitFrontmatter(readFileSync(src, "utf8"));
  const dropped = ["permissionMode", "hooks", "mcpServers", "initialPrompt"].filter((k) => fm && fm[k] !== undefined);
  if (dropped.length) warnings.push(`agent ${name}: plugin agents ignore ${dropped.join(", ")}; the packaged agent runs WITHOUT those controls. Enforce them with the consumer's settings.json instead.`);
  mkdirSync(join(OUT, "agents"), { recursive: true });
  cpSync(src, join(OUT, "agents", `${name}.md`));
}

// 4. Bundle the validator so skill-library-check works in any repository.
mkdirSync(join(OUT, "scripts/lib"), { recursive: true });
cpSync(join(ROOT, "scripts/governance/validate-skill-library.mjs"), join(OUT, "scripts/validate-skill-library.mjs"));
cpSync(join(ROOT, "scripts/governance/lib/frontmatter.mjs"), join(OUT, "scripts/lib/frontmatter.mjs"));

// 5. Version stamp.
const manifestPath = join(OUT, ".claude-plugin/plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = arg("version");
if (version) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) { console.error(`--version ${version} is not semver`); process.exit(2); }
  manifest.version = version;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const count = (d) => (existsSync(join(OUT, d)) ? readdirSync(join(OUT, d)).filter((x) => !x.startsWith(".") && (statSync(join(OUT, d, x)).isDirectory() || x.endsWith(".md"))).length : 0);
console.log(`Packaged ${manifest.name}@${manifest.version} into ${OUT}`);
console.log(`  skills: ${count("skills")} (${["skill-library-check (plugin-native)", ...packaged].join(", ")})`);
console.log(`  agents: ${count("agents")}${agents.length ? ` (${agents.join(", ")})` : ""}`);
for (const w of warnings) console.log(`WARN   ${w}`);
for (const e of errors) console.log(`ERROR  ${e}`);
console.log(`Next: claude plugin validate ${outArg}   then   claude --plugin-dir ${outArg}`);
process.exit(errors.length ? 1 : 0);
