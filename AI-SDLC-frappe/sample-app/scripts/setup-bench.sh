#!/usr/bin/env bash
# setup-bench.sh -- idempotent reproduction of the bench used to build and test spice_lite.
#
# Tested (2026-09-30) on Ubuntu 24.04, run as root: a fresh run with DB_TYPE=postgres (PostgreSQL 16,
# preinstalled) and a second run with DB_TYPE=mariadb SITE=mariadb.localhost (MariaDB 10.11 installed by
# this script) on the same bench. Python 3.11, Node 22, yarn 1.22, redis-server 7, frappe-bench 5.31,
# frappe version-15 (15.121.2). The non-root path (normal user, DB/redis already running) was not exercised.
#
# Re-running is safe: every step checks whether it is already done.
#
# Usage:
#   sudo ./scripts/setup-bench.sh                       # postgres, /home/user/frappe-bench, test.localhost
#   DB_TYPE=mariadb sudo -E ./scripts/setup-bench.sh
#   BENCH_DIR=$HOME/frappe-bench ./scripts/setup-bench.sh   # as a normal user (DB/redis must already run)
#
# Why a separate user: bench refuses to run as root ("You should not run this command as root").
# When started as root this script creates BENCH_USER and runs every bench command as that user.
set -euo pipefail

BENCH_DIR="${BENCH_DIR:-/home/user/frappe-bench}"
BENCH_USER="${BENCH_USER:-frappe}"
SITE="${SITE:-test.localhost}"
DB_TYPE="${DB_TYPE:-postgres}"               # postgres | mariadb
DB_HOST="${DB_HOST:-127.0.0.1}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
FRAPPE_BRANCH="${FRAPPE_BRANCH:-version-15}"
FRAPPE_REPO="${FRAPPE_REPO:-https://github.com/frappe/frappe}"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"
REDIS_CACHE_PORT=13000                      # bench's default common_site_config ports
REDIS_QUEUE_PORT=11000
# auto | yes | no : work around egress proxies that block codeload.github.com tarballs (see README)
CODELOAD_WORKAROUND="${CODELOAD_WORKAROUND:-auto}"

if [[ "$DB_TYPE" == "postgres" ]]; then
	DB_ROOT_USER="${DB_ROOT_USER:-postgres}"
	DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-postgres}"
else
	DB_ROOT_USER="${DB_ROOT_USER:-root}"
	DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-root}"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$(cd "$SCRIPT_DIR/../spice_lite" && pwd)"

log() { printf '\n==> %s\n' "$*"; }

IS_ROOT=0
[[ "$(id -u)" == "0" ]] && IS_ROOT=1

# ---------------------------------------------------------------------------
# 0. bench user + environment passed to it
# ---------------------------------------------------------------------------
if [[ $IS_ROOT == 1 ]]; then
	if ! id "$BENCH_USER" >/dev/null 2>&1; then
		log "Creating user $BENCH_USER"
		useradd -m -s /bin/bash "$BENCH_USER"
	fi
	USER_HOME="$(getent passwd "$BENCH_USER" | cut -d: -f6)"
	# If the CA bundle lives somewhere the bench user cannot read (e.g. /root), copy it.
	CA_FILE="${SSL_CERT_FILE:-}"
	if [[ -n "$CA_FILE" && -f "$CA_FILE" ]] && ! runuser -u "$BENCH_USER" -- test -r "$CA_FILE"; then
		install -m 644 "$CA_FILE" /usr/local/share/spice-lite-ca-bundle.crt
		CA_FILE=/usr/local/share/spice-lite-ca-bundle.crt
	fi
	ENV_FILE="$USER_HOME/.spice-lite-bench-env"
	{
		echo "export PATH=\"$USER_HOME/.local/bin:$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin\""
		for v in HTTPS_PROXY https_proxy NO_PROXY no_proxy npm_config_https_proxy YARN_HTTPS_PROXY; do
			[[ -n "${!v:-}" ]] && printf 'export %s=%q\n' "$v" "${!v}"
		done
		if [[ -n "$CA_FILE" ]]; then
			for v in SSL_CERT_FILE REQUESTS_CA_BUNDLE PIP_CERT CURL_CA_BUNDLE GIT_SSL_CAINFO NODE_EXTRA_CA_CERTS HTTPLIB2_CA_CERTS; do
				echo "export $v=$CA_FILE"
			done
		fi
	} >"$ENV_FILE"
	chown "$BENCH_USER:" "$ENV_FILE"
	# clean environment (env -i): root's env may point at files the bench user cannot read
	as_user() {
		runuser -u "$BENCH_USER" -- env -i HOME="$USER_HOME" USER="$BENCH_USER" LOGNAME="$BENCH_USER" \
			LANG="${LANG:-C.UTF-8}" TERM="${TERM:-dumb}" bash -c "source '$ENV_FILE'; $*"
	}
