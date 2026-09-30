#!/usr/bin/env bash
# End-to-end live test of the spice-site MCP server against a real bench, leaving the site as it was.
# Holds the shared bench lock for the whole sequence:
#   provision API user + synthetic sample data -> bench serve -> live-check.mjs -> stop server -> teardown.
#
# Usage (as root in the course container; the bench user is `frappe`):
#   bash AI-SDLC-frappe/mcp/spice-site-server/scripts/run-live-test.sh [--record]
# Env: BENCH_DIR (default /home/user/frappe-bench), SITE (test.localhost), PORT (8016), BENCH_USER (frappe)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$HERE")"
BENCH_DIR="${BENCH_DIR:-/home/user/frappe-bench}"
SITE="${SITE:-test.localhost}"
PORT="${PORT:-8016}"
BENCH_USER="${BENCH_USER:-frappe}"
LOCK="${LOCK:-/tmp/spice-bench.lock}"
RECORD=""
[[ "${1:-}" == "--record" ]] && RECORD="--record $SERVER_DIR/fixtures/site-responses.json"

as_bench() { su - "$BENCH_USER" -c "source ~/.spice-lite-bench-env && cd $BENCH_DIR && $*"; }
provision() { as_bench "cd sites && ../env/bin/python $HERE/provision_api_user.py --site $SITE $*"; }

run() {
  local serve_pid="" status=0
  cleanup() {
    if [[ -n "$serve_pid" ]]; then
      pkill -TERM -P "$serve_pid" 2>/dev/null || true
      kill "$serve_pid" 2>/dev/null || true
      # bench serve runs werkzeug with a reloader child; make sure nothing keeps the port.
      pkill -f "frappe.utils.bench_helper frappe --site $SITE serve --port $PORT" 2>/dev/null || true
      pkill -f "serve --port $PORT" 2>/dev/null || true
    fi
    echo "--- teardown"
    provision teardown
  }
  trap cleanup EXIT

  echo "--- provision read-only API user and synthetic sample data"
  local creds
  creds="$(provision setup --sample-data)"   # JSON with the one-time secret: kept in this shell only
  export SPICE_SITE_API_KEY SPICE_SITE_API_SECRET
  SPICE_SITE_API_KEY="$(node -e 'console.log(JSON.parse(process.argv[1]).api_key)' "$creds")"
  SPICE_SITE_API_SECRET="$(node -e 'console.log(JSON.parse(process.argv[1]).api_secret)' "$creds")"
  node -e 'const c=JSON.parse(process.argv[1]); console.log(`user=${c.user} role=${c.role} sample=${JSON.stringify(c.sample)}`)' "$creds"

  echo "--- bench serve on port $PORT"
  as_bench "bench --site $SITE serve --port $PORT" > /tmp/spice-site-serve.log 2>&1 &
  serve_pid=$!
  for _ in $(seq 1 60); do
    curl -s -o /dev/null -H "Host: $SITE" "http://127.0.0.1:$PORT/api/method/ping" && break
    sleep 1
  done

  echo "--- guest and wrong-token requests (expect 403 and 401)"
  curl -s -o /dev/null -w "guest get_group_by_count: %{http_code}\n" -H "Host: $SITE" \
    "http://127.0.0.1:$PORT/api/method/frappe.desk.listview.get_group_by_count?doctype=SL%20Patient&current_filters=%5B%5D&field=country"
  curl -s -o /dev/null -w "wrong secret: %{http_code}\n" -H "Host: $SITE" -H "Authorization: token $SPICE_SITE_API_KEY:wrong" \
    "http://127.0.0.1:$PORT/api/method/frappe.utils.change_log.get_versions"
  echo "--- the same key reading a row through /api/resource (what the MCP server never does)"
  curl -s -o /dev/null -w "reader GET /api/resource/SL Patient: %{http_code}\n" -H "Host: $SITE" \
    -H "Authorization: token $SPICE_SITE_API_KEY:$SPICE_SITE_API_SECRET" "http://127.0.0.1:$PORT/api/resource/SL%20Patient?limit_page_length=1"
  curl -s -o /dev/null -w "reader POST /api/resource/SL Country (write): %{http_code}\n" -H "Host: $SITE" -X POST \
    -H "Content-Type: application/json" -H "Authorization: token $SPICE_SITE_API_KEY:$SPICE_SITE_API_SECRET" \
    -d '{"country_code":"XC","country_name":"Should Fail"}' "http://127.0.0.1:$PORT/api/resource/SL%20Country"

  echo "--- live-check.mjs"
  SPICE_SITE_URL="http://127.0.0.1:$PORT" SPICE_SITE_HOST="$SITE" node "$SERVER_DIR/live-check.mjs" $RECORD || status=$?
  return $status
}

export -f run as_bench provision
export HERE SERVER_DIR BENCH_DIR SITE PORT BENCH_USER RECORD
flock "$LOCK" bash -c run
