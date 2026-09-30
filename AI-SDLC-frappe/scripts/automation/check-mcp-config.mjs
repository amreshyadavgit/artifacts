#!/usr/bin/env node
// Deterministic lint for .mcp.json. Encodes the verified format (build/CLAUDE_CODE_FACTS.md section 5)
// plus this repo's secrets policy, so a bad server entry fails in CI before anyone approves it.
//
// Errors (exit 1):
//   - file is not JSON, or has no "mcpServers" object
//   - "type" not one of stdio | http | streamable-http | sse | ws
//   - an entry with "url" but no "type" (Claude Code treats that as an error)
//   - a per-server "scope", "enabled" or "disabled" key (not part of the format; use settings instead)
//   - a header / env value that looks like an inline credential instead of a ${VAR} reference
//   - a remote url that is not https (or wss for ws)
//   - an env entry named like a credential (*_SECRET, *_TOKEN, *_PASSWORD, *_API_KEY, *_PAT) whose value is not a
//     ${VAR} reference, or a stdio command/args/env that points at site_config.json / common_site_config.json
// Warnings (exit 0):
//   - unknown keys for the transport, deprecated "sse", unpinned `npx -y <package>` for stdio
//
// Usage (from AI-SDLC-frappe/): node scripts/automation/check-mcp-config.mjs [path/to/.mcp.json]
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPES = new Set(["stdio", "http", "streamable-http", "sse", "ws"]);
const KEYS = {
  stdio: new Set(["type", "command", "args", "env"]),
  remote: new Set(["type", "url", "headers", "headersHelper", "timeout", "alwaysLoad"]),
};
const FORBIDDEN = ["scope", "enabled", "disabled"];
const SECRET_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bxox[abp]-[A-Za-z0-9-]{10,}/, /\bATATT[A-Za-z0-9_-]{20,}/,
];

function looksInline(value) {
  if (typeof value !== "string") return false;
  if (SECRET_SHAPES.some((re) => re.test(value))) return true;
  // "Bearer abc123..." or "Basic xyz..." with no ${VAR} expansion
  return /^(Bearer|Basic|token)\s+(?!\$\{)[A-Za-z0-9._~+/=-]{8,}$/i.test(value.trim());
}

export function checkMcpConfig(text) {
  const errors = [];
  const warnings = [];
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (e) {
    return { errors: [`not valid JSON: ${e.message}`], warnings };
  }
  if (!cfg || typeof cfg.mcpServers !== "object" || Array.isArray(cfg.mcpServers)) {
    return { errors: ['missing top-level "mcpServers" object'], warnings };
  }
  for (const [name, s] of Object.entries(cfg.mcpServers)) {
    const at = `mcpServers.${name}`;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) warnings.push(`${at}: server name has characters outside A-Z a-z 0-9 _ - (tool names become mcp__<server>__<tool>)`);
    if (s.url !== undefined && s.type === undefined) {
      errors.push(`${at}: has "url" but no "type" (an entry without "type" is stdio)`);
      for (const [k, v] of Object.entries(s.headers || {})) {
        if (looksInline(v)) errors.push(`${at}.headers.${k}: looks like an inline credential; use \${VAR} expansion`);
      }
      continue;
    }
    const type = s.type ?? "stdio";
    if (!TYPES.has(type)) {
      errors.push(`${at}: type "${type}" is not one of ${[...TYPES].join(", ")}`);
      continue;
    }
    for (const k of FORBIDDEN) if (k in s) errors.push(`${at}: "${k}" is not an .mcp.json key (use --scope / enabledMcpjsonServers / disabledMcpjsonServers)`);
    const allowed = type === "stdio" ? KEYS.stdio : KEYS.remote;
    for (const k of Object.keys(s)) if (!allowed.has(k) && !FORBIDDEN.includes(k)) warnings.push(`${at}: unexpected key "${k}" for ${type}`);
    if (type === "sse") warnings.push(`${at}: sse transport is deprecated; prefer http`);
    if (type === "stdio") {
      if (!s.command) errors.push(`${at}: stdio server needs "command"`);
      const args = Array.isArray(s.args) ? s.args : [];
      if (s.command === "npx") {
        const pkg = args.find((a) => !a.startsWith("-"));
        if (pkg && !/@\d/.test(pkg.replace(/^@[^/]+\//, ""))) warnings.push(`${at}: npx package "${pkg}" is not pinned to a version`);
      }
    } else {
      if (!s.url) errors.push(`${at}: ${type} server needs "url"`);
      else {
        const expanded = String(s.url).replace(/\$\{[A-Z0-9_]+:-([^}]*)\}/g, "$1");
        const scheme = type === "ws" ? /^wss:\/\//i : /^https:\/\//i;
        if (!/^\$\{[A-Z0-9_]+\}/.test(expanded) && !scheme.test(expanded)) errors.push(`${at}: url must use ${type === "ws" ? "wss" : "https"}`);
      }
    }
    for (const [k, v] of Object.entries(s.env || {})) {
      if (/(SECRET|TOKEN|PASSWORD|API_KEY|_PAT)$/i.test(k) && typeof v === "string" && v !== "" && !/^\$\{[A-Z0-9_]+(:-)?\}$/.test(v))
        errors.push(`${at}.env.${k}: credential-named variable must be a \${VAR} reference, not a literal value`);
    }
    const argv = [s.command, ...(Array.isArray(s.args) ? s.args : []), ...Object.values(s.env || {})].map(String);
    if (argv.some((a) => /(^|\/)(common_)?site_config\.json\b/.test(a)))
      errors.push(`${at}: references site_config.json; Frappe site secrets must never be handed to an MCP server (use a read-only API user)`);
    for (const [section, obj] of [["headers", s.headers], ["env", s.env]]) {
      for (const [k, v] of Object.entries(obj || {})) {
        if (looksInline(v)) errors.push(`${at}.${section}.${k}: looks like an inline credential; use \${VAR} expansion`);
      }
    }
  }
  return { errors, warnings };
}

function main(argv) {
  const path = resolve(argv[0] || join(ROOT, ".mcp.json"));
  const { errors, warnings } = checkMcpConfig(readFileSync(path, "utf8"));
  for (const w of warnings) console.log(`WARN   ${w}`);
  for (const e of errors) console.log(`ERROR  ${e}`);
  console.log(errors.length ? `FAIL: ${errors.length} error(s) in ${path}` : `PASS: ${path}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
