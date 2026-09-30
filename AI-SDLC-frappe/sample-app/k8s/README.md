# Kubernetes: the pattern (illustrative, not tested here)

We ship **no** chart and **no** values file. Use the official chart from
[github.com/frappe/helm](https://github.com/frappe/helm), chart `erpnext`, repo `https://helm.erpnext.com`.
Read its `erpnext/values.yaml` and `erpnext/README.md` for your chart version before you copy any key.
The keys named below were checked in that repo at commit `f88f6c0` (chart `8.0.82`, `appVersion: v16.36.1`),
and they can change.

## Pattern: one country = one release = one namespace

spice_next_core runs one deployment per country. On Kubernetes that becomes:

```
namespace spice-ke   -> helm release spice-ke   -> site ke.<domain>   -> its own Postgres, redis-cache, redis-queue, PVC
namespace spice-bd   -> helm release spice-bd   -> site bd.<domain>   -> its own Postgres, redis-cache, redis-queue, PVC
```

Nothing is shared between countries except the **image**. Every country runs the same versioned image,
and each country is upgraded on its own schedule.

## Steps

1. **Build an image that contains spice_lite.** Start from `docker/Dockerfile` in this repo, which sits
   on top of `frappe/erpnext:<v15 tag>`. You can also use frappe_docker's documented custom-image build
   (`images/custom/Containerfile` with an `apps.json`; see frappe_docker `docs/`). Push it to your registry.
2. **Pick a chart version that matches your Frappe major.** The latest chart defaults to v16 images
   (`image.tag`). For a v15 app, set `image.repository` / `image.tag` to your v15 image. Check whether
   the chart version you pin still supports v15 (`helm search repo frappe/erpnext --versions`).
3. **Database.** The chart supports external databases (the `dbHost`, `dbPort`, `dbRootUser`, `dbRootPassword`
   and `dbExistingSecret` keys are commented out at the top of `values.yaml`). It also has in-cluster options
   (`mariadb-sts`, `postgresql-sts`, and Bitnami subcharts). For production Postgres 16 per country, use a
   managed or operator-run Postgres and point `dbHost` at it.
4. **Redis.** Use `externalRedis.cache` and `externalRedis.queue`, or the bundled caches. Frappe v15 has no
   separate socket.io Redis: realtime rides on `redis_queue` (see `FRAPPE_FACTS.md`).
5. **Site creation job.** `jobs.createSite.enabled`, `siteName`, `installApps` (list `spice_lite`),
   `dbType`. **Read `templates/job-create-site.yaml` first.** At the commit above, it compares `dbType`
   against `"postgres"` in one place (line 75) and `"postgresql"` in another (line 137).
6. **Storage.** The worker PVC must be `ReadWriteMany` (`persistence.worker.accessModes`), because all
   pods share `sites/`.
7. **Migrations on upgrade.** Roll out the new image, then run `bench --site <site> migrate`. The chart has a
   migrate job (see `jobs.migrate` in `values.yaml`). `spice_lite`'s `after_migrate` hook re-creates the
   `Clinician` role idempotently.

## What not to do

- Don't put several countries' sites on one bench or release "because Frappe supports multi-tenancy".
  That breaks the isolation guarantee the platform relies on.
- Don't invent values keys. If a key isn't in the `values.yaml` of your pinned chart version, it does nothing.
