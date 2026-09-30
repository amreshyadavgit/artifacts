#!/usr/bin/env node
// Scripted MCP client for server.mjs. No Frappe site needed: it runs the server in fixture mode, and in
// live mode against a local mock of the Frappe REST API, and asserts protocol behaviour (legacy and
// 2026-07-28 eras), the read-only HTTP contract, and the PHI guarantees.
// Run from AI-SDLC-frappe/: node mcp/spice-site-server/test-client.mjs   Exit 0 = all checks passed.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { assertNoPhi, suppress } from "./server.mjs";
import { liveSource, fixtureSource, METHODS } from "./site-client.mjs";
import { startServer, payload, initialize } from "./stdio-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "site-responses.json");
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

// ------------------------------------------------------------ legacy era, fixture mode
const s = startServer({ SPICE_SITE_MODE: "fixture", SPICE_SITE_FIXTURES: FIXTURES });
let n = 1;
const call = (srv, name, args) => srv.request(n++, "tools/call", { name, arguments: args });

await check("tools/list before initialize is rejected", async () => {
  const r = await s.request(n++, "tools/list");
  assert.equal(r.error?.code, -32600);
});
await check("initialize echoes a supported protocolVersion and declares tools capability", async () => {
  const r = await s.request(n++, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result.serverInfo.name, "spice-site");
});
await check("notifications/initialized gets no response", async () => {
  const before = s.lines.length;
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await s.request(n++, "ping");
  assert.equal(s.lines.length, before + 1, "only the ping reply should have arrived");
});
await check("tools/list returns 4 read-only tools with closed input schemas", async () => {
  const r = await s.request(n++, "tools/list");
  assert.deepEqual(r.result.tools.map((t) => t.name), ["get_doctype_schema", "count_observations_by_code", "count_patients_by_country", "list_installed_apps"]);
  for (const t of r.result.tools) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} readOnlyHint`);
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name} additionalProperties`);
  }
  assert.equal(r.result.resultType, undefined, "legacy results carry no resultType");
});
await check("get_doctype_schema SL Patient flags PHI fields and keeps the naming rule and permissions", async () => {
  const d = payload(await call(s, "get_doctype_schema", { doctype: "SL Patient" }));
  const f = Object.fromEntries(d.fields.map((x) => [x.fieldname, x]));
  assert.equal(d.autoname, "SLP-.#####");
  assert.equal(f.mrn.phi, true);
  assert.equal(f.mrn.unique, 1);
  assert.equal(f.last_name.search_index, 1);
  assert.equal(f.country.phi, false);
  assert.equal(f.country.options, "SL Country");
  assert.equal(f.column_break_demo, undefined, "layout fields are dropped");
  const clin = d.permissions.find((p) => p.role === "Clinician");
  assert.deepEqual([clin.read, clin.write, clin.create, clin.delete], [1, 1, 1, 0]);
  assert.deepEqual(d.unclassifiedFields, []);
});
await check("get_doctype_schema SL Observation shows effective_datetime without search_index", async () => {
  const d = payload(await call(s, "get_doctype_schema", { doctype: "SL Observation" }));
  const f = Object.fromEntries(d.fields.map((x) => [x.fieldname, x]));
  assert.equal(f.code.search_index, 1);
  assert.equal(f.effective_datetime.search_index, 0);
  assert.equal(f.value.phi, true);
});
await check("get_doctype_schema refuses a DocType outside the allowlist", async () => {
  const r = await call(s, "get_doctype_schema", { doctype: "User" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /"doctype" must be one of: SL Patient/);
});
await check("count_observations_by_code suppresses groups below 5", async () => {
  const d = payload(await call(s, "count_observations_by_code", {}));
  const byCode = Object.fromEntries(d.groups.map((g) => [g.code, g]));
  assert.equal(byCode["8480-6"].count, 9);
  assert.equal(byCode["8867-4"].count, 6);
  assert.equal(byCode["2339-0"].count, null);
  assert.equal(byCode["2339-0"].countText, "<5");
  assert.equal(d.reportedTotal, 15, "suppressed group excluded from total");
  assert.equal(d.suppressedGroups, 1);
});
await check("count_observations_by_code filters by status", async () => {
  const d = payload(await call(s, "count_observations_by_code", { status: "final" }));
  assert.deepEqual(d.groups, []);
  assert.equal(d.filters.status, "final");
});
await check("count_patients_by_country suppresses the small country", async () => {
  const d = payload(await call(s, "count_patients_by_country", {}));
  assert.deepEqual(d.groups.map((g) => [g.country, g.countText]), [["XA", "12"], ["XB", "<5"]]);
  assert.equal(d.reportedTotal, 12);
});
await check("list_installed_apps lists frappe and spice_lite", async () => {
  const d = payload(await call(s, "list_installed_apps", {}));
  assert.deepEqual(d.apps.map((a) => a.app), ["frappe", "spice_lite"]);
  assert.equal(d.apps[0].version, "15.121.2");
});
await check("PHI selectors, filters and SQL are refused as tool errors", async () => {
  for (const [tool, args, key] of [
    ["count_patients_by_country", { fields: ["mrn", "last_name"] }, "fields"],
    ["count_observations_by_code", { filters: { patient: "SLP-00001" } }, "filters"],
    ["count_observations_by_code", { sql: "select value from `tabSL Observation`" }, "sql"],
    ["count_patients_by_country", { group_by: "last_name" }, "group_by"],
    ["count_observations_by_code", { doctype: "SL Patient" }, "doctype"],
  ]) {
    const r = await call(s, tool, args);
    assert.equal(r.result.isError, true, key);
    assert.match(r.result.content[0].text, new RegExp(`^refused: argument "${key}"`));
  }
});
await check("unknown tool is a JSON-RPC protocol error -32602", async () => {
  const r = await call(s, "get_patient", { name: "SLP-00001" });
  assert.equal(r.error?.code, -32602);
});
await check("unknown method is -32601 and malformed JSON is -32700", async () => {
  assert.equal((await s.request(n++, "resources/list")).error?.code, -32601);
  assert.equal((await s.raw("{not json", null)).error.code, -32700);
});
await check("stdin close shuts the server down with exit 0; stderr has no arguments", async () => {
  s.close();
  assert.equal(await s.exited, 0);
  assert.doesNotMatch(s.stderr, /mrn|last_name|SLP-/);
});

// ------------------------------------------------------------ modern era (2026-07-28)
const m = startServer({ SPICE_SITE_MODE: "fixture", SPICE_SITE_FIXTURES: FIXTURES });
await check("server/discover advertises modern and legacy versions with ttlMs and cacheScope", async () => {
  const r = await m.request("discover-1", "server/discover", MODERN_META);
  assert.equal(r.result.resultType, "complete");
  assert.deepEqual(r.result.supportedVersions.slice(0, 2), ["2026-07-28", "2025-11-25"]);
  assert.equal(r.result._meta["io.modelcontextprotocol/serverInfo"].name, "spice-site");
  assert.equal(typeof r.result.ttlMs, "number");
  assert.equal(r.result.cacheScope, "public");
});
await check("modern tools/list and tools/call work without initialize", async () => {
  const l = await m.request("list-1", "tools/list", MODERN_META);
  assert.equal(l.result.resultType, "complete");
  assert.equal(typeof l.result.ttlMs, "number");
  const r = await m.request(2, "tools/call", { ...MODERN_META, name: "count_patients_by_country", arguments: {} });
  assert.equal(r.result.resultType, "complete");
  assert.equal(r.result.structuredContent.reportedTotal, 12);
});
await check("unsupported protocol version gets -32022 with supported list", async () => {
  const bad = { _meta: { ...MODERN_META._meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } };
  const r = await m.request(3, "tools/list", bad);
  assert.equal(r.error.code, -32022);
  assert.ok(r.error.data.supported.includes("2026-07-28"));
});
m.close();
await m.exited;

// ------------------------------------------------------------ PHI guard against a misbehaving site
const tmp = mkdtempSync(join(tmpdir(), "spice-site-"));
const poisoned = JSON.parse(readFileSync(FIXTURES, "utf8"));
const obsAll = poisoned.responses.find((r) => r.params.field === "code" && r.params.current_filters === "[]");
obsAll.body.message.push({ count: 7, name: "MRN-20417733" }); // a site that grouped by the wrong field
const ptAll = poisoned.responses.find((r) => r.params.field === "country" && r.params.current_filters === "[]");
ptAll.body.message = [{ count: 12, name: "XA", last_name: "Kamau" }]; // extra column smuggled into a row
writeFileSync(join(tmp, "poisoned.json"), JSON.stringify(poisoned));
const g = startServer({ SPICE_SITE_MODE: "fixture", SPICE_SITE_FIXTURES: join(tmp, "poisoned.json") });
await initialize(g);
await check("a group value that is not a LOINC code withholds the whole result", async () => {
  const r = await call(g, "count_observations_by_code", {});
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /^result withheld: group value does not look like a code/);
  assert.doesNotMatch(r.result.content[0].text, /20417733/);
});
await check("an extra column in a row withholds the result without echoing it", async () => {
  const r = await call(g, "count_patients_by_country", {});
  assert.equal(r.result.isError, true);
  assert.doesNotMatch(JSON.stringify(r), /Kamau|last_name/);
});
g.close();
await g.exited;