else
	BENCH_USER="$(id -un)"
	USER_HOME="$HOME"
	as_user() { bash -c "export PATH=\"\$HOME/.local/bin:\$PATH\"; $*"; }
fi

# The app lives inside a git repo owned by someone else; let git (used by bench) read it.
REPO_TOP="$(git -C "$APP_SRC" rev-parse --show-toplevel 2>/dev/null || echo "$APP_SRC")"
as_user "git config --global --get-all safe.directory | grep -qxF '$REPO_TOP' || git config --global --add safe.directory '$REPO_TOP'"

# ---------------------------------------------------------------------------
# 1. database server
# ---------------------------------------------------------------------------
if [[ "$DB_TYPE" == "postgres" ]]; then
	if [[ $IS_ROOT == 1 ]]; then
		if ! command -v pg_ctlcluster >/dev/null; then
			log "Installing PostgreSQL"
			apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-client
		fi
		PG_VER="$(ls /usr/lib/postgresql | sort -V | tail -1)"
		if ! pg_lsclusters -h | awk '{print $4}' | grep -q online; then
			log "Starting PostgreSQL $PG_VER"
			pg_ctlcluster "$PG_VER" main start
		fi
		runuser -u postgres -- psql -qc "ALTER USER postgres PASSWORD '$DB_ROOT_PASSWORD';"
	fi
	PGPASSWORD="$DB_ROOT_PASSWORD" psql -h "$DB_HOST" -U "$DB_ROOT_USER" -d postgres -qtAc "select 1" >/dev/null
elif [[ "$DB_TYPE" == "mariadb" ]]; then
	# UNTESTED branch -- mirrors https://frappeframework.com/docs/user/en/installation
	if [[ $IS_ROOT == 1 ]]; then
		if ! command -v mariadbd >/dev/null && ! command -v mysqld >/dev/null; then
			log "Installing MariaDB"
			apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server mariadb-client
		fi
		cat >/etc/mysql/mariadb.conf.d/99-frappe.cnf <<-'CNF'
			[mysqld]
			character-set-client-handshake = FALSE
			character-set-server = utf8mb4
			collation-server = utf8mb4_unicode_ci

			[mysql]
			default-character-set = utf8mb4
		CNF
		(service mariadb restart || service mysql restart)
		mariadb -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$DB_ROOT_PASSWORD'; FLUSH PRIVILEGES;" 2>/dev/null ||
			mariadb -uroot -p"$DB_ROOT_PASSWORD" -e "select 1" >/dev/null
	fi
else
	echo "DB_TYPE must be postgres or mariadb" >&2
	exit 2
fi

