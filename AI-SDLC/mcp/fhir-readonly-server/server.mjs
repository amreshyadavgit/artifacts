#!/usr/bin/env node
// fhir-readonly: a zero-dependency MCP server (stdio transport) over a SYNTHETIC FHIR-lite dataset.
//
// Purpose (course module 06-mcp-and-tooling-architecture): give agents database-shaped answers
// (schema, aggregate counts, ids, query plans) without ever returning PHI.
//
// Wire format (MCP stdio transport): one JSON-RPC 2.0 message per line on stdin/stdout, no embedded
// newlines. stdout carries ONLY protocol messages; logs go to stderr (ids and counts only).
//
// Protocol eras (checked against modelcontextprotocol.io on 2026-09-30):
//   - Legacy (2025-11-25 and earlier): client sends `initialize`, then `notifications/initialized`,
//     then tools/list and tools/call. This is what Claude Code uses for stdio servers by default.
//   - Modern (2026-07-28): no handshake; every request carries
//     params._meta["io.modelcontextprotocol/protocolVersion"]; servers MUST implement
//     `server/discover`; results carry resultType: "complete" (list/discover results also need
//     ttlMs and cacheScope, per schema/2026-07-28/schema.json); an unsupported version gets
//     error -32022 with data { supported, requested }.
//   This server is "dual-era": it answers both.
//
// PHI rules enforced here (context/security/phi-and-secrets-policy.md):
//   1. No tool returns Patient demographics or observation values. Aggregates and opaque ids only.
//   2. Counts below MIN_CELL_SIZE are suppressed ("<5") so small groups cannot identify a person.
//   3. Tools take no free-form SQL and no field lists. Unknown arguments are refused.
//   4. Every tool result passes assertNoPhi() before it is written; a hit withholds the result.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER_INFO = { name: "fhir-readonly", version: "1.0.0" };
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const MODERN_VERSIONS = ["2026-07-28"];
export const MIN_CELL_SIZE = 5;
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
// Cache hint required on modern list/discover results; the tool set contains no user-specific data.
const CACHE_HINT = { ttlMs: 300000, cacheScope: "public" };
const INSTRUCTIONS =
  "Read-only, PHI-safe access to the FHIR-lite sample data. Returns schema metadata, suppressed aggregate counts, " +
  "opaque ids and fixture query plans. It never returns names, MRNs, birth dates or observation values.";

const DATASET_PATH = process.env.FHIR_DATASET || join(HERE, "fixtures", "dataset.json");
const PLANS_PATH = join(HERE, "fixtures", "query-plans.json");
const MIGRATIONS_DIR =
  process.env.FHIR_MIGRATIONS_DIR || resolve(HERE, "..", "..", "sample-app", "src", "main", "resources", "db", "migration");

// Columns that hold PHI (context/domain/fhir-lite-glossary.md, "PHI classification").
const PHI_COLUMNS = new Set(["mrn", "mrn_system", "family_name", "given_names", "gender", "birth_date", "value_quantity", "value_unit"]);
// Keys that must never appear anywhere in a tool result.
const PHI_KEYS = new Set([
  "mrn", "family", "given", "birthDate", "birth_date", "family_name", "given_names", "gender",
  "value", "valueQuantity", "value_quantity", "identifier",
]);
// Argument names that signal an attempt to pull PHI or run arbitrary queries.
const PHI_ARG_HINTS = /^(mrn|name|family|given|birth|dob|gender|value|fields?|select|columns?|sql|query|raw)/i;

// ---------------------------------------------------------------- data
function loadDataset() {
  return JSON.parse(readFileSync(DATASET_PATH, "utf8"));
}
function loadPlans() {
  return JSON.parse(readFileSync(PLANS_PATH, "utf8")).queries;
}
/** Parse CREATE TABLE blocks from the real Flyway migrations, so the schema tool can never drift from the app. */
export function readSchema(dir = MIGRATIONS_DIR) {
  const tables = {};
  if (!existsSync(dir)) return tables;
  const files = readdirSync(dir).filter((f) => /^V\d+__.+\.sql$/.test(f)).sort((a, b) => version(a) - version(b));
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\);/gi)) {
      const [, table, body] = m;
      const columns = [];
      for (const raw of body.split(/,\s*\n/)) {
        const line = raw.trim();
        if (!line || /^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY)/i.test(line)) continue;
        const cm = /^(\w+)\s+(.+)$/.exec(line.replace(/\s+/g, " "));
        if (!cm) continue;
        const [, column, rest] = cm;
        const type = rest.split(/ (?:NOT NULL|NULL|DEFAULT|GENERATED|PRIMARY|REFERENCES|CONSTRAINT)/i)[0].trim();
        columns.push({ column, type, nullable: !/NOT NULL|PRIMARY KEY/i.test(rest), phi: PHI_COLUMNS.has(column) });
      }
      tables[table.toLowerCase()] = { definedIn: file, columns };
    }
  }
  return tables;
}
function version(file) {
  return Number(/^V(\d+)__/.exec(file)[1]);
}

