# spice_lite: the Frappe reference app for AI-SDLC

A small, **real, tested** Frappe v15 app modelled on `spice_next_core`, the Frappe clinical core.
It has three clinical DocTypes (Patient, Encounter, Observation), a per-country `SL Country`, and a
FHIR-lite whitelisted API. It is the codebase the course's agents and skills work against.

- App: `spice_lite` · title "Spice Lite" · publisher "AI-SDLC Course" · MIT
- Tested on **Frappe `version-15`** (15.121.2, commit `fd533e8d`) with **PostgreSQL 16** (primary) and **MariaDB 10.11**
- 46 tests (37 integration + 9 unit) pass on both databases and inside the Docker stack
- One deliberate teaching defect and five discovered defects: see [`docs/KNOWN_DEFECTS.md`](docs/KNOWN_DEFECTS.md)

```
sample-app/
├── spice_lite/                      # the Frappe app (standard layout)
│   ├── pyproject.toml  license.txt  README.md
│   └── spice_lite/
│       ├── hooks.py  modules.txt  patches.txt  install.py  audit.py  demo.py
│       ├── api/fhir.py              # whitelisted FHIR-lite endpoints
│       ├── api/mappers.py           # pure mappers (no frappe import)
│       ├── clinical/doctype/{sl_country,sl_patient,sl_encounter,sl_observation}/
│       ├── patches/v0_1/backfill_patient_country.py
│       └── tests/{utils.py,test_fhir_api.py,unit/test_mappers.py}
├── scripts/setup-bench.sh           # idempotent bench + site setup (tested)
├── docker/{Dockerfile,docker-compose.yml}   # postgres:16 + 3x redis + frappe_docker process split (tested)
├── k8s/README.md                    # pattern and pointers to the official helm chart (not tested)
└── docs/KNOWN_DEFECTS.md
```

## 1. Run something with no bench (30 seconds)

The FHIR mappers are plain Python. Their tests need no Frappe, no database and no site:

```bash
cd sample-app/spice_lite
python -m pytest spice_lite/tests/unit          # needs pytest; or:
python -m unittest discover -s spice_lite/tests/unit -t .
```

## 2. Set up a bench (reproducible)

```bash
sudo ./sample-app/scripts/setup-bench.sh                     # PostgreSQL 16 (default)
sudo DB_TYPE=mariadb SITE=mariadb.localhost ./sample-app/scripts/setup-bench.sh   # MariaDB, 2nd site on same bench
```

Defaults: `BENCH_DIR=/home/user/frappe-bench`, `SITE=test.localhost`, `BENCH_USER=frappe`,
Postgres root user `postgres`/`postgres`, MariaDB `root`/`root`, admin password `admin`.
Every step checks whether it has already run, so you can re-run the script safely.
The script does the following:

1. **Bench user.** bench refuses to run as root, so the script creates `frappe` and writes
   `~frappe/.spice-lite-bench-env` (PATH, proxy and CA variables).
2. **Database.** Installs and starts PostgreSQL (or MariaDB with the utf8mb4 config Frappe needs) and sets the root password.
3. **Redis.** Runs `redis-server` on 13000 (cache) and 11000 (queue). Those are bench's default ports; `bench init --skip-redis-config-generation` is used.
4. **Bench init.** Runs `uv tool install frappe-bench`, then `bench init --frappe-branch version-15 --python python3.11 --skip-redis-config-generation --no-backups`.
5. **App.** Adds the app from the local path (symlink `apps/spice_lite` → this repo, `pip install -e`, add to `sites/apps.txt`).
6. **Site.** Runs `bench new-site test.localhost --db-type postgres --db-host 127.0.0.1 --db-root-username postgres --db-root-password … --admin-password admin`,
   then `bench use`, `set-config allow_tests true`, `install-app spice_lite` and `migrate`.

Equivalent manual commands, as the bench user:

```bash
bench init frappe-bench --frappe-branch version-15 --python python3.11 --skip-redis-config-generation
cd frappe-bench
ln -s /path/to/sample-app/spice_lite apps/spice_lite     # "get-app from a local path"
./env/bin/pip install -e apps/spice_lite
echo spice_lite >> sites/apps.txt                           # make sure the file ends with a newline first
bench new-site test.localhost --db-type postgres --db-host 127.0.0.1 \
  --db-root-username postgres --db-root-password postgres --admin-password admin
bench --site test.localhost set-config allow_tests true
bench --site test.localhost install-app spice_lite
```