// ------------------------------------------------------------ live mode against a mock Frappe site
const seen = [];
const mock = createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, host: req.headers.host });
  const url = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json");
  if (req.headers.authorization !== "token k123:s456") {
    res.statusCode = 401;
    return res.end(JSON.stringify({ exc_type: "AuthenticationError", exc: "Traceback ... MRN-20417733 ..." }));
  }
  if (url.pathname === "/api/method/frappe.desk.listview.get_group_by_count" && url.searchParams.get("field") === "country")
    return res.end(JSON.stringify({ message: [{ count: 40, name: "KE" }, { count: 2, name: "UG" }, { count: 6, name: "" }] }));
  res.statusCode = 403;
  res.end(JSON.stringify({ exc: "Traceback ... Patient Wanjiru Kamau ..." }));
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const port = mock.address().port;
const liveEnv = { SPICE_SITE_MODE: "live", SPICE_SITE_URL: `http://127.0.0.1:${port}`, SPICE_SITE_HOST: "test.localhost" };
const l = startServer({ ...liveEnv, SPICE_SITE_API_KEY: "k123", SPICE_SITE_API_SECRET: "s456" });
await initialize(l);
await check("live: GET with token auth and Host header; empty country becomes null and is counted", async () => {
  const d = payload(await call(l, "count_patients_by_country", {}));
  assert.deepEqual(d.groups.map((x) => [x.country, x.countText]), [["KE", "40"], ["UG", "<5"], [null, "6"]]);
  const req = seen.at(-1);
  assert.equal(req.method, "GET");
  assert.equal(req.auth, "token k123:s456");
  assert.equal(req.host, "test.localhost");
  assert.match(req.url, /^\/api\/method\/frappe\.desk\.listview\.get_group_by_count\?/);
});
await check("live: a 403 becomes a tool error that never echoes the site's body", async () => {
  const r = await call(l, "list_installed_apps", {});
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /site refused the API user \(HTTP 403\)/);
  assert.doesNotMatch(r.result.content[0].text, /Kamau|Traceback/);
});
l.close();
await l.exited;
const noCreds = startServer({ ...liveEnv, SPICE_SITE_API_KEY: "${SPICE_SITE_API_KEY}", SPICE_SITE_API_SECRET: "" });
await initialize(noCreds);
await check("live: unexpanded or empty credentials fail the call before any HTTP request", async () => {
  const before = seen.length;
  const r = await call(noCreds, "count_patients_by_country", {});
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /SPICE_SITE_API_KEY and SPICE_SITE_API_SECRET are not set/);
  assert.equal(seen.length, before);
});
noCreds.close();
await noCreds.exited;
mock.close();

