#!/usr/bin/env bash
# Proves that the seeded defects in country-roster.patch are real, then leaves the app unchanged.
# Course tooling (module 05-agent-roster). Run as the bench user from anywhere:
#   agents/reviewer/fixtures/verify-fixture.sh                 Python defects on $SITE (no schema change)
#   agents/reviewer/fixtures/verify-fixture.sh --scratch-site  also migrate the DocType JSON change on a
#                                                              throw-away site, run test_sl_patient there,
#                                                              then drop that site
# Env: BENCH_DIR (default /home/user/frappe-bench), SITE (default test.localhost),
#      SCRATCH_SITE (default scratch-reviewer.localhost), DB_ROOT_USER/DB_ROOT_PASSWORD (postgres/postgres),
#      BENCH (default: bench on PATH; set it to a wrapper when the repo and the bench belong to different users).
# Never run it against a shared or production site: it applies a patch to the app source while it runs.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/../../.." && pwd)"                 # AI-SDLC-frappe/
APP_PKG="$PROJECT/sample-app/spice_lite/spice_lite"
BENCH_DIR="${BENCH_DIR:-/home/user/frappe-bench}"
SITE="${SITE:-test.localhost}"
SCRATCH_SITE="${SCRATCH_SITE:-scratch-reviewer.localhost}"
MODULE=spice_lite.tests.test_country_roster_defects
BENCH="${BENCH:-bench}"
SCRATCH=0
[[ "${1:-}" == "--scratch-site" ]] && SCRATCH=1

cleanup() {
  rm -f "$APP_PKG/tests/test_country_roster_defects.py"
  if ! (cd "$PROJECT" && patch -p1 -R -s -f --dry-run < "$HERE/country-roster.patch" >/dev/null 2>&1); then
    return 0                                                # not applied (or already reverted)
  fi
  (cd "$PROJECT" && patch -p1 -R -s < "$HERE/country-roster.patch")
  echo "reverted country-roster.patch"
}
trap cleanup EXIT
# keep only result lines and drop the dotted class path bench --verbose prints after each test name
show() { grep -E "$1" | sed -E 's/ \(spice_lite\.[^)]*\)//' || true; }

cd "$PROJECT"
patch -p1 --dry-run < "$HERE/country-roster.patch"
patch -p1 -s < "$HERE/country-roster.patch"
echo "applied country-roster.patch"

cd "$BENCH_DIR"
echo "== existing suite on $SITE (the seeded defects are invisible to it)"
$BENCH --site "$SITE" run-tests --app spice_lite 2>&1 | show '^(Ran|OK|FAILED)'
cp "$HERE/test_country_roster_defects.py" "$APP_PKG/tests/"
echo "== defect proofs on $SITE"
$BENCH --verbose --site "$SITE" run-tests --module "$MODULE" 2>&1 | show ' \.\.\. |^(Ran|OK|FAILED)'

if [[ $SCRATCH == 1 ]]; then
  echo "== DocType JSON change on throw-away site $SCRATCH_SITE"
  $BENCH new-site "$SCRATCH_SITE" --db-type postgres --db-host 127.0.0.1 \
    --db-root-username "${DB_ROOT_USER:-postgres}" --db-root-password "${DB_ROOT_PASSWORD:-postgres}" \
    --admin-password admin --install-app spice_lite >/dev/null 2>&1
  $BENCH --site "$SCRATCH_SITE" set-config allow_tests true >/dev/null
  $BENCH --verbose --site "$SCRATCH_SITE" run-tests --module spice_lite.clinical.doctype.sl_patient.test_sl_patient 2>&1 \
    | show ' \.\.\. |^(Ran|OK|FAILED)|AssertionError'
  $BENCH --verbose --site "$SCRATCH_SITE" run-tests --module "$MODULE" --test test_rev_clinician_delete_permission_after_migrate 2>&1 \
    | show ' \.\.\. |^(Ran|OK|FAILED)'
  ARCHIVE="$(mktemp -d)"; chmod 777 "$ARCHIVE"          # drop-site moves the site folder here
  $BENCH drop-site "$SCRATCH_SITE" --db-root-username "${DB_ROOT_USER:-postgres}" \
    --db-root-password "${DB_ROOT_PASSWORD:-postgres}" --no-backup --force --archived-sites-path "$ARCHIVE" >/dev/null 2>&1
  rm -rf "$ARCHIVE"
  echo "dropped $SCRATCH_SITE"
fi
