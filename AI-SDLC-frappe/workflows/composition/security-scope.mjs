#!/usr/bin/env node
// security-scope.mjs: decide from a diff whether the security step of a workflow is mandatory.
//
// Course rule (workflows/feature-delivery.md, "Conditional branch"): the security agent MUST run
// when a change to spice_lite touches any of
//   1. a DocType permissions array (or a field permlevel) in **/doctype/*/*.json
//   2. a whitelisted method: a changed line with @frappe.whitelist / allow_guest, or any change
//      under spice_lite/api/ (where the whitelisted FHIR-lite endpoints live)
//   3. hooks.py (doc_events, fixtures, permission_query_conditions, has_permission, overrides)
//   4. ignore_permissions
// plus two extras that bypass permissions just as quietly:
//   5. an added frappe.db.sql( / frappe.get_all( / frappe.qb. / frappe.db.count( outside tests
//   6. fixtures that ship permission records (Role, DocPerm, Custom DocPerm, User Permission, Role Profile)
// Anything else -> the step may be skipped, and the skip is recorded with the changed paths.
//
// Usage:
//   node workflows/composition/security-scope.mjs <change.patch>            classify a patch file
//   node workflows/composition/security-scope.mjs --git [--base HEAD] [path] classify the working tree
//        (tracked changes against <base> plus untracked files; path defaults to sample-app)
//   add --json for machine-readable output.
// Exit 0 = classified (MANDATORY or SKIP), 2 = usage or git error.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const DOCPERM_KEY = /^\s*"(role|if_owner|read|write|create|delete|submit|cancel|amend|report|export|import|share|print|email|select|permlevel|permissions)"\s*:/;
const PERM_FIXTURE = /"doctype"\s*:\s*"(Role|DocPerm|Custom DocPerm|User Permission|Role Profile)"/;
const BYPASS = /frappe\.db\.sql\(|frappe\.get_all\(|frappe\.qb\.|frappe\.db\.count\(/;
const isTest = (p) => /(^|\/)tests?\//.test(p) || /(^|\/)test_[^/]*\.py$/.test(p);

/** Parse a unified diff into [{ path, added: [{line, text}], removed: [{line, text}] }]. */
export function parseDiff(text) {
  const files = [];
  let cur = null, newLine = 0, oldLine = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^diff --git a\/(\S+) b\/(\S+)/))) { cur = { path: m[2], added: [], removed: [] }; files.push(cur); continue; }
    if ((m = raw.match(/^\+\+\+ (?:b\/)?(\S+)/))) {
      if (m[1] === "/dev/null") continue;
      if (!cur || cur.path !== m[1]) { cur = { path: m[1], added: [], removed: [] }; files.push(cur); }
      continue;
    }
    if (/^--- /.test(raw)) {
      if (!cur) { const o = raw.match(/^--- (?:a\/)?(\S+)/); cur = { path: o ? o[1] : "?", added: [], removed: [] }; files.push(cur); }
      continue;
    }
    if ((m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/))) { oldLine = Number(m[1]); newLine = Number(m[2]); continue; }
    if (!cur) continue;
    if (raw.startsWith("+")) cur.added.push({ line: newLine++, text: raw.slice(1) });
    else if (raw.startsWith("-")) cur.removed.push({ line: oldLine++, text: raw.slice(1) });
    else if (raw.startsWith(" ")) { newLine++; oldLine++; }
  }
  return files;
}

