#!/usr/bin/env node
// PreToolUse Claude Code hook for the level-2 reviewer (registered in the agent's own frontmatter,
// see docs/tutorials/level-2/examples/reviewer-v1-restricted.md). It is not a Frappe hook.
//
// Allows only:
//   git diff | git log | git show | git status  (read-only git)
//   bench --site test.localhost run-tests [--app spice_lite | --module <dotted> [--test <name>]... | --doctype "<DocType>"] [--failfast]
//     optionally prefixed by `cd <bench dir> && ` and optionally piped `2>&1 | python3 <...>/parse_bench_tests.py`
// Blocks everything else with exit code 2, and names the dangerous bench commands explicitly:
// console and execute run arbitrary Python as Administrator on the site (execute commits), migrate
// changes the schema and runs patches, and the rest change site config or data.
//
// Why a Claude Code hook: `tools` can only include or drop the whole Bash tool, and a
// `disallowedTools` entry such as `Bash(bench *)` removes all of Bash. The hook narrows Bash to a few
// commands whatever permission mode the parent session is in.
//
// Input: hook JSON on stdin (tool_name, tool_input.command, agent_type, ...). Exit 0 = continue to the
// normal permission checks; exit 2 = block, stderr is shown to the subagent. Fails closed.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const BENCH_DIR = process.env.SPICE_BENCH_DIR || "/home/user/frappe-bench";
const SITE = "test.localhost";
const GIT_READ = /^git (diff|log|show|status)( |$)/;
const GIT_RISKY = /(^| )(--output(=| |$)|--ext-diff|--textconv|-c )/;
const SHELL_META = /[;&|<>`\n\r]|\$\(/;
const DANGEROUS_BENCH = /^bench (--\S+ )*(--site \S+ )?(console|execute|migrate|mariadb|postgres|db-console|drop-site|reinstall|restore|set-config|set-admin-password|add-system-manager|install-app|uninstall-app|run-patch|destroy-all-sessions|serve|backup|export-fixtures|trim-database|clear-cache)\b/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CD_PREFIX = new RegExp(`^cd ${esc(BENCH_DIR)} && `);
const PARSER_SUFFIX = / 2>&1 \| python3 [A-Za-z0-9_.\/-]*\.claude\/skills\/run-tests\/scripts\/parse_bench_tests\.py$/;

function runTestsArgsOk(rest) {
  // rest: the text after "bench --site test.localhost run-tests"
  const tokens = rest.match(/"[^"]*"|\S+/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const v = tokens[i + 1];
    if (t === "--failfast") continue;
    if (t === "--app" && v === "spice_lite") { i++; continue; }
    if (t === "--module" && /^spice_lite(\.[a-z0-9_]+)+$/.test(v || "")) { i++; continue; }
    if (t === "--test" && /^test_[a-z0-9_]+$/.test(v || "")) { i++; continue; }
    if (t === "--doctype" && /^("SL [A-Za-z ]+"|'SL [A-Za-z ]+')$/.test(v || "")) { i++; continue; }
    return false;
  }
  return true;
}

export function decide(input) {
  if (!input || typeof input !== "object") return { allow: false, reason: "hook input is not a JSON object" };
  if (input.tool_name !== "Bash") return { allow: true };
  let command = String(input.tool_input?.command ?? "").trim().replace(/[ \t]+/g, " ");
  if (!command) return { allow: false, reason: "empty Bash command" };

  // The two sanctioned compound forms are stripped before the metacharacter check.
  const bare = command.replace(CD_PREFIX, "");
  const isBench = bare.startsWith("bench ");
  if (isBench) command = bare.replace(PARSER_SUFFIX, "");

  if (SHELL_META.test(command)) return { allow: false, reason: `shell operators are not allowed for the reviewer: ${command}` };

  if (GIT_READ.test(command)) {
    if (GIT_RISKY.test(command)) return { allow: false, reason: `git option not allowed for the reviewer: ${command}` };
    return { allow: true };
  }
  if (DANGEROUS_BENCH.test(command)) {
    return {
      allow: false,
      reason: `bench console/execute/migrate and other site-changing bench commands are never allowed for the reviewer; blocked: ${command}`,
    };
  }
  const prefix = `bench --site ${SITE} run-tests`;
  if (command === prefix || command.startsWith(prefix + " ")) {
    if (runTestsArgsOk(command.slice(prefix.length))) return { allow: true };
    return { allow: false, reason: `run-tests arguments not allowed (use --app spice_lite, --module spice_lite.x [--test test_x], --doctype "SL X"): ${command}` };
  }
  return {
    allow: false,
    reason: `reviewer may only run git diff/log/show/status and bench --site ${SITE} run-tests; blocked: ${command}`,
  };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write("reviewer-bash-guard: could not parse hook input; blocking\n");
    process.exit(2);
  }
  const { allow, reason } = decide(input);
  if (!allow) {
    process.stderr.write(`reviewer-bash-guard: ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
