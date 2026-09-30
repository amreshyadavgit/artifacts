# The spice-site MCP server

`mcp/spice-site-server/` is a zero-dependency Node 22 MCP server (stdio) that lets agents ask a Frappe site questions an engineer asks every day, without handing them PHI or write access:

- what does this DocType look like (fields, indexes, naming rule, permissions), and which fields are PHI?
- which apps does this country deployment run?
- how many observations per LOINC code, how many patients per country?

It talks to the site only through Frappe's REST API, as a read-only API user. **Frappe's whitelisted methods are the database boundary**: the server never sees SQL, a connection string or `site_config.json`.

## Files

| File | Role |
|---|---|
| `server.mjs` | MCP protocol (legacy and 2026-07-28 eras), the four tools, input validation, small-cell suppression, output guard |
| `site-client.mjs` | The only code that reaches a site: GET-only HTTP client with a three-method allowlist, and the fixture source |
| `fixtures/site-responses.json` | Responses recorded from the course bench by `live-check.mjs --record` (aggregates, schema, app versions; no PHI) |
| `stdio-client.mjs` | Tiny MCP client used by the two test scripts |
| `test-client.mjs` | Offline test: fixture mode plus a mock Frappe HTTP server. 26 checks, no site needed |
| `live-check.mjs` | Live test: the same tools against a real site |
| `scripts/provision_api_user.py` | Creates / removes the read-only API user (test sites only) |
| `scripts/run-live-test.sh` | Whole live sequence under the shared bench lock, leaves the site as it was |

## Tools

| Tool | Frappe call (GET `/api/method/...`) | Returns | Cannot return |
|---|---|---|---|
| `get_doctype_schema {doctype}` | `frappe.desk.form.load.getdoctype` | fields with `reqd`, `unique`, `search_index`, `in_standard_filter`, Link/Select options and `phi: true/false/"unclassified"`; `autoname`, `naming_rule`, `search_fields`; the permissions array | rows, field descriptions, client scripts |
| `count_observations_by_code {status?}` | `frappe.desk.listview.get_group_by_count` (field `code`) | one group per LOINC code; groups under 5 as `"<5"` | per-patient counts, values |
| `count_patients_by_country {active?}` | same, field `country` | one group per ISO country code; no country as `null` | any demographic breakdown |
| `list_installed_apps {}` | `frappe.utils.change_log.get_versions` | app, title, version, branch | descriptions |

`doctype` is an enum of the four spice_lite DocTypes. A field that the PHI table in `context/domain/spice-lite-glossary.md` does not classify (for example a Custom Field that a country app added) comes back as `"unclassified"` and is listed in `unclassifiedFields`: treat it as PHI until someone classifies it.

`get_group_by_count` is the method behind the list view sidebar counts. It calls `frappe.get_list`, so it is permission-aware, and it returns at most 50 groups (`truncatedAt: 50` in every count result says so).

## PHI controls, each tested

1. **Closed inputs.** `additionalProperties: false`; any argument named like a PHI selector or a query widener (`fields`, `filters`, `sql`, `group_by`, `doctype` on a count tool, `mrn`, `name`, ...) is refused with `isError: true` and a reason the model can act on.
2. **Fixed group-by fields**, all non-PHI (`code`, `country`). There is no way to ask for counts by `last_name` or `birth_date`.
3. **Small-cell suppression**: groups under 5 are `"<5"`, and `reportedTotal` excludes them so the hidden count cannot be recovered by subtraction.
4. **Shape guard on every group value**: a code must look like LOINC (`^[0-9]{1,6}-[0-9]$`), a country like ISO alpha-2. A site that returned `MRN-20417733` as a group, or a row with an extra `last_name` column, gets the whole result withheld, and the message never echoes the value.
5. **`assertNoPhi()`** walks every result for PHI-shaped keys (`mrn`, `first_name`, `last_name`, `birth_date`, `value`, ...), identifier-shaped strings and emails.
6. **Read-only HTTP**: GET only, three allowlisted methods; `frappe.client.get_list`, `/api/resource/...` and every write are unreachable from the code. Plain `http` is refused except for localhost (`bench serve`), so a token never crosses a network in clear text.
7. **Errors never echo the site's body**: a Frappe traceback can contain request parameters.
8. **stderr logs tool names and outcomes only.**

## Run the offline tests

```bash
cd AI-SDLC-frappe
node mcp/spice-site-server/test-client.mjs      # 26/26 checks passed
```

