#!/usr/bin/env node
// Live check: run the spice-site MCP server in live mode against a real Frappe site and call every tool.
// Needs a running site (bench serve) and the read-only API user from scripts/provision_api_user.py.
//
//   SPICE_SITE_URL=http://127.0.0.1:8016 SPICE_SITE_HOST=test.localhost \
//   SPICE_SITE_API_KEY=... SPICE_SITE_API_SECRET=... node mcp/spice-site-server/live-check.mjs [--record FILE]
//
// --record FILE writes the raw site responses (trimmed to the keys the server reads) in the fixture format,
// which is how fixtures/site-responses.json was produced. Exit 0 = every tool answered and passed the guard.
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { liveSource } from "./site-client.mjs";
import { startServer, payload, initialize } from "./stdio-client.mjs";

const env = { SPICE_SITE_MODE: "live" };
const s = startServer(env);
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push([true, name, detail]);
  } catch (e) {
    results.push([false, name, e.message]);
  }
}
let n = 1;
const call = (name, args = {}) => s.request(n++, "tools/call", { name, arguments: args });

await initialize(s);
await check("get_doctype_schema SL Patient: mrn is PHI and unique, name is a series", async () => {
  const r = await call("get_doctype_schema", { doctype: "SL Patient" });
  assert.equal(r.result.isError, false, r.result.content[0].text);
  const d = payload(r);
  const mrn = d.fields.find((f) => f.fieldname === "mrn");
  assert.equal(mrn.phi, true);
  assert.equal(mrn.unique, 1);
  assert.equal(d.autoname, "SLP-.#####");
  const clin = d.permissions.find((p) => p.role === "Clinician");
  return `autoname=${d.autoname} fields=${d.fields.length} clinician.delete=${clin.delete} unclassified=[${d.unclassifiedFields}]`;
});
await check("get_doctype_schema SL Observation: effective_datetime has no search_index", async () => {
  const d = payload(await call("get_doctype_schema", { doctype: "SL Observation" }));
  const f = Object.fromEntries(d.fields.map((x) => [x.fieldname, x]));
  return `code.search_index=${f.code.search_index} patient.search_index=${f.patient.search_index} effective_datetime.search_index=${f.effective_datetime.search_index} value.phi=${f.value.phi}`;
});
await check("count_observations_by_code", async () => {
  const r = await call("count_observations_by_code", {});
  assert.equal(r.result.isError, false, r.result.content[0].text);
  const d = payload(r);
  return d.groups.map((g) => `${g.code}=${g.countText}`).join(" ") + ` reportedTotal=${d.reportedTotal} suppressedGroups=${d.suppressedGroups}`;
});
await check("count_observations_by_code status=final", async () => {
  const d = payload(await call("count_observations_by_code", { status: "final" }));
  return `groups=${d.groups.length} reportedTotal=${d.reportedTotal}`;
});
await check("count_patients_by_country", async () => {
  const r = await call("count_patients_by_country", {});
  assert.equal(r.result.isError, false, r.result.content[0].text);
  const d = payload(r);
  return d.groups.map((g) => `${g.country}=${g.countText}`).join(" ") + ` reportedTotal=${d.reportedTotal}`;
});
await check("list_installed_apps", async () => {
  const r = await call("list_installed_apps", {});
  assert.equal(r.result.isError, false, r.result.content[0].text);
  return payload(r).apps.map((a) => `${a.app} ${a.version}`).join(", ");
});
await check("PHI selector refused before any HTTP call", async () => {
  const r = await call("count_patients_by_country", { fields: ["mrn", "last_name"] });
  assert.equal(r.result.isError, true);
  return r.result.content[0].text.slice(0, 40);
});
await check("no stdout line carries an MRN, a synthetic name or an email", async () => {
  const all = s.lines.join("\n");
  assert.doesNotMatch(all, /MCPTEST-|MRN-\d|DEMO-\d|@spice-lite\.test/);
  return `${s.lines.length} lines scanned`;
});
s.close();
await s.exited;

const recordAt = process.argv.indexOf("--record");
if (recordAt > 0) {
  const site = liveSource({
    url: process.env.SPICE_SITE_URL || "http://127.0.0.1:8000",
    host: process.env.SPICE_SITE_HOST,
    apiKey: process.env.SPICE_SITE_API_KEY,
    apiSecret: process.env.SPICE_SITE_API_SECRET,
  });
  const reqs = [
    ["frappe.utils.change_log.get_versions", {}],
    ...["SL Patient", "SL Encounter", "SL Observation", "SL Country"].map((dt) => ["frappe.desk.form.load.getdoctype", { doctype: dt }]),
    ["frappe.desk.listview.get_group_by_count", { doctype: "SL Observation", current_filters: "[]", field: "code" }],
    ...["registered", "preliminary", "final", "amended"].map((st) => [
      "frappe.desk.listview.get_group_by_count",
      { doctype: "SL Observation", current_filters: JSON.stringify([["status", "=", st]]), field: "code" },
    ]),
    ["frappe.desk.listview.get_group_by_count", { doctype: "SL Patient", current_filters: "[]", field: "country" }],
    ...[1, 0].map((a) => ["frappe.desk.listview.get_group_by_count", { doctype: "SL Patient", current_filters: JSON.stringify([["active", "=", a]]), field: "country" }]),
  ];
  const trimMeta = (d) => ({
    ...Object.fromEntries(["name", "module", "autoname", "naming_rule", "search_fields", "sort_field", "track_changes", "is_submittable"].map((k) => [k, d[k] ?? null])),
    fields: d.fields.map((f) => Object.fromEntries(["fieldname", "fieldtype", "label", "options", "reqd", "unique", "search_index", "in_standard_filter", "in_list_view", "read_only", "permlevel"].map((k) => [k, f[k] ?? null]))),
    permissions: d.permissions.map((p) => Object.fromEntries(["role", "permlevel", "if_owner", "read", "write", "create", "delete", "submit", "cancel", "amend", "report", "export", "import", "share", "print", "email", "select"].map((k) => [k, p[k] ?? 0]))),
  });
  const responses = [];
  for (const [method, params] of reqs) {
    const body = await site.get(method, params);
    let kept;
    if (method.endsWith("getdoctype")) kept = { docs: body.docs.filter((d) => d.name === params.doctype).map(trimMeta) };
    else if (method.endsWith("get_versions"))
      kept = { message: Object.fromEntries(Object.entries(body.message).map(([k, v]) => [k, { title: v.title, version: v.version, branch: v.branch }])) };
    else kept = { message: body.message };
    responses.push({ method, params, status: 200, body: kept });
  }
  const file = process.argv[recordAt + 1];
  const out = {
    _note:
      "Recorded from the course bench (site test.localhost, Frappe 15.121.2, PostgreSQL 16) by live-check.mjs --record, with the synthetic " +
      "sample data from scripts/provision_api_user.py --sample-data. Bodies are trimmed to the keys server.mjs reads. No PHI: aggregate counts, schema and app versions only.",
    recordedAt: new Date().toISOString().slice(0, 10),
    responses,
  };
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  results.push([true, `recorded ${responses.length} responses to ${file}`]);
}

for (const [pass, name, detail] of results) console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} live checks passed`);
process.exit(failed ? 1 : 0);
