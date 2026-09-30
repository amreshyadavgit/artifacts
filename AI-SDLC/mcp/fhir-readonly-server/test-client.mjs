#!/usr/bin/env node
// Scripted MCP client for server.mjs. Spawns the server over stdio, speaks newline-delimited JSON-RPC,
// and asserts protocol behaviour (legacy and modern eras) and the PHI guarantees.
// Run: node mcp/fhir-readonly-server/test-client.mjs   (from AI-SDLC/). Exit 0 = all checks passed.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { assertNoPhi } from "./server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "server.mjs");
const dataset = JSON.parse(readFileSync(join(HERE, "fixtures", "dataset.json"), "utf8"));

function startServer() {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const lines = [];
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(line);
      const msg = JSON.parse(line); // throws (fails the run) if the server writes non-JSON to stdout
      const key = JSON.stringify(msg.id);
      pending.get(key)?.(msg);
      pending.delete(key);
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((res) => child.on("exit", (code) => res(code)));
  return {
    lines,
    exited,
    get stderr() { return stderr; },
    send(msg) {
      child.stdin.write((typeof msg === "string" ? msg : JSON.stringify(msg)) + "\n");
    },
    request(id, method, params) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for id ${id} (${method})`)), 3000);
        pending.set(JSON.stringify(id), (m) => { clearTimeout(t); resolve(m); });
        this.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    raw(line, id) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout on raw line")), 3000);
        pending.set(JSON.stringify(id), (m) => { clearTimeout(t); resolve(m); });
        this.send(line);
      });
    },
    close() { child.stdin.end(); },
  };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (e) {
    results.push([false, name, e.message]);
  }
}
const MODERN_META = {
  _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  },
};
const payload = (res) => JSON.parse(res.result.content[0].text);

// ------------------------------------------------------------ legacy era (initialize handshake)
const s = startServer();
let n = 1;
const call = (name, args) => s.request(n++, "tools/call", { name, arguments: args });

await check("tools/list before initialize is rejected", async () => {
  const r = await s.request(n++, "tools/list");
  assert.equal(r.error?.code, -32600);
});
await check("initialize echoes a supported protocolVersion and declares tools capability", async () => {
  const r = await s.request(n++, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result.serverInfo.name, "fhir-readonly");
});
await check("notifications/initialized gets no response", async () => {
  const before = s.lines.length;
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await s.request(n++, "ping");
  assert.equal(s.lines.length, before + 1, "only the ping reply should have arrived");
});
await check("tools/list returns 4 read-only tools with closed input schemas", async () => {
  const r = await s.request(n++, "tools/list");
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["get_schema", "count_observations_by_code", "list_observation_ids", "explain_query_plan"]);
  for (const t of r.result.tools) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} readOnlyHint`);
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name} additionalProperties`);
  }
  assert.equal(r.result.resultType, undefined, "legacy results carry no resultType");
});
await check("get_schema is parsed from V1__init.sql and flags PHI columns", async () => {
  const d = payload(await call("get_schema", {}));
  const patient = Object.fromEntries(d.tables.patient.columns.map((c) => [c.column, c.phi]));
  assert.equal(d.tables.patient.definedIn, "V1__init.sql");
  assert.equal(patient.mrn, true);
  assert.equal(patient.birth_date, true);
  assert.equal(patient.id, false);
  const obs = Object.fromEntries(d.tables.observation.columns.map((c) => [c.column, c.phi]));
  assert.equal(obs.code, false);
  assert.equal(obs.value_quantity, true);
});
await check("count_observations_by_code suppresses groups below 5", async () => {
  const d = payload(await call("count_observations_by_code", {}));
  const byCode = Object.fromEntries(d.groups.map((g) => [g.code, g]));
  assert.equal(byCode["8867-4"].count, 23);
  assert.equal(byCode["2339-0"].count, null);
  assert.equal(byCode["2339-0"].countText, "<5");
  assert.equal(d.reportedTotal, 74, "suppressed group excluded from total");
  assert.equal(d.suppressedGroups, 1);
});
await check("count_observations_by_code filters by code and status", async () => {
  const d = payload(await call("count_observations_by_code", { code: "8480-6", status: "final" }));
  const expected = dataset.observations.filter((o) => o.code === "8480-6" && o.status === "final").length;
  assert.equal(d.groups.length, 1);
  assert.equal(d.groups[0].count, expected);
});
await check("list_observation_ids returns ids only", async () => {
  const r = await call("list_observation_ids", { code: "8867-4", limit: 5 });
  const d = payload(r);
  assert.equal(d.observationIds.length, 5);
  assert.ok(d.observationIds.every(Number.isInteger));
  assert.deepEqual(Object.keys(d).sort(), ["code", "observationIds", "returned", "status"]);
});
await check("explain_query_plan returns the N+1 fixture", async () => {
  const d = payload(await call("explain_query_plan", { queryId: "lastn-per-subject-loop" }));
  assert.equal(d.statementsPerRequest, "2 x number of subjects");
  assert.equal(d.fixture, true);
  assert.ok(d.plan.some((l) => l.includes("ix_observation_patient_code")));
});
await check("raw SQL argument is refused as a tool error", async () => {
  const r = await call("get_schema", { sql: "select mrn, family_name from patient" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /^refused: argument "sql"/);
});
await check("PHI field selection is refused", async () => {
  const r = await call("list_observation_ids", { code: "8867-4", fields: ["mrn", "value"] });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /refused: argument "fields"/);
});
await check("unknown tool is a JSON-RPC protocol error -32602", async () => {
  const r = await call("get_patient", { id: 1 });
  assert.equal(r.error?.code, -32602);
  assert.match(r.error.message, /Unknown tool: get_patient/);
});
await check("invalid LOINC code is a tool execution error", async () => {
  const r = await call("list_observation_ids", { code: "heart rate" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /"code" must match/);
});
await check("explain_query_plan rejects queries outside the fixture list", async () => {
  const r = await call("explain_query_plan", { queryId: "select * from patient" });
  assert.equal(r.result.isError, true);
});
await check("unknown method is -32601", async () => {
  const r = await s.request(n++, "resources/list");
  assert.equal(r.error?.code, -32601);
});
await check("malformed JSON is a parse error with id null", async () => {
  const r = await s.raw("{not json", null);
  assert.equal(r.error.code, -32700);
});
await check("no stdout line contains PHI from the dataset", async () => {
  const all = s.lines.join("\n");
  assert.doesNotMatch(all, /MRN-\d+/);
  for (const p of dataset.patients) assert.ok(!all.includes(p.birthDate), `birthDate of Patient/${p.id} leaked`);
  for (const o of dataset.observations.slice(0, 20)) assert.ok(!all.includes(`"value":${o.value}`), "observation value leaked");
});
await check("stdin close shuts the server down with exit 0", async () => {
  s.close();
  assert.equal(await s.exited, 0);
  assert.doesNotMatch(s.stderr, /MRN-\d+/, "stderr logs must not contain MRNs");
});

// ------------------------------------------------------------ modern era (2026-07-28, per-request _meta)
const m = startServer();
await check("server/discover advertises modern and legacy versions", async () => {
  const r = await m.request("discover-1", "server/discover", MODERN_META);
  assert.equal(r.result.resultType, "complete");
  assert.deepEqual(r.result.supportedVersions.slice(0, 2), ["2026-07-28", "2025-11-25"]);
  assert.equal(r.result._meta["io.modelcontextprotocol/serverInfo"].name, "fhir-readonly");
  assert.equal(typeof r.result.ttlMs, "number", "DiscoverResult requires ttlMs");
  assert.equal(r.result.cacheScope, "public", "DiscoverResult requires cacheScope");
});
await check("modern tools/list carries resultType, ttlMs and cacheScope (required in 2026-07-28)", async () => {
  const r = await m.request("list-1", "tools/list", MODERN_META);
  assert.equal(r.result.resultType, "complete");
  assert.equal(typeof r.result.ttlMs, "number");
  assert.equal(r.result.cacheScope, "public");
  assert.equal(r.result.tools.length, 4);
});
await check("modern tools/call works without initialize and carries resultType", async () => {
  const r = await m.request(2, "tools/call", { ...MODERN_META, name: "count_observations_by_code", arguments: { code: "29463-7" } });
  assert.equal(r.result.resultType, "complete");
  assert.equal(r.result.structuredContent.groups[0].count, 25);
});
await check("unsupported protocol version gets -32022 with supported list", async () => {
  const bad = { _meta: { ...MODERN_META._meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } };
  const r = await m.request(3, "tools/list", bad);
  assert.equal(r.error.code, -32022);
  assert.equal(r.error.data.requested, "1900-01-01");
  assert.ok(r.error.data.supported.includes("2026-07-28"));
});
m.close();
await m.exited;

// ------------------------------------------------------------ output guard unit checks
await check("assertNoPhi rejects PHI keys and MRN values, accepts aggregates", async () => {
  assert.throws(() => assertNoPhi({ rows: [{ id: 1, mrn: "x" }] }), /PHI-shaped key "mrn"/);
  assert.throws(() => assertNoPhi({ note: "see MRN-000101" }), /MRN-shaped value/);
  assert.doesNotThrow(() => assertNoPhi({ groups: [{ code: "8867-4", count: 23 }] }));
});

for (const [pass, name, why] of results) console.log(`${pass ? "PASS" : "FAIL"}  ${name}${why ? `\n      ${why}` : ""}`);
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