## Live mode

Needs a bench you are allowed to change (a test site), as the bench user.

```bash
# 1. read-only API user (prints the one-time secret as export lines)
cd /home/user/frappe-bench/sites
../env/bin/python /path/to/AI-SDLC-frappe/mcp/spice-site-server/scripts/provision_api_user.py \
  --site test.localhost setup --format env > ~/.spice-site-mcp.env && chmod 600 ~/.spice-site-mcp.env
# 2. a dev server
cd /home/user/frappe-bench && bench --site test.localhost serve --port 8000 &
# 3. the MCP server in live mode, from Claude Code
source ~/.spice-site-mcp.env
cd /path/to/AI-SDLC-frappe && SPICE_SITE_MODE=live SPICE_SITE_URL=http://127.0.0.1:8000 claude
# 4. when done
kill %1
../env/bin/python .../provision_api_user.py --site test.localhost teardown      # from sites/
```

`setup` refuses on a site without `allow_tests` or `developer_mode`, and refuses if the DocTypes already have Custom DocPerm rows (Frappe copies the standard rows into Custom DocPerm the first time a custom rule is added, and teardown resets them). `teardown` removes the user, the role, the Custom DocPerm rows and any `--sample-data` rows. Naming series counters (`SLP-`, `SLO-`) do advance, as they do in the test suite.

In the course container the whole sequence runs under the shared bench lock:

```bash
bash AI-SDLC-frappe/mcp/spice-site-server/scripts/run-live-test.sh            # add --record to refresh the fixtures
```

Output on 2026-09-30 (Frappe 15.121.2, PostgreSQL 16, synthetic sample data: 15 patients, 17 preliminary observations):

```text
--- provision read-only API user and synthetic sample data
user=mcp-reader@spice-lite.test role=SL Aggregate Reader sample={"patients":15,"observations":17}
--- guest and wrong-token requests (expect 403 and 401)
guest get_group_by_count: 403
wrong secret: 401
--- the same key reading a row through /api/resource (what the MCP server never does)
reader GET /api/resource/SL Patient: 200
reader POST /api/resource/SL Country (write): 403
--- live-check.mjs
PASS  count_observations_by_code
      2339-0=<5 8480-6=9 8867-4=6 reportedTotal=15 suppressedGroups=1
PASS  count_patients_by_country
      XA=12 XB=<5 reportedTotal=12
PASS  list_installed_apps
      frappe 15.121.2, spice_lite 0.1.0
8/8 live checks passed
--- stop bench serve
--- teardown
{"removed_user": "mcp-reader@spice-lite.test", "reset_permissions": ["SL Patient", "SL Encounter", "SL Observation"], "removed_patients": 15, "removed_observations": 17}
```

## A stronger design

`reader GET /api/resource/SL Patient: 200` is the finding to take away. Frappe has no aggregate-only permission type: `get_group_by_count` needs `read` (or `select`, which exposes the DocType's `search_fields`, i.e. `mrn,last_name`). So the API key can read rows if someone takes it out of the MCP server's environment. For a production country site:

1. Put the aggregates in a small **integration app** (`required_apps = ["spice_lite"]`) as whitelisted methods, e.g. `spice_mcp.api.observation_counts_by_code()`, decorated `@frappe.whitelist(methods=["GET"])`, starting with `frappe.only_for("SL Aggregate Reader")`, and computing the counts with `frappe.qb` group-by queries and suppression **server-side**. This is one of the few places where skipping document permissions (`frappe.qb` does) is correct, and the method needs a comment that says why: the role check replaces them and only counts leave the method.
2. Give `SL Aggregate Reader` **no DocType read at all**. The key can then call four methods and nothing else; `/api/resource/SL Patient` returns 403.
3. Point `site-client.mjs` `METHODS` at those methods. The MCP tools, the guard and the tests stay the same.

That is an architecture decision (a new app and a permission model change): write an ADR and run it through the architect and security agents (modules `05-agent-roster`, `07-agent-composition`).

## Protocol notes

See [README.md](README.md#which-protocol-era-claude-code-speaks) for which era Claude Code 2.1.285 used in this container. The server returns `-32022` with `data.supported` for an unknown 2026-07-28-style version, `-32600` for `tools/list` before `initialize` in the legacy era, `-32602` for an unknown tool, `-32601` for an unknown method and `-32700` for malformed JSON, and exits 0 when stdin closes.
