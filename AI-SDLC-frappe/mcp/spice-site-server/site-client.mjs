// site-client.mjs: the only code in the spice-site MCP server that talks to a Frappe site.
//
// Two sources behind one interface, `source.get(method, params)`:
//   - live:    HTTP GET to /api/method/<method> on a Frappe v15 site, authenticated as a read-only
//              API user with `Authorization: token <api_key>:<api_secret>` (frappe/auth.py).
//   - fixture: recorded responses from fixtures/site-responses.json, same shape as the live bodies,
//              so the mapping and PHI guard code below runs identically in tests without a site.
//
// Read-only by construction: GET only, and only the three whitelisted Frappe methods in METHODS.
// Nothing here can reach /api/resource (row reads) or any method that writes.
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// Frappe v15 whitelisted methods this server may call (verified in apps/frappe, version-15):
//   frappe.desk.listview.get_group_by_count(doctype, current_filters, field): permission-aware
//     (frappe.get_list), returns [{count, name}] with `name` = the group value, top 50.
//   frappe.desk.form.load.getdoctype(doctype): DocType meta in response.docs; any logged-in user.
//   frappe.utils.change_log.get_versions(): installed apps with title, branch, version.
export const METHODS = Object.freeze([
  "frappe.desk.listview.get_group_by_count",
  "frappe.desk.form.load.getdoctype",
  "frappe.utils.change_log.get_versions",
]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MAX_BODY_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

export class SiteError extends Error {}

/** Stable key for a (method, params) pair: params sorted by name. */
export function requestKey(method, params = {}) {
  const sorted = Object.keys(params).sort().map((k) => [k, params[k]]);
  return `${method}?${new URLSearchParams(sorted).toString()}`;
}

function assertAllowed(method) {
  if (!METHODS.includes(method)) throw new SiteError(`refused: ${method} is not on this server's read-only method allowlist`);
}

export function fixtureSource(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new SiteError(`fixture file unreadable: ${path}`);
  }
  const byKey = new Map((data.responses || []).map((r) => [requestKey(r.method, r.params), r]));
  return {
    mode: "fixture",
    async get(method, params = {}) {
      assertAllowed(method);
      const r = byKey.get(requestKey(method, params));
      if (!r) throw new SiteError(`no fixture for ${method} with these arguments (fixture mode serves recorded requests only)`);
      if (r.status !== 200) throw statusError(r.status);
      return r.body;
    },
  };
}

function statusError(status) {
  if (status === 401 || status === 403)
    return new SiteError(`site refused the API user (HTTP ${status}): check that it has the SL Aggregate Reader role and a valid key`);
  if (status === 404) return new SiteError("site returned HTTP 404: wrong site, or the method does not exist on this Frappe version");
  // The response body is never echoed: a Frappe traceback can carry request parameters or row data.
  return new SiteError(`site error HTTP ${status}`);
}

/**
 * Live source. `url` is the site base URL; plain http is accepted only for localhost (bench serve).
 * `host` optionally overrides the Host header (bench serve picks the site from it).
 */
export function liveSource({ url, host, apiKey, apiSecret, timeoutMs = TIMEOUT_MS }) {
  let base;
  try {
    base = new URL(url);
  } catch {
    throw new SiteError(`SPICE_SITE_URL is not a valid URL`);
  }
  if (base.protocol !== "https:" && !(base.protocol === "http:" && LOCAL_HOSTS.has(base.hostname)))
    throw new SiteError("refused: SPICE_SITE_URL must be https (plain http only for localhost / bench serve)");
  const missing = (v) => !v || /^\$\{/.test(v);
  if (missing(apiKey) || missing(apiSecret))
    throw new SiteError("SPICE_SITE_API_KEY and SPICE_SITE_API_SECRET are not set; see docs/mcp/spice-site-server.md");

  return {
    mode: "live",
    get(method, params = {}) {
      assertAllowed(method);
      const target = new URL(`/api/method/${method}`, base);
      for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
      const headers = { Accept: "application/json", Authorization: `token ${apiKey}:${apiSecret}` };
      if (host) headers.Host = host;
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      return new Promise((resolve, reject) => {
        const req = send(target, { method: "GET", headers, timeout: timeoutMs }, (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy();
              reject(new SiteError("site response too large"));
            } else chunks.push(c);
          });
          res.on("end", () => {
            if (res.statusCode !== 200) return reject(statusError(res.statusCode));
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new SiteError("site returned a non-JSON body"));
            }
          });
        });
        req.on("timeout", () => req.destroy(new SiteError(`site did not answer within ${timeoutMs} ms`)));
        req.on("error", (e) => reject(e instanceof SiteError ? e : new SiteError(`cannot reach site: ${e.code || e.message}`)));
        req.end();
      });
    },
  };
}

/** Pick the source from the environment the MCP client passes (see .mcp.json). */
export function sourceFromEnv(env = process.env, defaultFixtures) {
  const mode = (env.SPICE_SITE_MODE || "fixture").toLowerCase();
  if (mode === "fixture") return fixtureSource(env.SPICE_SITE_FIXTURES || defaultFixtures);
  if (mode === "live")
    return liveSource({
      url: env.SPICE_SITE_URL || "http://127.0.0.1:8000",
      host: env.SPICE_SITE_HOST || undefined,
      apiKey: env.SPICE_SITE_API_KEY,
      apiSecret: env.SPICE_SITE_API_SECRET,
    });
  throw new SiteError(`SPICE_SITE_MODE must be "fixture" or "live", got "${mode}"`);
}
