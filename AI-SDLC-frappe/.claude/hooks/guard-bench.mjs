#!/usr/bin/env node
// PreToolUse Claude Code hook for Bash (matcher "Bash"): a human gate on bench commands and a hard
// stop on anything that would print site secrets.
//
// Why a hook on top of the permission rules in .claude/settings.json:
//   - Rules match the command text from the start. `bench --site * migrate` does not match
//     `bench --verbose --site test.localhost migrate`, `bench migrate` (default site from `bench use`),
//     `./env/bin/bench --site=test.localhost migrate`, or a bench call inside `su - frappe -c "..."`.
//     The hook tokenises the command, finds every bench invocation (also inside quoted strings)
//     and classifies its subcommand, so all of those spellings get the same decision.
//   - Rules cannot express "deny any command that names site_config.json".
//
// Decisions (JSON on stdout, exit 0; https://code.claude.com/docs/en/hooks, PreToolUse):
//   deny : prints or opens secrets (show-config, DB shells, site_config.json in any command,
//          execute of frappe.get_site_config / generate_keys), destroys or replaces data
//          (drop-site, reinstall, restore, trim-*), weakens access (set-password, add-system-manager,
//          browse, ngrok), or targets `--site all` with a write command.
//   ask  : changes schema, data or site config (migrate, console, execute, install-app, run-patch,
//          set-config, export-fixtures, backup, ...), run-tests on a site other than test.localhost,
//          bench-level changes (update, get-app, setup, new-site), and any unknown subcommand.
//   none : read-only or allow-listed commands (run-tests on test.localhost, list-apps, version, ...),
//          so the normal permission rules decide.
// Exit 2 only when the hook input cannot be parsed (fail closed).
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TEST_SITE = "test.localhost";

const DENY = {
  "show-config": "prints site_config.json (db_password, encryption_key) to stdout",
  mariadb: "opens a database shell with the site's credentials",
  postgres: "opens a database shell with the site's credentials",
  "db-console": "opens a database shell with the site's credentials",
  jupyter: "starts a notebook server with full site access",
  "drop-site": "destroys a site and its database",
  reinstall: "wipes and reinstalls the site database",
  restore: "replaces the site database from a backup",
  "partial-restore": "overwrites tables from a backup",
  "trim-database": "drops tables",
  "trim-tables": "drops columns",
  "clear-log-table": "deletes audit and log rows",
  "transform-database": "changes table engines or row formats",
  "migrate-to": "moves the site to another host",
  "remove-from-installed-apps": "edits the installed-apps list without uninstalling",
  "set-admin-password": "changes the Administrator password",
  "set-password": "changes a user's password",
  "add-system-manager": "grants System Manager",
  "destroy-all-sessions": "logs every user out",
  browse: "creates a login session for a user",
  ngrok: "exposes the site on a public URL",
};
const ASK = {
  migrate: "applies DocType JSON, patches and fixtures to the site database",
  console: "opens an IPython shell that can read and write any document",
  execute: "runs arbitrary Python as Administrator and commits",
  "install-app": "installs an app (after_install, fixtures, schema) on the site",
  "uninstall-app": "removes an app and drops its DocType tables",
  "run-patch": "runs a data or schema patch",
  "set-config": "writes site_config.json",
  "reload-doc": "re-syncs a DocType from JSON",
  "reload-doctype": "re-syncs a DocType from JSON",
  "export-fixtures": "rewrites fixtures JSON from the site",
  "import-doc": "writes documents into the site",
  "data-import": "writes documents into the site",
  "bulk-rename": "renames documents",
  "add-user": "creates a user",
  "disable-user": "disables a user",
  "reset-perms": "resets DocType permissions to their defaults",
  "add-database-index": "changes the schema",
  "set-maintenance-mode": "takes the site offline",
  "enable-scheduler": "starts scheduled jobs",
  "disable-scheduler": "stops scheduled jobs",
  "trigger-scheduler-event": "runs scheduled jobs now",
  "purge-jobs": "deletes queued jobs",
  "clear-cache": "clears the site cache",
  "clear-website-cache": "clears the website cache",
  backup: "writes a full database dump (PHI) to disk",
  "export-csv": "exports documents (PHI) to a file",
  "export-json": "exports documents (PHI) to a file",
  "export-doc": "exports a document (PHI) to a file",
  "new-site": "creates a site and a database",
  "new-app": "creates an app",
  "make-app": "creates an app",
  "get-app": "downloads and installs third-party code",
  update: "pulls, migrates and rebuilds every app on the bench",
  setup: "rewrites bench, supervisor or nginx configuration",
  restart: "restarts bench processes",
  "remove-app": "removes an app from the bench",
  use: "changes the default site",
  "set-last-active-for-user": "writes user data",
  "create-rq-users": "writes redis ACL users",
  request: "sends a request as Administrator",
  "publish-realtime": "publishes a realtime event",
  "add-to-email-queue": "queues outbound email",
  "run-parallel-tests": "runs tests (commits test records)",
  "start-recording": "records every SQL query of the site",
  "stop-recording": "stops the SQL recorder",
  "rebuild-global-search": "rewrites the global search index",
  "build-search-index": "rewrites the search index",
};
const PASS = new Set([
  "list-apps", "version", "doctor", "show-pending-jobs", "describe-database-table", "ready-for-migration",
  "build", "watch", "serve", "worker", "schedule", "scheduler", "--version", "--help", "src", "find",
]);
// execute targets that read secrets or mint credentials: deny even though execute itself is "ask".
const EXECUTE_DENY = /(^|\.)(get_site_config|get_conf|get_common_site_config)$|^frappe\.conf\b|generate_keys$|\bget_decrypted_password$|\bset_encrypted_password$/;
const SECRET_FILE = /\b(common_)?site_config\.json\b/;
const WRAPPERS = new Set(["sudo", "env", "nice", "time", "timeout", "nohup", "flock", "xargs", "docker", "kubectl", "ssh", "command", "exec"]);
const WRITE_ON_ALL = new Set([...Object.keys(ASK), ...Object.keys(DENY), "run-tests"]);