`bench get-app --soft-link <path>` does the same three steps, but only when `<path>` is its own git
repository. Here the app is a sub-folder of the course repo, and get-app fails with
`'App' object has no attribute 'org'`.

**Postgres vs MariaDB:** production (`spice_next_core`) runs Postgres 16, so this is the default.
Frappe v15 itself warns at `new-site`: *"PostgreSQL support is limited to Frappe v16 and above. Fixes for
earlier versions will not be added."* We hit one such bug (D-2 in KNOWN_DEFECTS) and worked around it.
The suite runs green on both databases.

**Sandboxes that block `codeload.github.com`:** frappe's `package.json` pulls `air-datepicker` as a GitHub
tarball, so `yarn install` (and therefore `bench init`) fails even when `git clone` works. The script
detects this and puts a `yarn` shim on PATH during init. The shim points that one dependency at
`git+https://…#<same commit>`. As a result, `apps/frappe/package.json` and `yarn.lock` show a local diff.

## 3. Run the tests

The bench lives at `/home/user/frappe-bench`, and bench commands must run as the `frappe` user:

```bash
su - frappe -c "source ~/.spice-lite-bench-env && cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite"
```

As root you can also `cd /home/user/frappe-bench && bench --site test.localhost run-tests --app spice_lite`:
`common_site_config.json` has `"frappe_user": "frappe"`, so bench drops privileges to that user. This needs a
`bench` on root's PATH (`uv tool install frappe-bench`).

From a shell that is already the bench user (`su - frappe`, then `source ~/.spice-lite-bench-env; cd /home/user/frappe-bench`):

```bash
bench --site test.localhost run-tests --app spice_lite                          # everything (46)
bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api   # one module
bench --site test.localhost run-tests --doctype "SL Observation"                # one DocType's tests
bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_lastn_returns_latest_per_patient
bench --verbose --site test.localhost run-tests --app spice_lite                # per-test names
bench --site mariadb.localhost run-tests --app spice_lite                       # same suite on MariaDB
```

`run-tests` also picks up `tests/unit/test_mappers.py`, which is why it uses `unittest` and not pytest
(the bench venv has no pytest). The line `Error in query: invalid input syntax for type timestamp` in the
output on Postgres is expected: it comes from the test that pins framework defect D-2.

## 4. Data model

| DocType | Naming | Key fields |
|---|---|---|
| `SL Country` | `field:country_code` (ISO alpha-2, normalised to upper case in `autoname`) | `country_code` (unique), `country_name` |
| `SL Patient` | `SLP-.#####` | `mrn` (Data, unique, reqd), `first_name`, `last_name` (search_index), `gender` (male/female/other/unknown), `birth_date` (not in the future), `active` (default 1), `country` → SL Country (search_index) |
| `SL Encounter` | `SLE-.#####` | `patient` (reqd), `encounter_date`, `encounter_type` (screening/assessment/follow-up), `status` (planned/in-progress/finished), `practitioner` → User |
| `SL Observation` | `SLO-.#####` | `patient` (reqd), `encounter`, `code` (LOINC), `code_display`, `status` (registered/preliminary/final/amended), `effective_datetime`, `value`, `unit`, `replaces` |

**Why the series and not the MRN as the name:** the MRN is an identifier, which makes it PHI. A document
name ends up in URLs, Link fields, the version log, error logs and our audit log. An opaque `SLP-00042`
keeps the MRN out of all of those.

**Observation rules:** `final` and `amended` need both a value and a unit. Once an Observation is final
(or amended) it is immutable: every edit or delete raises `FinalObservationError`. To correct one, insert
a **new** Observation with `status=amended` and `replaces=<old name>`.

**Roles:** `Clinician` (read/write/create on Patient, Encounter and Observation, read on Country, **no delete**)
and `System Manager` (everything). `Clinician` is created by `after_install` and re-ensured by `after_migrate`
(`spice_lite/install.py`). It is not shipped as a fixture, so new and old sites end up in the same state.

