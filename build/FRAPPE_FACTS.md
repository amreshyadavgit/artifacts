# Frappe v15 Facts (verified in cloned source)

Source: `git clone https://github.com/frappe/frappe --branch version-15`. Frappe 15.121.2
(`frappe/__init__.py` has `__version__ = "15.121.2"`), commit `fd533e8d18617eccb7ff1122b55ad64f6a6fe7bc`
(2026-09-30). All paths are relative to `apps/frappe/` in the bench at `/home/user/frappe-bench`.
bench CLI: frappe-bench 5.31.0. Everything below was exercised by the reference app `spice_lite`
(`AI-SDLC-frappe/sample-app/`) on PostgreSQL 16 and MariaDB 10.11. That app has 46 passing tests.

---

## 1. App layout (what `bench new-app` generates, per `frappe/utils/boilerplate.py`)
```
<app>/pyproject.toml            # [project] name, dynamic=["version"]; build-backend flit_core.buildapi
<app>/license.txt  README.md  .gitignore  .pre-commit-config.yaml  .editorconfig  .eslintrc
<app>/<app>/__init__.py         # __version__ = "0.0.1"
<app>/<app>/hooks.py
<app>/<app>/modules.txt         # one Module Def per line (e.g. "Clinical")
<app>/<app>/patches.txt
<app>/<app>/<module>/           # scrubbed module name: "Clinical" -> clinical/
<app>/<app>/config/ templates/ www/ public/ patches/
```
- DocType folder: `<app>/<app>/<module>/doctype/<scrubbed_name>/{__init__.py,<name>.json,<name>.py,test_<name>.py}`.
  "SL Patient" becomes `sl_patient`, and its class is `SLPatient(Document)`.
