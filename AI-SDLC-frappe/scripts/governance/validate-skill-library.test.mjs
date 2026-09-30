#!/usr/bin/env node
// Runs validate-skill-library.mjs against fixture repositories built in a temp dir.
// Usage: node scripts/governance/validate-skill-library.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "validate-skill-library.mjs");
const SKILL = "---\nname: code-review\ndescription: Review a git diff against context/standards and return findings in the canonical format.\nallowed-tools: Read Grep Glob Bash(git diff *)\n---\n\nReview $ARGUMENTS.\n";
const README = "# code-review\n\n| Field | Value |\n|---|---|\n| Owner | @example-org/spice-core |\n| Version | 1.1.0 |\n";
const CHANGELOG = "# Changelog\n\n## [1.1.0] - 2026-09-30\n### Added\n- ignore_permissions check.\n\n## [1.0.0] - 2026-09-01\n### Added\n- Initial release.\n";
const CASES = JSON.stringify({ cases: [{ id: "cr-1" }, { id: "cr-2" }, { id: "cr-3" }] });
const INDEX = "# Skill library\n\n| Skill | Owner |\n|---|---|\n| `code-review` | @example-org/spice-core |\n";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "skill-lib-"));
  for (const [p, body] of Object.entries(files)) {
    if (body == null) continue;
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}
const good = {
  ".claude/skills/code-review/SKILL.md": SKILL,
  "skills/README.md": INDEX,
  "skills/code-review/README.md": README,
  "skills/code-review/CHANGELOG.md": CHANGELOG,
  "skills/code-review/tests/cases.json": CASES,
};
const cases = [
  { name: "complete skill passes with no warnings", files: good, args: ["--strict"], expect: 0, grep: /0 error\(s\), 0 warning\(s\)/ },
  { name: "missing description is an error", files: { ...good, ".claude/skills/code-review/SKILL.md": SKILL.replace(/description:.*\n/, "") }, expect: 1, grep: /missing `description`/ },
  { name: "missing name is an error", files: { ...good, ".claude/skills/code-review/SKILL.md": SKILL.replace("name: code-review\n", "") }, expect: 1, grep: /missing `name`/ },
  { name: "CHANGELOG without semver heading is an error", files: { ...good, "skills/code-review/CHANGELOG.md": "# Changelog\n\n## Latest\n- stuff\n" }, expect: 1, grep: /no semver heading/ },
  { name: "README version must match latest CHANGELOG entry", files: { ...good, "skills/code-review/README.md": README.replace("1.1.0", "1.0.0") }, expect: 1, grep: /README\.md says Version 1\.0\.0 but the latest CHANGELOG\.md entry is 1\.1\.0/ },
  { name: "missing README is an error", files: { ...good, "skills/code-review/README.md": null }, expect: 1, grep: /skills\/code-review\/README\.md is missing/ },
  { name: "camelCase key is reported as silently ignored", files: { ...good, ".claude/skills/code-review/SKILL.md": SKILL.replace("allowed-tools:", "allowedTools:") }, args: ["--strict"], expect: 1, grep: /unknown front matter key "allowedTools".*hyphenated/ },
  { name: "runtime skill outside the library is a warning only", files: { ...good, ".claude/skills/run-tests/SKILL.md": SKILL.replace(/code-review/g, "run-tests") }, expect: 0, grep: /WARN\s+run-tests: not in the library/ },
  { name: "library entry without runtime skill is an error", files: { ...good, "skills/orphan/README.md": README, "skills/orphan/CHANGELOG.md": CHANGELOG }, expect: 1, grep: /skills\/orphan\/ has no runtime skill/ },
  { name: "invalid cases.json is an error", files: { ...good, "skills/code-review/tests/cases.json": "{ not json" }, expect: 1, grep: /tests\/cases\.json is not valid JSON/ },
];

let failed = 0;
for (const c of cases) {
  const r = spawnSync(process.execPath, [script, "--root", repo(c.files), ...(c.args || [])], { encoding: "utf8" });
  const ok = r.status === c.expect && c.grep.test(r.stdout);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (exit ${r.status}, expected ${c.expect})${ok ? "" : "\n" + r.stdout + r.stderr}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