**Patch:** `patches.txt` → `[post_model_sync] spice_lite.patches.v0_1.backfill_patient_country`. It sets
`country` on patients that have none, taking the value from site config (`bench --site X set-config spice_lite_country_code KE`).

**Audit:** `spice_lite/audit.py` logs `{action, doctype, names, user, counts}` through `frappe.logger("spice_lite.audit")`
to `logs/spice_lite.audit.log` and `sites/<site>/logs/spice_lite.audit.log`. It logs doc names only:
no field values and no search terms.

## 5. API (FHIR-lite)

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/method/spice_lite.api.fhir.get_patient?name=SLP-00001` | `Patient`; 404 or 403 `OperationOutcome` |
| GET | `/api/method/spice_lite.api.fhir.search_patients?family=Oti` / `?identifier=urn:spice-lite:mrn\|DEMO-0001` | `Bundle` (searchset). No params → **400** `OperationOutcome` (`required`). `%`/`_`/`\` → 400 (`invalid`) |
| POST | `/api/method/spice_lite.api.fhir.create_observation` | JSON body. Returns **201** `Observation`; validation errors → 422 `OperationOutcome` |
| GET | `/api/method/spice_lite.api.fhir.lastn?subjects=["SLP-00001","SLP-00002"]&code=8480-6` | `Bundle` with the latest Observation per patient (**contains the N+1 teaching defect**) |

Frappe wraps every return value as `{"message": <resource>}`. HTTP status comes from
`frappe.local.response.http_status_code`. No endpoint is `allow_guest`, so a guest gets Frappe's own 403.
Standard REST also works, and DocType permissions still apply: `/api/resource/SL Patient`,
`/api/resource/SL Patient/SLP-00001`.

### Try it with curl (synthetic users only)

```bash
# as the bench user, in /home/user/frappe-bench
bench --site test.localhost execute spice_lite.demo.seed_demo
# -> {"patients": [...], "clinician@spice-lite.test": "<api_key>:<api_secret>", "norole@spice-lite.test": "..."}
bench serve --port 8000        # dev server; test.localhost is the default site
```

```bash
TOKEN='<api_key>:<api_secret>'          # from seed_demo, clinician@spice-lite.test
BASE=http://127.0.0.1:8000/api/method/spice_lite.api.fhir
curl -s -H "Authorization: token $TOKEN" "$BASE.search_patients?family=Otieno"
curl -s -w '\n%{http_code}\n' -H "Authorization: token $TOKEN" "$BASE.search_patients"          # 400 OperationOutcome
curl -s -H "Authorization: token $TOKEN" "$BASE.get_patient?name=SLP-00001"
curl -s -H "Authorization: token $TOKEN" -G "$BASE.lastn" \
     --data-urlencode 'subjects=["SLP-00001","SLP-00002"]' --data-urlencode code=8480-6
curl -s -X POST -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' "$BASE.create_observation" \
     -d '{"patient":"Patient/SLP-00002","code":"8480-6","value":124,"unit":"mm[Hg]","effective_datetime":"2026-09-30 09:00:00"}'
curl -s -o /dev/null -w '%{http_code}\n' "$BASE.search_patients?family=Otieno"                   # guest -> 403
```

All of these were run against the bench and gave the responses described above. `seed_demo` refuses to run
unless the site has `allow_tests` or `developer_mode` set. Re-running it rotates the API secrets.

**Test users** (made by `spice_lite/tests/utils.py::ensure_test_users`, synthetic `.test` domain):
`clinician@spice-lite.test` (role Clinician) and `norole@spice-lite.test` (no roles).

## 6. Docker (tested) and Kubernetes (pattern only)

```bash
cd sample-app/docker
docker compose up -d --build            # builds spice-lite:dev on frappe/erpnext:v15.121.5
docker compose logs -f create-site      # wait for "spice_lite installed"
curl -s http://localhost:8080/api/method/ping
docker compose exec backend bench --site frontend run-tests --app spice_lite
docker compose exec backend bench --site frontend execute spice_lite.demo.seed_demo
docker compose down -v
```

The stack is adapted from frappe_docker's `pwd.yml` and switched to `postgres:16-alpine`. It runs three Redis
containers (cache, queue, socketio) to mirror the production topology. Frappe v15 does not read
`redis_socketio`: realtime uses `redis_queue`. Kubernetes: see [`k8s/README.md`](k8s/README.md).