# ---------------------------------------------------------------------------
# 2. redis (cache + queue). We pass --skip-redis-config-generation to bench init,
#    so start plain redis-server processes on bench's default ports instead.
#    (redis_socketio shares the cache instance in v15's default config.)
# ---------------------------------------------------------------------------
for port in $REDIS_CACHE_PORT $REDIS_QUEUE_PORT; do
	if ! redis-cli -p "$port" ping >/dev/null 2>&1; then
		log "Starting redis on :$port"
		as_user "redis-server --port $port --daemonize yes --save '' --appendonly no --dir /tmp --logfile /tmp/redis-$port.log"
	fi
done

# ---------------------------------------------------------------------------
# 3. bench CLI
# ---------------------------------------------------------------------------
if ! as_user "command -v bench" >/dev/null; then
	log "Installing frappe-bench"
	if as_user "command -v uv" >/dev/null; then
		as_user "uv tool install frappe-bench"
	else
		as_user "$PYTHON_BIN -m pip install --user frappe-bench"
	fi
fi

# ---------------------------------------------------------------------------
# 4. bench init (frappe version-15)
# ---------------------------------------------------------------------------
if [[ ! -d "$BENCH_DIR/apps/frappe" ]]; then
	SHIM_PATH=""
	if [[ "$CODELOAD_WORKAROUND" == "auto" ]]; then
		code="$(curl -s -o /dev/null -w '%{http_code}' -I https://codeload.github.com/frappe/air-datepicker/tar.gz/HEAD || true)"
		[[ "$code" == "403" || "$code" == "000" ]] && CODELOAD_WORKAROUND=yes || CODELOAD_WORKAROUND=no
	fi
	if [[ "$CODELOAD_WORKAROUND" == "yes" ]]; then
		# frappe's package.json pulls "air-datepicker" as a GitHub tarball (codeload.github.com).
		# Behind proxies that allow `git clone` but block codeload, `yarn install` fails and so
		# does bench init. A `yarn` shim, used only during init, repoints that ONE dependency to
		# git+https (fetched with git, same commit) before calling the real yarn.
		# Side effect: apps/frappe/package.json and yarn.lock show a local diff. See README.
		SHIM_DIR="$USER_HOME/.cache/spice-lite/shims"
		log "codeload.github.com blocked -> using yarn shim in $SHIM_DIR"
		as_user "mkdir -p '$SHIM_DIR'"
		REAL_YARN="$(as_user 'command -v yarn')"
		cat >"$SHIM_DIR/yarn" <<SHIM
#!/usr/bin/env python3
import os, re, sys, pathlib
pkg, lock = pathlib.Path("package.json"), pathlib.Path("yarn.lock")
if pkg.exists() and lock.exists() and '"github:frappe/air-datepicker"' in pkg.read_text():
    l = lock.read_text()
    sha = re.search(r"codeload\.github\.com/frappe/air-datepicker/tar\.gz/([0-9a-f]+)", l).group(1)
    pkg.write_text(pkg.read_text().replace('"github:frappe/air-datepicker"',
        '"git+https://github.com/frappe/air-datepicker.git#%s"' % sha))
    lock.write_text(re.sub(r'(?m)^"air-datepicker@github:frappe/air-datepicker":\n(?:  .*\n)+\n?', "", l))
    print("[spice-lite yarn shim] air-datepicker -> git+https#" + sha, file=sys.stderr)
os.execv("$REAL_YARN", ["yarn", *sys.argv[1:]])
SHIM
		chmod 755 "$SHIM_DIR/yarn"
		[[ $IS_ROOT == 1 ]] && chown -R "$BENCH_USER:" "$USER_HOME/.cache/spice-lite"
		SHIM_PATH="export PATH='$SHIM_DIR':\$PATH;"
	fi

	PARENT="$(dirname "$BENCH_DIR")"
	RESTORE_MODE=""
	if [[ $IS_ROOT == 1 ]]; then
		mkdir -p "$PARENT"
		if ! runuser -u "$BENCH_USER" -- test -w "$PARENT"; then
			RESTORE_MODE="$(stat -c '%a' "$PARENT")"
			chmod o+wx "$PARENT" # temporarily, so the bench user can create BENCH_DIR
		fi
	fi
	log "bench init $BENCH_DIR (frappe $FRAPPE_BRANCH)"
	set +e
	as_user "$SHIM_PATH cd '$PARENT' && bench init '$(basename "$BENCH_DIR")' --frappe-path '$FRAPPE_REPO' \
		--frappe-branch $FRAPPE_BRANCH --python $PYTHON_BIN --skip-redis-config-generation --no-backups"
	rc=$?
	set -e
	[[ -n "$RESTORE_MODE" ]] && chmod "$RESTORE_MODE" "$PARENT"
	[[ $rc == 0 ]] || { echo "bench init failed ($rc)" >&2; exit $rc; }