// Minimal POSIX-ish tokenizer: quotes, backslash escapes, and the separators ; & | ( ) and newlines.
export function tokenize(cmd) {
  const out = [];
  let cur = "";
  let quoted = false;
  let q = null;
  const push = () => { if (cur !== "" || quoted) out.push({ t: cur, quoted }); cur = ""; quoted = false; };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      if (ch === q) { q = null; continue; }
      if (ch === "\\" && q === '"' && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; quoted = true; continue; }
    if (ch === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
    if (/\s/.test(ch)) { if (ch === "\n") { push(); out.push({ t: ";", sep: true }); } else push(); continue; }
    if (";&|()".includes(ch)) { push(); out.push({ t: ch, sep: true }); continue; }
    cur += ch;
  }
  push();
  return out;
}

// Find every bench invocation: [{site, sub, args}], including
// `su - frappe -c "cd ~/frappe-bench && bench --site x migrate"`.
export function findBenchCalls(cmd, depth = 0) {
  const toks = tokenize(cmd);
  const calls = [];
  let segStart = 0;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.sep) { segStart = i + 1; continue; }
    // A quoted string handed to a shell runner (`su - frappe -c "..."`, `bash -lc '...'`, `eval "..."`,
    // `ssh host "..."`) is parsed again as a command. Other quoted arguments (grep patterns) are not.
    const runner = i > 0 && !toks[i - 1].sep && (/^(-[a-z]*c|eval)$/.test(toks[i - 1].t) || toks[segStart].t === "ssh");
    if (tk.quoted && runner && depth < 3) { calls.push(...findBenchCalls(tk.t, depth + 1)); continue; }
    const base = tk.t.split("/").pop();
    if (base !== "bench" || tk.quoted) continue;
    // bench counts when it is the command of its segment, or runs under a wrapper
    // (sudo -u frappe bench ..., docker compose exec backend bench ..., flock /tmp/x bench ...).
    let f = segStart;
    while (f < i && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[f].t)) f++; // SITE=x bench ...
    if (i !== f && !WRAPPERS.has(toks[f].t.split("/").pop())) continue;
    let site = null;
    let sub = null;
    const args = [];
    let k = i + 1;
    for (; k < toks.length && !toks[k].sep; k++) {
      const a = toks[k].t;
      if (sub === null) {
        if (a === "--site" && k + 1 < toks.length && !toks[k + 1].sep) { site = toks[++k].t; continue; }
        if (a.startsWith("--site=")) { site = a.slice(7); continue; }
        if (a === "--version" || a === "--help") { sub = a; continue; }
        if (a.startsWith("-")) continue; // global flags such as --verbose, --profile, --force
        sub = a;
      } else args.push(a);
    }
    calls.push({ site, sub: sub || "(none)", args });
    i = k - 1;
  }
  return calls;
}

export function decide(input) {
  if (String(input.tool_name || "") !== "Bash") return null;
  const cmd = String(input.tool_input?.command || "");
  if (SECRET_FILE.test(cmd)) {
    return { permissionDecision: "deny", permissionDecisionReason: "guard-bench: the command names site_config.json / common_site_config.json, which hold db_password and encryption_key. Agents never read or print them (context/security/phi-and-secrets-policy.md). Ask a human to check the one key you need." };
  }
  const calls = findBenchCalls(cmd);
  if (!calls.length) return null;
  let ask = null;
  for (const c of calls) {
    const where = c.site ? ` --site ${c.site}` : " (default site)";
    const label = `bench${where} ${c.sub}`;
    if (DENY[c.sub]) return { permissionDecision: "deny", permissionDecisionReason: `guard-bench: \`${label}\` ${DENY[c.sub]}. A human runs it outside Claude Code (docs/governance/approval-gates.md, gate G6).` };
    if (c.site === "all" && WRITE_ON_ALL.has(c.sub)) return { permissionDecision: "deny", permissionDecisionReason: `guard-bench: \`${label}\` targets every site on the bench. Agents work on ${TEST_SITE} only; fleet-wide commands are run by a human.` };
    if (c.sub === "execute") {
      const target = c.args.find((a) => !a.startsWith("-")) || "";
      if (EXECUTE_DENY.test(target)) return { permissionDecision: "deny", permissionDecisionReason: `guard-bench: \`${label} ${target}\` reads secrets or issues API credentials. API keys are generated by a System Manager for a named integration user (docs/governance/secrets.md).` };
    }
    if (c.sub === "run-tests" || c.sub === "run-parallel-tests") {
      if (c.site !== TEST_SITE) ask ??= `guard-bench: \`${label}\` runs tests on a site other than ${TEST_SITE}. Frappe test runs commit test records (make_test_records), so a human confirms the target site.`;
      continue;
    }
    if (ASK[c.sub]) { ask ??= `guard-bench: \`${label}\` ${ASK[c.sub]}. Approve only if you asked for this on this site${c.site && c.site !== TEST_SITE ? " (NOT the test site)" : ""}.`; continue; }
    if (PASS.has(c.sub)) continue;
    ask ??= `guard-bench: unknown bench subcommand \`${c.sub}\`; a human decides (fail closed to ask).`;
  }
  return ask ? { permissionDecision: "ask", permissionDecisionReason: ask } : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.stderr.write("guard-bench: could not parse hook input; blocking to be safe.\n");
    process.exit(2);
  }
  const d = decide(input);
  if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...d } }) + "\n");
  process.exit(0);
}
