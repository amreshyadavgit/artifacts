# Frappe decision guide for architecture reviews

The options below are the ones a spice-style Frappe platform actually has. For each requirement, decide each axis explicitly and cite the evidence. Facts come from `build/FRAPPE_FACTS.md` (verified in Frappe v15.121.2) and from the code paths cited.

## Axis 1: where does the change live?

| Option | Use when | Mechanism | Costs and traps |
|---|---|---|---|
| Core change in `spice_lite` (DocType JSON, controller, `api/`) | Every country needs it; it is clinical-core behaviour | Edit DocType JSON plus a patch in `patches.txt` when data must change; controller methods; whitelisted method in `api/fhir.py` | Every deployment gets it. A `reqd` field without a backfill patch makes every save of an existing record raise `MandatoryError` after migrate. `bench run-tests` does not migrate, so CI stays green. |
| Country app (installed on one country's site) | One country needs a field, label, default or rule | Custom Field and Property Setter records exported as fixtures (`hooks.py` `fixtures`, `bench export-fixtures`); `doc_events` for behaviour | Fixtures are overwritten on every install and migrate (`frappe/utils/fixtures.py`), so desk edits to them are lost. Core code with fixed field lists (`PATIENT_FIELDS` in `api/fhir.py`) does not see Custom Fields. |
| Integration app (`required_apps = ["spice_lite"]`) | An external system is involved (telephony, national ID registry, ERPNext) and more than one country may use it | Own DocTypes or Custom Fields, own `doc_events`, own background jobs; `install_app` installs required apps first (`frappe/installer.py`) | Owns credentials (API key per integration user or site config via `bench set-config`) and its failure modes. ERPNext is an external target reached over its REST API, never a `required_apps` entry of the clinical core. |
| Extension point in core (new `hooks.py` key read with `frappe.get_hooks`) | Several apps must plug into the same core behaviour | App-defined key, for example `spice_lite_identifier_systems = {...}`; dict values from all apps are merged into lists (`append_hook`) | A new key is a public contract: document it in an ADR (`.claude/rules/doctype-json.md`). Reading it on every request costs a cached lookup, not a query. |

## Axis 2: controller method or `doc_events`?

| Choose | When |
|---|---|
| Controller method (`validate`, `on_update`, `on_trash` in `<doctype>.py`) | The rule belongs to the DocType's own app and holds in every deployment (MRN uniqueness, final Observation immutability). |
| `doc_events` in another app's `hooks.py` | The behaviour belongs to a country or integration app. Several apps may register for the same event; all run (`frappe.get_doc_hooks`). |
| `override_doctype_class` | Avoid: only one app can win, and two integration apps overriding `SL Patient` conflict silently. |
| `permission_query_conditions` / `has_permission` Frappe hooks | Row-level visibility. `permission_query_conditions` applies to `frappe.get_list` only (not `get_all`, `qb`, `db.sql`); `has_permission` can only deny. Any request path using `get_all` (for example `lastn` today) ignores them. |

## Axis 3: synchronous or `frappe.enqueue`?

| Choose | When |
|---|---|
| Synchronous in the request | Pure validation and local writes that finish in milliseconds. |
| `frappe.enqueue(method, queue="short", timeout=60, job_id=..., deduplicate=True, enqueue_after_commit=True, **kwargs)` | External calls (registries, ERPNext, SMS), anything over about a second, anything that may be retried. Queues: `short` and `default` time out at 300 s, `long` at 1500 s. `enqueue_after_commit=True` avoids a job running before the triggering document is committed. |
| `scheduler_events` (`hourly`, `daily`, `cron`) | Retries, reconciliation, batch work that no user waits for. |

Job keyword arguments are stored in redis and shown in desk: the `RQ Job` virtual DocType sets `arguments=frappe.as_json(job.kwargs)` (`frappe/core/doctype/rq_job/rq_job.py`). Pass document names, never PHI values.

## Axis 4: read path and permissions
- Request paths read with `frappe.get_list` (permission-aware) or `frappe.has_permission` + `frappe.get_doc`. `frappe.get_all`, `frappe.qb` and `frappe.db.sql` bypass DocType permissions, User Permissions and `permission_query_conditions`.
- A set-based rewrite with a window function (`frappe.qb` or raw SQL) needs its own permission check first.

## Axis 5: data and rollout
- Unique Data fields store blank values as NULL (`frappe/model/base_document.py`), so many records without a value can coexist under a unique index on Postgres and MariaDB.
- DocType JSON changes are re-imported on migrate when their content hash changes. Data changes need a patch: `[pre_model_sync]` for work on the old schema, `[post_model_sync]` for backfills that need the new column. A patch runs once per exact line text in `patches.txt`.
- Frappe v15 on Postgres gets no more Postgres fixes: check every filter and ordering against D-2 (`("is", "set")` on Datetime) and NULL ordering (`DESC` puts NULLs first).
- One deployment per country: a decision must say which sites get which app, and in which order apps are installed.