// ---------------------------------------------------------------- tools
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const LOINC = "^[0-9]{1,6}-[0-9]$";
const STATUSES = ["registered", "preliminary", "final", "amended"];

export const TOOLS = [
  {
    name: "get_schema",
    title: "FHIR-lite database schema",
    description:
      "Columns, SQL types and PHI classification of the sample-app tables, parsed from the Flyway migrations. Metadata only, no rows.",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string", enum: ["patient", "observation"], description: "Limit to one table." } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    _meta: { "anthropic/maxResultSizeChars": 50000 },
  },
  {
    name: "count_observations_by_code",
    title: "Observation counts per LOINC code",
    description: `Aggregate count of Observations grouped by LOINC code. Groups smaller than ${MIN_CELL_SIZE} are suppressed and reported as "<${MIN_CELL_SIZE}". No per-patient breakdown.`,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", pattern: LOINC, description: "Only this LOINC code, e.g. 8867-4." },
        status: { type: "string", enum: STATUSES },
        effectiveFrom: { type: "string", format: "date", description: "Inclusive lower bound, YYYY-MM-DD." },
        effectiveTo: { type: "string", format: "date", description: "Inclusive upper bound, YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_observation_ids",
    title: "Observation ids for a code",
    description: "Opaque Observation ids (no values, no subjects) for one LOINC code, newest first. Use them to write test fixtures or to reference rows in a finding.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", pattern: LOINC },
        status: { type: "string", enum: STATUSES },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      required: ["code"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "explain_query_plan",
    title: "Query plan for a named repository query",
    description:
      "Returns a stored PostgreSQL EXPLAIN plan (fixture, not a live database) for a named query. Arbitrary SQL is not accepted.",
    inputSchema: {
      type: "object",
      properties: { queryId: { type: "string", enum: Object.keys(loadPlans()) } },
      required: ["queryId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

class ToolInputError extends Error {}

function validate(tool, args) {
  const schema = tool.inputSchema;
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new ToolInputError("arguments must be an object");
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) {
      if (PHI_ARG_HINTS.test(key)) {
        throw new ToolInputError(
          `refused: argument "${key}" could select PHI or run arbitrary queries. This server returns aggregates and opaque ids only.`
        );
      }
      throw new ToolInputError(`unknown argument "${key}"; allowed: ${Object.keys(schema.properties).join(", ") || "none"}`);
    }
  }
  for (const req of schema.required || []) if (args[req] === undefined) throw new ToolInputError(`missing required argument "${req}"`);
  for (const [key, spec] of Object.entries(schema.properties)) {
    const v = args[key];
    if (v === undefined) continue;
    if (spec.type === "string" && typeof v !== "string") throw new ToolInputError(`"${key}" must be a string`);
    if (spec.type === "integer" && !Number.isInteger(v)) throw new ToolInputError(`"${key}" must be an integer`);
    if (spec.enum && !spec.enum.includes(v)) throw new ToolInputError(`"${key}" must be one of: ${spec.enum.join(", ")}`);
    if (spec.pattern && !new RegExp(spec.pattern).test(v)) throw new ToolInputError(`"${key}" must match ${spec.pattern}`);
    if (spec.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolInputError(`"${key}" must be YYYY-MM-DD`);
    if (spec.minimum !== undefined && v < spec.minimum) throw new ToolInputError(`"${key}" must be >= ${spec.minimum}`);
    if (spec.maximum !== undefined && v > spec.maximum) throw new ToolInputError(`"${key}" must be <= ${spec.maximum}`);
  }
}

function filterObservations(obs, { code, status, effectiveFrom, effectiveTo }) {
  return obs.filter(
    (o) =>
      (!code || o.code === code) &&
      (!status || o.status === status) &&
      (!effectiveFrom || o.effectiveDateTime.slice(0, 10) >= effectiveFrom) &&
      (!effectiveTo || o.effectiveDateTime.slice(0, 10) <= effectiveTo)
  );
}

const HANDLERS = {
  get_schema({ table }) {
    const all = readSchema();
    const tables = table ? { [table]: all[table] } : all;
    return { source: "sample-app/src/main/resources/db/migration", tables };
  },
  count_observations_by_code(args) {
    const rows = filterObservations(loadDataset().observations, args);
    const groups = new Map();
    for (const o of rows) {
      const g = groups.get(o.code) || { code: o.code, display: o.display, n: 0 };
      g.n++;
      groups.set(o.code, g);
    }
    let reportedTotal = 0;
    let suppressedGroups = 0;
    const out = [...groups.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((g) => {
        if (g.n < MIN_CELL_SIZE) {
          suppressedGroups++;
          return { code: g.code, display: g.display, count: null, countText: `<${MIN_CELL_SIZE}` };
        }
        reportedTotal += g.n;
        return { code: g.code, display: g.display, count: g.n, countText: String(g.n) };
      });
    // reportedTotal excludes suppressed groups so a suppressed count cannot be recovered by subtraction.
    return { filters: args, minCellSize: MIN_CELL_SIZE, groups: out, reportedTotal, suppressedGroups };
  },
  list_observation_ids({ code, status, limit = 20 }) {
    const rows = filterObservations(loadDataset().observations, { code, status })
      .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime) || b.id - a.id);
    return { code, status: status ?? null, returned: Math.min(limit, rows.length), observationIds: rows.slice(0, limit).map((o) => o.id) };
  },
  explain_query_plan({ queryId }) {
    const p = loadPlans()[queryId];
    return { queryId, fixture: true, ...p };
  },
};

/** Defence in depth: throw if a result carries a PHI-shaped key or an MRN-shaped value. */
export function assertNoPhi(value, path = "$") {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoPhi(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (PHI_KEYS.has(k)) throw new Error(`PHI-shaped key "${k}" at ${path}`);
      assertNoPhi(v, `${path}.${k}`);
    }
    return;
  }
  if (typeof value === "string" && /\bMRN-\d+/.test(value)) throw new Error(`MRN-shaped value at ${path}`);
}

export function callTool(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { protocolError: { code: -32602, message: `Unknown tool: ${name}` } };
  try {
    validate(tool, args);
    const data = HANDLERS[name](args);
    assertNoPhi(data);
    return { result: { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false } };
  } catch (e) {
    const text = e instanceof ToolInputError ? e.message : `result withheld: ${e.message}`;
    log(`tool=${name} error=${e instanceof ToolInputError ? "input" : "guard"}`);
    return { result: { content: [{ type: "text", text }], isError: true } };
  }
}

// ---------------------------------------------------------------- JSON-RPC
function log(msg) {
  process.stderr.write(`[fhir-readonly] ${msg}\n`);
}

export function createSession() {
  let legacyVersion = null; // set by initialize
  const ok = (id, result, modern) => ({ jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result } : result });
  const err = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: data ? { code, message, data } : { code, message } });

  return function handle(msg) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      const hasId = Array.isArray(msg) || (msg && typeof msg === "object" && "id" in msg);
      return hasId ? err(msg.id ?? null, -32600, "Invalid Request") : null;
    }
    const isNotification = !("id" in msg);
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...: nothing to send

    const { id, method, params = {} } = msg;
    const requested = params?._meta?.[META_VERSION];
    const modern = requested !== undefined;
    if (modern && !MODERN_VERSIONS.includes(requested)) {
      return err(id, -32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested });
    }

    switch (method) {
      case "initialize": {
        const v = LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0];
        legacyVersion = v;
        log(`initialize protocolVersion=${v}`);
        return ok(id, { protocolVersion: v, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }, false);
      }
      case "server/discover":
        return ok(
          id,
          {
            supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
            capabilities: { tools: {} },
            _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
            instructions: INSTRUCTIONS,
            ...CACHE_HINT,
          },
          true
        );
      case "ping":
        return ok(id, {}, modern);
    }

    if (!modern && !legacyVersion) {
      return err(id, -32600, "Server not initialized: send initialize first, or use protocol 2026-07-28 request _meta");
    }
    switch (method) {
      case "tools/list":
        // 2026-07-28 makes ttlMs and cacheScope required on ListToolsResult; legacy clients ignore them.
        return ok(id, { tools: TOOLS, ...(modern ? CACHE_HINT : {}) }, modern);
      case "tools/call": {
        const { protocolError, result } = callTool(params.name, params.arguments ?? {});
        log(`tools/call name=${params.name} isError=${protocolError ? "protocol" : result.isError}`);
        return protocolError ? err(id, protocolError.code, protocolError.message) : ok(id, result, modern);
      }
      default:
        return err(id, -32601, `Method not found: ${method}`);
    }
  };
}

function main() {
  const handle = createSession();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let reply;
    try {
      reply = handle(JSON.parse(line));
    } catch {
      reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
  });
  rl.on("close", () => process.exit(0)); // stdin closed: the spec's graceful shutdown signal
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