- `pyproject.toml` bench-specific tables: `[tool.bench.dev-dependencies]` and `[tool.bench.frappe-dependencies]`
  (read by bench's `bench/app.py`), plus `[deploy.dependencies.apt]` (Frappe Cloud).
- `frappe` is **not** listed in `dependencies`. The comment says "Installed and managed by bench".

## 2. hooks.py keys (template: `frappe/utils/boilerplate.py` `hooks_template`; consumers cited)
| Key | Shape | Consumed in |
|---|---|---|
| `app_name`, `app_title`, `app_publisher`, `app_description`, `app_email`, `app_license` | str | metadata |
| `required_apps` | `["other_app"]` | `frappe/installer.py` (installed first by `install_app`); `frappe/boot.py` |
| `before_install` / `after_install` | dotted path str (or list) | `frappe/installer.py` `install_app()`. `before_install` returning `False` aborts |
| `before_uninstall` / `after_uninstall`, `before_app_install` / `after_app_install` (receive the app name) | dotted path | installer |
| `after_sync` | dotted path | `frappe/installer.py`, after fixtures and customizations sync |
| `before_migrate` / `after_migrate` | list of dotted paths | `frappe/migrate.py` (lines ~114 and ~156) |
| `fixtures` | `["Role", {"dt": "Role", "filters": [["name","in",["X"]]]}]` | `frappe/utils/fixtures.py`. Exported by `bench export-fixtures` to `<app>/fixtures/*.json`; imported (overwritten) on install and migrate |
| `doc_events` | `{"DocType" or "*": {"on_update": "path" or [paths], ...}}` | `frappe/__init__.py` `get_doc_hooks()` (line ~1583), run in `Document.run_method` |
| `scheduler_events` | `{"all"/"hourly"/"daily"/"weekly"/"monthly": [paths], "cron": {"0 1 * * *": [paths]}}` (also `hourly_long`, `daily_long`, ... per `frappe/hooks.py`) | `frappe/core/doctype/scheduled_job_type/scheduled_job_type.py` |
| `permission_query_conditions` | `{"DocType": "path.fn(user)"}` returns a SQL WHERE fragment | `frappe/model/db_query.py` (lines ~870, ~1482). Applies to **get_list only**, not get_all |
| `has_permission` | `{"DocType": "path.fn(doc, ptype, user)"}` | `frappe/permissions.py` `has_controller_permissions()`. **Can only deny** (return False); it cannot grant |
| `override_whitelisted_methods` | `{"orig.dotted.path": "new.dotted.path"}` | `frappe/__init__.py` (line ~2555) |
| `override_doctype_class` | `{"ToDo": "app.overrides.CustomToDo"}` | controller loading |
| `before_tests` | dotted path | `frappe/test_runner.py` (line ~86), unless `--skip-before-tests` |
| `before_request` / `after_request`, `before_job` / `after_job`, `auth_hooks`, `user_data_fields`, `export_python_type_annotations`, `ignore_links_on_delete`, `auto_cancel_exempted_doctypes` | see template | |

spice_lite uses `required_apps = []`, `after_install = "spice_lite.install.after_install"` and `after_migrate = [...]`.
It creates the `Clinician` Role idempotently in code; there is no fixture.

## 3. DocType JSON essentials (field lists from `frappe/core/doctype/{doctype,docfield,docperm}/*.json`)
- Top level: `doctype: "DocType"`, `name`, `module`, `fields` (list), `field_order` (list of fieldnames),
  `permissions` (list of DocPerm), `autoname`, `naming_rule`, `title_field`, `search_fields` (comma str),
  `sort_field`, `sort_order` (ASC/DESC), `track_changes`, `is_submittable`, `istable`, `issingle`,
  `engine` ("InnoDB"), `modified`. On `bench migrate`, a DocType JSON is re-imported when its content hash differs from the stored
  `migration_hash`. Other synced docs (Report, Page, ...) are re-imported only if the JSON `modified` is newer than the DB value
  (`frappe/modules/import_file.py`, lines ~124-145),
  `links`, `actions`, `states`, `show_title_field_in_link`.
- `naming_rule` options: `Set by user`, `Autoincrement`, `By fieldname`, `By "Naming Series" field`, `Expression`,
  `Expression (old style)`, `Random`, `By script`.
  - `autoname` examples: `field:country_code`, `SLP-.#####` (old-style expression), `hash`, `autoincrement`, `naming_series:`, `prompt`.
- DocField keys: `fieldname`, `fieldtype`, `label`, `options` (Select choices separated by `\n`; Link target DocType),
  `reqd`, `unique`, `search_index`, `default`, `in_list_view`, `in_standard_filter`, `read_only`, `hidden`,
  `depends_on`, `mandatory_depends_on`, `read_only_depends_on`, `fetch_from`, `permlevel`, `length`, `no_copy`,
  `set_only_once`, `non_negative`, `description`.
- Fieldtypes include Data, Link, Dynamic Link, Select, Check, Int, Float, Currency, Percent, Date, Datetime, Time,
  Text, Small Text, Long Text, Text Editor, JSON, Table, Table MultiSelect, Attach, Password, Section/Column/Tab Break.
- DocPerm keys: `role`, `permlevel`, `if_owner`, `read`, `write`, `create`, `delete`, `submit`, `cancel`, `amend`,
  `report`, `export`, `import`, `share`, `print`, `email`, `select`.
- A Link to a Role that doesn't exist yet is fine during sync: `frappe/modules/import_file.py` sets `doc.flags.ignore_links = True`.
- **Float, Int and Check columns are NOT NULL DEFAULT 0.** `BaseDocument.get_valid_dict` coerces `None` to `flt(None) = 0.0`
  (`frappe/model/base_document.py`). A missing value can't be told apart from 0 after save.

## 4. Controller lifecycle (`frappe/model/document.py`, `naming.py`, `delete_doc.py`)
- **insert():** `_set_defaults` → `check_permission("create")` → `before_insert` → `set_new_name` (`before_naming`, then
  `autoname`) → `before_validate` → `validate` → `before_save` → `_validate` (mandatory, links, lengths) → `db_insert` →
  `after_insert` → `on_update` → `on_change`.
- **save():** `before_validate` → `validate` → `before_save` → db_update → `on_update` → `on_change`.
- **submit** (`is_submittable`): `validate` → `before_submit` → `on_submit`. **cancel:** `before_cancel` → `on_cancel`.
  After submit: `before_update_after_submit` → `on_update_after_submit`.
- **delete** (`frappe.delete_doc`): permission check → `on_trash` → `on_change` → delete → `after_delete`.
  **rename:** `before_rename` / `after_rename`.
- `self.get_doc_before_save()` returns the DB version during save (None on insert). `self.is_new()`,
  `self.has_value_changed(field)`.
- A controller method `autoname(self)` overrides the JSON `autoname`. It runs **before** `validate`, so normalise
  there anything the name depends on (spice_lite `SLCountry.autoname`).
- `doc.insert()` / `doc.save()` / `frappe.delete_doc()` check permissions. `ignore_permissions=True` or `doc.flags.ignore_permissions` skips the check.

## 5. Whitelisting and HTTP (`frappe/__init__.py` line 829, `frappe/handler.py`, `frappe/api/`)
- `def whitelist(allow_guest=False, xss_safe=False, methods=None)`. `methods` defaults to `["GET","POST","PUT","DELETE"]`.
  Registries: `frappe.whitelisted`, `frappe.guest_methods`, `frappe.allowed_http_methods_for_whitelisted_func`.
- The wrong HTTP verb gives `throw_permission_error()` (**403**, not 405): `frappe/handler.py` `is_valid_http_method`.
- Arguments come from `frappe.form_dict` (`frappe.call(method, **frappe.form_dict)`). **Type hints are enforced** through pydantic
  (`frappe/utils/typing_validations.py`) when there is a request or `flags.in_test`. Lax coercion applies: `"72"` becomes `72.0` for `float`.
- The return value is serialised as `{"message": <value>}`. Set the status with `frappe.local.response.http_status_code = 4xx`
  (read in `frappe/utils/response.py`). Uncaught `frappe.PermissionError` gives 403. `ValidationError` gives 417. `DoesNotExistError` gives 404.
- Routes (`frappe/api/v1.py`): `/api/method/<dotted.path>`, `GET|POST /api/resource/<DocType>`,
  `GET|PUT|DELETE|POST /api/resource/<DocType>/<name>`. v2 (`frappe/api/v2.py`): `/api/v2/method/...`,
  `/api/v2/document/<DocType>[/<name>]`, `/api/v2/doctype/<DocType>/meta`. REST list defaults to 20 rows.
- Token auth (`frappe/auth.py` `validate_auth_via_api_keys`): header `Authorization: token <api_key>:<api_secret>`, or
  `Authorization: Basic base64(<api_key>:<api_secret>)`. Keys come from `frappe.core.doctype.user.user.generate_keys(user)`
  (System Manager only; returns `api_secret` once).
- A guest calling a non-guest method gets 403 with "... is not whitelisted".

## 6. Permissions
- `frappe.has_permission(doctype=None, ptype="read", doc=None, user=None, throw=False, *, parent_doctype=None, ...)` returns a bool.
  It raises `frappe.PermissionError` only if `throw=True`. `doc` may be a Document or a name.
- `frappe.get_list(doctype, **kw)` is a permission-aware `DatabaseQuery.execute`. It raises `PermissionError` if the user has no read
  permission, and applies user permissions and `permission_query_conditions`. **The Python default has no limit** (`limit_page_length=None`).
  The docstring's "Default 20" is stale; only REST and `frappe.client.get_list` default to 20.
- `frappe.get_all(doctype, **kw)` is `get_list` with `ignore_permissions=True` and `limit_page_length=0` unless given (`frappe/__init__.py` line 2043).
- `DatabaseQuery.execute` kwargs: `fields, filters, or_filters, docstatus, group_by, order_by, limit_start, limit_page_length,
  as_list, debug, ignore_permissions, user, distinct, start, page_length, limit, pluck, run, strict, parent_doctype`.
- `doc.check_permission("read")` raises. `frappe.only_for(roles)` raises unless the user has one of the roles.
- `frappe.set_user(user)` resets `local.session.user`, `role_permissions` and `user_perms` (used in tests). Roles are cached per user in redis (`frappe.cache.hget("roles", user)`).
- A user with no desk roles is a "Website User". `has_permission` returns False for our DocTypes.

## 7. Database
- `frappe.db.sql(query, values=(), *, as_dict=0, as_list=0, debug=0, ..., pluck=False, as_iterator=False)`
  (`frappe/database/database.py` line 147). Placeholders: tuple/list values use `%s`, dict values use `%(name)s`.
  Write backtick identifiers (`` `tabSL Patient` ``). On Postgres, `modify_query()` (`frappe/database/postgres/database.py`)
  rewrites backticks to `"` and quotes bare integer literals.
- `frappe.db.get_value(doctype, filters=None, fieldname="name", ignore=None, as_dict=False, ..., for_update=False, *, pluck=False)`,
  `frappe.db.exists`, `frappe.db.set_value`, `frappe.db.count`, `frappe.db.savepoint(name)`, `frappe.db.rollback(save_point=name)`,
  `frappe.db.commit()`, `frappe.db.db_type` ("postgres" or "mariadb").
- `frappe.qb` is the per-site PyPika builder (`frappe/__init__.py` `local.qb = get_query_builder(db_type)`), e.g.
  `t = frappe.qb.DocType("SL Patient"); frappe.qb.update(t).set(t.country, "KE").where(t.country.isnull()).run()`.
  **qb and db.sql bypass permissions.**
- Postgres: `like` filters become `ilike` (`db_query.py` ~1300). **v15 + Postgres bug:** the filter `("is","set")` renders
  `col != ''`, which is invalid for timestamp columns, and any SQL error **aborts the transaction**
  (`InFailedSqlTransaction` until rollback). `ORDER BY x DESC` puts NULLs first on PG and last on MariaDB.
  `bench new-site --db-type postgres` prints: "PostgreSQL support is limited to Frappe v16 and above. Fixes for earlier versions will not be added."
- LIKE filter values: frappe doubles backslashes (`db_query.py`: `value.replace("\\","\\\\").replace("%","%%")`), so a
  user's `%` stays a wildcard and cannot be escaped through filters.

## 8. Cache, jobs, realtime, logging
- `frappe.cache` is a `RedisWrapper` instance (`frappe/utils/redis_wrapper.py`). `frappe.cache()` still works through a back-compat `__call__`.
  API: `set_value(key, val, user=None, expires_in_sec=None, shared=False)`, `get_value(key, generator=None, user=None, expires=False, shared=False)`,
  `delete_value(keys, ...)`, `hset/hget(name, key, generator=None)`, `hgetall`, `get_keys`, `delete_keys`. Decorators in `frappe/utils/caching.py`:
  `@request_cache`, `@site_cache(ttl=None, maxsize=None)`, `@redis_cache(ttl=3600, user=None, shared=False)`.
- `frappe.enqueue(method, queue="default", timeout=None, event=None, is_async=True, job_name=None, now=False,
  enqueue_after_commit=False, *, on_success=None, on_failure=None, at_front=False, job_id=None, deduplicate=False, **kwargs)`
  (`frappe/utils/background_jobs.py` line 59). Queues: `short` (300 s), `default` (300 s), `long` (1500 s), plus custom `workers` in common_site_config.
  `frappe.enqueue_doc(doctype, name, method, queue="default", timeout=300, now=False, **kwargs)`.
- Redis config keys: `redis_cache`, `redis_queue`. **`redis_socketio` is not read by v15 code.** Realtime pub/sub uses `redis_queue`
  (`node_utils.js` `get_redis_subscriber(kind="redis_queue")`; `FRAPPE_REDIS_CACHE` and `FRAPPE_REDIS_QUEUE` env override it). bench still writes `redis_socketio`.
- `frappe.logger(module=None, with_more_info=False, allow_site=True, filter=None, max_size=100_000, file_count=20)`
  (`frappe/utils/logger.py`). It writes to `<bench>/logs/<module>.log` and `<bench>/sites/<site>/logs/<module>.log`.
  **The level defaults to ERROR (WARNING under `bench serve`), so `.info()` is dropped unless you `setLevel`.**
  `with_more_info=True` appends `frappe.form_dict` (request params, which can be PHI) to every line.

## 9. Tests (v15)
- Base class: **`from frappe.tests.utils import FrappeTestCase`** (`frappe/tests/utils.py` line 20, subclasses `unittest.TestCase`).
  **`IntegrationTestCase` and `UnitTestCase` do not exist in v15** (grep finds nothing; they arrive in v16).
  `setUpClass` commits first, then registers a class-level rollback (`_rollback_db`). Data created in tests is rolled back
  at class end, so use unique values (MRNs) across tests in the same class. If you override `setUpClass`, call `super().setUpClass()`.
- Helpers: `assertQueryCount(n)` (asserts `<= n` SQL calls; **raises TypeError on Postgres in v15.121.2**, verified on this bench, see KNOWN_DEFECTS D-10), `assertRedisCallCounts`, `assertRowsRead`, `assertDocumentEqual`,
  `primary_connection()` / `secondary_connection()`. Module-level `test_dependencies`, `test_ignore`, `test_records` and
  `_make_test_records` are used by `frappe/test_runner.py` `make_test_records`. It auto-creates records for Link targets
  (e.g. frappe's `User` test records) and **commits** them.
- `bench --site <site> run-tests` options (`frappe/commands/utils.py`): `--app`, `--doctype`, `--module-def`, `--module <dotted.module>`,
  `--case <TestCase>`, `--test <test_method>` (repeatable; used with `--module`/`--doctype`), `--doctype-list-path`, `--profile`,
  `--coverage`, `--skip-test-records`, `--skip-before-tests`, `--junit-xml-output`, `--failfast`. There is **no** `--verbose` on run-tests;
  use `bench --verbose --site X run-tests ...`. It requires `allow_tests` in site config (or env `CI`). `bench run-parallel-tests` also exists.
- `run-tests --app` imports **every** `test_*.py` under the app, including pure unit tests. The bench venv has no pytest, so
  such modules must not `import pytest`.

## 10. bench and site commands used (commands in `frappe/commands/*.py`; bench 5.31)
- `bench init <dir> --frappe-branch version-15 --python python3.11 --skip-redis-config-generation --no-backups [--frappe-path URL]`.
  bench refuses root ("You should not run this command as root") unless `frappe_user` is set in `common_site_config.json`, in
  which case it drops privileges (`bench/cli.py` `change_uid`).
- `bench get-app <url|path> [--soft-link] [--skip-assets] [--branch]`. A path must be its own git repo (for a subfolder of
  a repo it fails with `'App' object has no attribute 'org'`). The manual equivalent: `ln -s`, `./env/bin/pip install -e apps/<app>`, add to `sites/apps.txt`.
- `bench new-site <site> --db-type {mariadb|postgres} --db-host H --db-port P --db-root-username U --db-root-password P --admin-password A [--install-app X] [--set-default]`
  (`--mariadb-root-username`/`--mariadb-root-password` are aliases).
- `bench --site S install-app X`, `uninstall-app`, `list-apps`, `migrate`, `run-patch <dotted>`, `console` (IPython), `execute <dotted.fn> --args "[...]" --kwargs "{...}"`
  (connects as Administrator; commits), `set-config KEY VALUE [-g global] [-p parse as Python literal]`, `use S`, `serve --port 8000`,
  `export-fixtures`, `backup`, `restore`, `add-system-manager`, `set-admin-password`, `clear-cache`, `reload-doc`.

## 11. patches.txt (`frappe/modules/patch_handler.py`)
```
[pre_model_sync]
# runs BEFORE doctype JSON sync, so the old schema is still in place
app.patches.v1_0.rename_x
execute:frappe.db.set_default("x", 1)      # inline python
[post_model_sync]
# runs AFTER schema sync; use it for data patches that need new columns
spice_lite.patches.v0_1.backfill_patient_country
finally:app.patches.cleanup                 # "finally:" patches run last
```
- A patch module exposes `def execute():`. Done-ness is recorded in `Patch Log` by the **exact line text**, so changing a trailing
  comment (`#2024-01-01`) makes the patch run again. A new install marks every existing patch as done (`set_as_patched`).
- The old format (a plain list, no sections) is still accepted and runs as pre-model-sync.

## 12. DO NOT INVENT (things that are not in v15, or are commonly misremembered)
- `IntegrationTestCase` / `UnitTestCase` (v16 only). In v15 use `FrappeTestCase`.
- `frappe.get_all` does **not** check permissions. Don't describe it as permission-aware.
- `run-tests --verbose` doesn't exist (the flag goes on `bench`). `run-tests --site` goes before the command: `bench --site S run-tests`.
- `@frappe.whitelist(methods=[...])` violations return 403, not 405.
- `redis_socketio` is not a live setting in v15. Don't claim socket.io needs its own Redis.
- `has_permission` hooks cannot grant access. `permission_query_conditions` doesn't affect `get_all`, `qb` or `db.sql`.
- `frappe.cache.get_value/set_value` namespace keys per site (`make_key`). `RedisWrapper` subclasses `redis.Redis`, so raw `get/set` exist too, but they skip the site prefix.
- `frappe.get_list` has no default 20-row limit in Python.
- Frappe v15 Postgres: "supported" but frozen ("fixes ... will not be added"). Don't promise parity with MariaDB.
- `bench new-site --db-type postgresql` is invalid; the choice is `postgres`.