fi

# ---------------------------------------------------------------------------
# 5. get the app from the local repo path (symlink, so edits in the repo are live)
#    `bench get-app --soft-link <path>` expects <path> to be its own git repo; here the app is a
#    sub-folder of the course repo, so we do the same three steps get-app would do:
#    symlink into apps/, editable-install into the bench venv, register in sites/apps.txt.
# ---------------------------------------------------------------------------
if [[ ! -e "$BENCH_DIR/apps/spice_lite" ]]; then
	log "Linking spice_lite from $APP_SRC"
	as_user "ln -s '$APP_SRC' '$BENCH_DIR/apps/spice_lite'"
fi
if ! as_user "'$BENCH_DIR/env/bin/python' -c 'import spice_lite'" 2>/dev/null; then
	log "pip install -e apps/spice_lite"
	as_user "cd '$BENCH_DIR' && ./env/bin/pip install --quiet -e apps/spice_lite"
fi
as_user "python3 - '$BENCH_DIR/sites/apps.txt' <<'PY'
import sys
p = sys.argv[1]
apps = [a.strip() for a in open(p).read().splitlines() if a.strip()]
if 'spice_lite' not in apps:
    apps.append('spice_lite')
    open(p, 'w').write('\\n'.join(apps) + '\\n')
PY"

# ---------------------------------------------------------------------------
# 6. site
# ---------------------------------------------------------------------------
if [[ ! -d "$BENCH_DIR/sites/$SITE" ]]; then
	log "Creating site $SITE on $DB_TYPE"
	as_user "cd '$BENCH_DIR' && bench new-site '$SITE' --db-type $DB_TYPE --db-host $DB_HOST \
		--db-root-username '$DB_ROOT_USER' --db-root-password '$DB_ROOT_PASSWORD' \
		--admin-password '$ADMIN_PASSWORD'"
fi
as_user "cd '$BENCH_DIR' && bench use '$SITE' && bench --site '$SITE' set-config allow_tests true"
if ! as_user "cd '$BENCH_DIR' && bench --site '$SITE' list-apps" | grep -q '^spice_lite'; then
	log "Installing spice_lite on $SITE"
	as_user "cd '$BENCH_DIR' && bench --site '$SITE' install-app spice_lite"
fi
as_user "cd '$BENCH_DIR' && bench --site '$SITE' migrate" >/dev/null

if [[ $IS_ROOT == 1 ]]; then
	RUN_PREFIX="su - $BENCH_USER -c \"source ~/.spice-lite-bench-env && cd $BENCH_DIR && "
	RUN_SUFFIX='"'
else
	RUN_PREFIX="cd $BENCH_DIR && "
	RUN_SUFFIX=""
fi
cat <<EOF

Done. Bench: $BENCH_DIR   Site: $SITE   DB: $DB_TYPE   Bench user: $BENCH_USER
(If an earlier run died half-way through new-site: remove sites/$SITE and its database, re-run.)

Run the integration tests:
  ${RUN_PREFIX}bench --site $SITE run-tests --app spice_lite${RUN_SUFFIX}

Run the site-less unit tests (no bench needed):
  cd $APP_SRC && python -m pytest spice_lite/tests/unit
EOF