/** Classify parsed files. Returns { mandatory, reasons: [{rule, location, evidence}], paths }. */
export function classify(files) {
  const reasons = [];
  const add = (rule, path, l, why) => reasons.push({ rule, location: `${path}:${l.line}`, evidence: l.text.trim().slice(0, 120), why });
  for (const f of files) {
    const changed = [...f.added.map((l) => ({ ...l, side: "+" })), ...f.removed.map((l) => ({ ...l, side: "-" }))];
    if (/(^|\/)hooks\.py$/.test(f.path) && changed.length) {
      add(3, f.path, changed[0], "hooks.py changed (doc_events, fixtures, permission hooks and overrides live here)");
    }
    if (/\/doctype\/[^/]+\/[^/]+\.json$/.test(f.path)) {
      const hit = changed.find((l) => DOCPERM_KEY.test(l.text));
      if (hit) add(1, f.path, hit, "DocType permissions array or permlevel changed");
    }
    if (/(^|\/)fixtures\/[^/]+\.json$/.test(f.path)) {
      const hit = changed.find((l) => PERM_FIXTURE.test(l.text));
      if (hit) add(6, f.path, hit, "fixture ships permission records (imported with force on every migrate)");
    }
    if (/(^|\/)(common_)?site_config\.json$/.test(f.path)) add(6, f.path, changed[0] || { line: 0, text: "" }, "site config (secrets) changed");
    if (!f.path.endsWith(".py") || isTest(f.path)) continue;
    const wl = changed.find((l) => /frappe\.whitelist|allow_guest/.test(l.text));
    if (wl) add(2, f.path, wl, "whitelisted method added or changed");
    else if (/(^|\/)api\/[^/]+\.py$/.test(f.path) && changed.length) add(2, f.path, changed[0], "spice_lite/api/ changed (whitelisted endpoints)");
    const ip = changed.find((l) => /ignore_permissions/.test(l.text));
    if (ip) add(4, f.path, ip, "ignore_permissions added or removed");
    const by = f.added.find((l) => BYPASS.test(l.text));
    if (by) add(5, f.path, by, "permission-bypassing query added (db.sql, get_all, qb or db.count)");
  }
  reasons.sort((a, b) => a.location.localeCompare(b.location, "en", { numeric: true }));
  return { mandatory: reasons.length > 0, reasons, paths: files.map((f) => f.path).sort() };
}

/** Diff of the working tree against base (tracked) plus untracked files as all-added. */
export function gitDiff(cwd, base = "HEAD", path = "sample-app") {
  const run = (args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let text = run(["diff", "--no-color", "--relative", base, "--", path]);
  const untracked = run(["ls-files", "--others", "--exclude-standard", "--", path]).split("\n").filter(Boolean);
  for (const u of untracked) {
    const p = resolve(cwd, u);
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, "utf8").split("\n");
    if (lines.at(-1) === "") lines.pop();
    text += `diff --git a/${u} b/${u}\nnew file mode 100644\n--- /dev/null\n+++ b/${u}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => "+" + l).join("\n") + "\n";
  }
  return text;
}

export function format(result) {
  if (!result.mandatory) {
    return `SECURITY STEP: SKIP (no security trigger in ${result.paths.length} changed file(s): ${result.paths.join(", ") || "none"})`;
  }
  const rules = [...new Set(result.reasons.map((r) => r.rule))].sort().join(", ");
  return [`SECURITY STEP: MANDATORY (rules ${rules})`, ...result.reasons.map((r) => `- rule ${r.rule} ${r.location}: ${r.why} | ${r.evidence}`)].join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rest = args.filter((a) => a !== "--json");
  let text;
  try {
    if (rest[0] === "--git") {
      let base = "HEAD";
      const bi = rest.indexOf("--base");
      if (bi > 0) { base = rest[bi + 1]; rest.splice(bi, 2); }
      text = gitDiff(process.cwd(), base, rest[1] || "sample-app");
    } else if (rest[0] && existsSync(rest[0])) {
      text = readFileSync(rest[0], "utf8");
    } else {
      console.error("usage: security-scope.mjs <change.patch> | --git [--base REV] [path]  [--json]");
      process.exit(2);
    }
  } catch (e) {
    console.error(`security-scope: ${e.message}`);
    process.exit(2);
  }
  const result = classify(parseDiff(text));
  console.log(json ? JSON.stringify(result, null, 2) : format(result));
}