await check("live: plain http to a non-local host is refused (token would travel in clear text)", async () => {
  assert.throws(() => liveSource({ url: "http://ke-prod.example.org", apiKey: "k", apiSecret: "s" }), /must be https/);
  assert.doesNotThrow(() => liveSource({ url: "https://ke-prod.example.org", apiKey: "k", apiSecret: "s" }));
});
await check("site client refuses any method outside the read-only allowlist", async () => {
  const site = fixtureSource(FIXTURES);
  for (const method of ["frappe.client.get_list", "frappe.client.set_value", "spice_lite.api.fhir.search_patients"]) {
    await assert.rejects(site.get(method, {}), /not on this server's read-only method allowlist/);
  }
  assert.equal(METHODS.length, 3);
});
await check("assertNoPhi and suppress unit checks", async () => {
  assert.throws(() => assertNoPhi({ rows: [{ mrn: "x" }] }), /PHI-shaped key "mrn"/);
  assert.throws(() => assertNoPhi({ note: "see MRN-000101" }), /identifier-shaped value/);
  assert.throws(() => assertNoPhi({ owner: "clinician@spice-lite.test" }), /email-shaped value/);
  assert.doesNotThrow(() => assertNoPhi({ groups: [{ code: "8480-6", count: 9 }] }));
  assert.throws(() => suppress([{ count: 1, name: "Otieno" }], { key: "country", shape: /^[A-Z]{2}$/, allowNull: true }), /does not look like a country/);
});
rmSync(tmp, { recursive: true, force: true });

for (const [pass, name, why] of results) console.log(`${pass ? "PASS" : "FAIL"}  ${name}${why ? `\n      ${why}` : ""}`);
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
