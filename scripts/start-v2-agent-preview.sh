#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < .nvmrc)"
if [[ "$(node --version)" != "v${EXPECTED_NODE_VERSION}" ]]; then
  echo "V2 agent preview requires Node v${EXPECTED_NODE_VERSION}; select the pinned runtime before starting." >&2
  exit 1
fi
if [[ "$(id -u)" -eq 0 ]]; then
  echo "V2 agent preview requires a non-root user because PostgreSQL refuses root." >&2
  exit 1
fi
if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "V2 agent preview cannot run with NODE_ENV=production." >&2
  exit 1
fi
if [[ "${V2_USE_PROJECT_DATABASE:-}" == "true" || -n "${V2_DATABASE_URL:-}" ]]; then
  echo "V2 agent preview refuses project-database configuration; clear V2_USE_PROJECT_DATABASE and V2_DATABASE_URL." >&2
  exit 1
fi
if [[ -z "${V2_AGENT_TEST_PREVIEW:-}" ]]; then
  export V2_AGENT_TEST_PREVIEW=true
elif [[ "${V2_AGENT_TEST_PREVIEW}" != "true" ]]; then
  echo "V2_AGENT_TEST_PREVIEW must be true for this launcher." >&2
  exit 1
fi

PG_BIN="$(dirname "$(command -v initdb)")"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/v2-agent-preview.XXXXXX")"
PG_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
DB_USER="$(id -un)"
DB_USER_ENCODED="$(python3 - "$DB_USER" <<'PY'
import sys
import urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
export V2_DATABASE_URL="postgresql://${DB_USER_ENCODED}@127.0.0.1:${PG_PORT}/v2_agent_preview"
export NODE_ENV=development
export PORT="${PORT:-5000}"
export V2_WORKER_HEALTH_PORT="${V2_WORKER_HEALTH_PORT:-3001}"
export V2_API_DB_POOL_MAX=3
export V2_WORKER_DB_POOL_MAX=2

# shellcheck disable=SC2317
PG_STARTED=false
SUPERVISOR_PID=""
# shellcheck disable=SC2317
cleanup() {
  if [[ "$PG_STARTED" == "true" ]]; then
    "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m fast -w stop >/dev/null 2>&1 || \
      "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
# shellcheck disable=SC2317
handle_signal() {
  if [[ -n "$SUPERVISOR_PID" ]]; then
    kill -TERM "$SUPERVISOR_PID" 2>/dev/null || true
    wait "$SUPERVISOR_PID" || true
  fi
  exit 0
}
trap cleanup EXIT
trap handle_signal INT TERM

"$PG_BIN/initdb" \
  -D "$TMP_DIR/data" \
  -U "$DB_USER" \
  --no-locale \
  --encoding=UTF8 \
  --auth-local=reject \
  --auth-host=trust >/dev/null
if ! "$PG_BIN/pg_ctl" \
  -D "$TMP_DIR/data" \
  -o "-F -p $PG_PORT -h 127.0.0.1 -k $TMP_DIR" \
  -l "$TMP_DIR/postgres.log" \
  -w start >/dev/null; then
  cat "$TMP_DIR/postgres.log" >&2
  exit 1
fi
PG_STARTED=true
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" v2_agent_preview

# DATABASE_URL may be injected by the workspace, but it is never forwarded to
# the preview initializer, API, worker, or supervisor.
env -u DATABASE_URL \
  NODE_ENV="$NODE_ENV" \
  V2_AGENT_TEST_PREVIEW="$V2_AGENT_TEST_PREVIEW" \
  V2_DATABASE_URL="$V2_DATABASE_URL" \
  node v2/db/prepare-agent-preview.mjs

echo "V2 Agent Test Preview is using a disposable local database; stopping this workflow removes it."
env -u DATABASE_URL \
  NODE_ENV="$NODE_ENV" \
  V2_AGENT_TEST_PREVIEW="$V2_AGENT_TEST_PREVIEW" \
  V2_DATABASE_URL="$V2_DATABASE_URL" \
  PORT="$PORT" \
  V2_WORKER_HEALTH_PORT="$V2_WORKER_HEALTH_PORT" \
  V2_API_DB_POOL_MAX="$V2_API_DB_POOL_MAX" \
  V2_WORKER_DB_POOL_MAX="$V2_WORKER_DB_POOL_MAX" \
  process-compose --config process-compose.yaml --disable-dotenv --no-server \
    --ordered-shutdown up --tui=false &
SUPERVISOR_PID=$!
set +e
wait "$SUPERVISOR_PID"
STATUS=$?
set -e
SUPERVISOR_PID=""
exit "$STATUS"
