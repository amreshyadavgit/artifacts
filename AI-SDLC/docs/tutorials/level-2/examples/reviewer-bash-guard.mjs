#!/usr/bin/env node
// PreToolUse hook for the reviewer subagent (registered in the agent's own frontmatter, see
// docs/tutorials/level-2/examples/reviewer-v1-restricted.md). It lets the reviewer run read-only
// git commands and blocks every other Bash command with exit code 2.
//
// Why a hook: `tools` can only include or exclude the whole Bash tool, and a `disallowedTools`
// entry such as `Bash(git push *)` removes Bash entirely. The hook narrows Bash to a few
// commands, whatever permission mode the parent session is in.
//
// Input: hook JSON on stdin (tool_name, tool_input.command, agent_type, ...).
// Exit 0 = allow the call to continue to normal permission checks. Exit 2 = block; stderr is
// shown to the subagent. Fails closed: unreadable input also exits 2.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ALLOWED = /^git (diff|log|show|status)( |$)/;
// Shell metacharacters that could chain, redirect or substitute a second command.
const SHELL_META = /[;&|<>`\n\r]|\$\(/;
// git options that write files or run external programs.
const RISKY_OPTIONS = /(^| )(--output(=| |$)|--ext-diff|--textconv|-c )/;

export function decide(input) {
  if (!input || typeof input !== "object") return { allow: false, reason: "hook input is not a JSON object" };
  if (input.tool_name !== "Bash") return { allow: true };
  const raw = String(input.tool_input?.command ?? "");
  if (SHELL_META.test(raw)) return { allow: false, reason: `shell operators are not allowed for the reviewer: ${raw.trim()}` };
  const command = raw.trim().replace(/\s+/g, " ");
  if (!command) return { allow: false, reason: "empty Bash command" };
  if (!ALLOWED.test(command)) {
    return { allow: false, reason: `reviewer may only run git diff, git log, git show or git status; blocked: ${command}` };
  }
  if (RISKY_OPTIONS.test(command)) return { allow: false, reason: `git option not allowed for the reviewer: ${command}` };
  return { allow: true };
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
