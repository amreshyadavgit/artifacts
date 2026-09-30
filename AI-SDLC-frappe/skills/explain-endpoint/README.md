# Skill asset: explain-endpoint (Frappe edition)

| | |
|---|---|
| Runtime location | `.claude/skills/explain-endpoint/` (`SKILL.md`, `reference.md`, `scripts/doctype_summary.py`) |
| Version | 1.0.0 (see [CHANGELOG.md](CHANGELOG.md)) |
| Owner | @example-org/spice-core |
| Consumers | Humans via `/explain-endpoint <dotted.method>`; not preloaded by any roster agent |
| Invocation | `/explain-endpoint spice_lite.api.fhir.lastn` (a leading `/api/method/` is stripped) |
| Writes files | No. Read, Grep, Glob and two pre-approved read-only commands; never runs `bench` |
| Taught in | module `02-first-agent-skill-tools` |
| Golden cases | [tests/cases.json](tests/cases.json): 4 deterministic, 2 live |

## Purpose
Explains one whitelisted method of `spice_lite` end to end: the `/api/method/...` route, the `@frappe.whitelist` rules (`methods`, `allow_guest`), argument coercion, every permission check and every read that bypasses one (`frappe.get_all`), the controller methods and `doc_events` that run on writes, the SQL Frappe sends on PostgreSQL 16 in order with the index each statement can use, the HTTP statuses, the `log_access` audit call and the covering tests. Every row cites a `path:line` read in the session; the SQL comes from `reference.md`, which was captured on the course bench, not from memory.

## Inputs and arguments
`$ARGUMENTS`: one dotted method path (`spice_lite.api.fhir.get_patient`, `search_patients`, `create_observation` or `lastn`). Three context injections run at load time: the `@frappe.whitelist` grep over the app, `scripts/doctype_summary.py` (naming, `search_index`, `unique`, `reqd`, Links and DocPerm rows per DocType, read from the DocType JSON) and a grep of the permission-related keys in `hooks.py`.

## Output contract
Markdown with the sections fixed in `SKILL.md` ("Output format"): Request flow table, SQL (PostgreSQL, warm caches) with a statements-per-request line, Responses table, Permissions/audit/PHI, Test coverage, Notes and risks.

## Bench assumptions
None at run time. `reference.md` records captures made with `docs/tutorials/level-2/tools/capture_sql.py` on `test.localhost` (Frappe 15, PostgreSQL 16).

## Cost notes
Default model; one skill turn plus about 10 to 20 Read/Grep calls. The three injections add about 2 KB to the prompt.

## How it is tested
Deterministic cases run a fixed command from `AI-SDLC-frappe/` and compare the exit code and output; they need no model and no bench and were run on 2026-09-30 (all pass). Live cases need Claude Code and a model and are graded against `expect` by hand or through the eval harness (module 09-agent-evaluation).

```bash
cd AI-SDLC-frappe
# ee-01-injections-run: The three load-time injections run and see 4 whitelisted methods, 4 DocTypes and a commented-out doc_events
grep -rn -A1 "@frappe.whitelist" sample-app/spice_lite/spice_lite --include=*.py | grep -c whitelist; python3 .claude/skills/explain-endpoint/scripts/doctype_summary.py | wc -l; grep -nE "^#? ?(doc_events|permission_query_conditions|has_permission|override_whitelisted_methods|override_doctype_class)" sample-app/spice_lite/spice_lite/hooks.py
# ee-02-docperm-from-json: doctype_summary.py reads the DocPerm rows from the SL Observation JSON
python3 .claude/skills/explain-endpoint/scripts/doctype_summary.py | grep '^SL Observation' | grep -o 'perms: .*'
# ee-03-bad-app-dir: doctype_summary.py exits 2 with a clear message when the app directory does not exist
python3 .claude/skills/explain-endpoint/scripts/doctype_summary.py /nonexistent; echo "exit=$?"
# ee-04-read-only-allowlist: allowed-tools pre-approves only reads, grep and the summary script: no bench, no edit
sed -n '/^allowed-tools:/,/^---/p' .claude/skills/explain-endpoint/SKILL.md
```

## Known limitations
- Only the four whitelisted methods in `api/fhir.py` have observed SQL in `reference.md`; for any other method the SQL section is labelled "not observed".
- `search_index: 1` in DocType JSON is not proof of a Postgres index; the skill relies on the index list in `reference.md`, which must be re-captured after a schema change.

## Change policy
Follow `skills/README.md`: a change to the output contract or the arguments is MAJOR, a new capability or case is MINOR, a wording or false-positive fix is PATCH. Re-run the deterministic cases before every release and the live cases before a MINOR or MAJOR one.
