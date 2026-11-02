#!/usr/bin/env bash
# Dedicated F4 synthetic-only runtime. Execute serve/check stages in private
# network namespaces, with env -i; do not use on any production/stage machine.
set -euo pipefail
MODE="${1:?serve|prepare|test|stop}"
PROJECT=/home/ubuntu/atena_geoportal_f4_isolado
EVIDENCE="${F4_EVIDENCE_ROOT:-$PROJECT/docs/consolidation/evidence/f4-driver-mysql}"
STATE="$EVIDENCE/local-runtime.json"
mkdir -p "$EVIDENCE"
cd "$PROJECT"

load_state() {
  ROOT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["temporaryRoot"])' "$STATE")
  [[ "$ROOT" == /tmp/atena-f4-driver.* && -d "$ROOT" ]] || { echo 'Invalid F4 temporary root' >&2; exit 3; }
  SOCKET="$ROOT/mysql-data/mysql.sock"
}

if [[ "$MODE" == serve ]]; then
  [[ ! -e "$STATE" ]] || { echo 'Preserve existing evidence; choose a new F4_EVIDENCE_ROOT.' >&2; exit 4; }
  ROOT=$(mktemp -d /tmp/atena-f4-driver.XXXXXX)
  chmod 755 "$ROOT"
  DATADIR="$ROOT/mysql-data"; SOCKET="$DATADIR/mysql.sock"
  sudo install -d -o mysql -g mysql -m 0750 "$DATADIR"
  sudo install -o mysql -g mysql -m 0644 /dev/null "$ROOT/mysql.err"
  sudo mysqld --no-defaults --initialize-insecure --user=mysql --datadir="$DATADIR" > "$EVIDENCE/mysql-initialize.log" 2>&1
  sudo chmod 755 "$DATADIR"
  MYSQL_JOB=""
  cleanup() {
    trap - EXIT TERM INT
    set +e
    mysqladmin --no-defaults --socket="$SOCKET" -uroot shutdown >/dev/null 2>&1
    [[ -n "$MYSQL_JOB" ]] && wait "$MYSQL_JOB" 2>/dev/null
    # Remove only the positively identified local datadir created by this run.
    [[ "$ROOT" == /tmp/atena-f4-driver.* ]] && sudo rm -rf -- "$ROOT"
    python3 - "$EVIDENCE/cleanup.json" "$ROOT" <<'PY'
import json,sys,os
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'temporaryRootRemoved':not os.path.exists(sys.argv[2]),'mysqlSocketRemoved':not os.path.exists(sys.argv[2]+'/mysql-data/mysql.sock'),'noProductionOrStageOperation':True},indent=2)+'\n')
PY
    echo F4_LOCAL_RUNTIME_CLEANED
  }
  trap cleanup EXIT TERM INT
  sudo mysqld --no-defaults --user=mysql --datadir="$DATADIR" --socket="$SOCKET" --pid-file="$DATADIR/mysql.pid" --skip-networking --mysqlx=OFF --skip-log-bin --log-error="$ROOT/mysql.err" &
  MYSQL_JOB=$!
  for _ in $(seq 1 120); do
    mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null 2>&1 && break
    sleep 0.25
  done
  mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null
  python3 - "$STATE" "$ROOT" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'temporaryRoot':sys.argv[2],'sqlTransport':'Unix socket only','tcpEnabled':False,'mysqlXEnabled':False,'privateNetworkNamespace':True,'syntheticSourceSchema':'geoportal_f4_driver','syntheticRestoreSchema':'geoportal_f4_restore'},indent=2)+'\n')
PY
  chmod 600 "$STATE"
  ss -ltn > "$EVIDENCE/tcp-listeners.txt"
  ip -brief address > "$EVIDENCE/network-addresses.txt"
  ip route > "$EVIDENCE/network-routes.txt"
  echo F4_MYSQL_SOCKET_READY
  wait "$MYSQL_JOB"
  exit
fi

load_state
mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null
if [[ "$MODE" == stop ]]; then
  mysqladmin --no-defaults --socket="$SOCKET" -uroot shutdown
  exit
fi
export TZ=UTC NODE_ENV=test
export DATABASE_URL="mysql://root@127.0.0.1/geoportal_f4_driver?socketPath=${SOCKET}&timezone=Z"
export JWT_SECRET='f4-synthetic-jwt-only-32-chars-00000001'
export MANUS_JWT_SECRET='f4-synthetic-managed-only-00000000001'
export VITE_APP_ID='f4-synthetic-app'
export OAUTH_SERVER_URL='https://oauth.invalid' VITE_OAUTH_PORTAL_URL='https://oauth.invalid'
export OWNER_OPEN_ID='f4-synthetic-admin' OWNER_NAME='F4 synthetic'
export BUILT_IN_FORGE_API_URL='https://forge.invalid' BUILT_IN_FORGE_API_KEY='synthetic-only'
export VITE_FRONTEND_FORGE_API_URL='https://forge.invalid' VITE_FRONTEND_FORGE_API_KEY='synthetic-only'
export ARQUEO_EXECUTION_MODE='isolated-rehearsal'
if [[ "$MODE" == prepare ]]; then
  mysql --no-defaults --socket="$SOCKET" -uroot -e "CREATE DATABASE geoportal_f4_driver CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE geoportal_f4_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  pnpm exec drizzle-kit migrate > "$EVIDENCE/drizzle-source.log" 2>&1
  DATABASE_URL="mysql://root@127.0.0.1/geoportal_f4_restore?socketPath=${SOCKET}&timezone=Z" pnpm exec drizzle-kit migrate > "$EVIDENCE/drizzle-restore.log" 2>&1
  echo F4_SYNTHETIC_SCHEMAS_PREPARED
elif [[ "$MODE" == test ]]; then
  PHASE="${2:?pre-fix|post-fix|regression}"
  [[ "$PHASE" =~ ^(pre-fix|post-fix|regression)$ ]] || exit 5
  mkdir -p "$EVIDENCE/$PHASE"
  export F4_EVIDENCE_DIR="$EVIDENCE/$PHASE"
  if [[ "$PHASE" == regression ]]; then
    export F4_DRIVER_SYNTHETIC=0
    pnpm exec vitest run server/backup.test.ts server/backupManifest.test.ts server/backupArchive.test.ts server/localFilesystemBackupStore.test.ts server/backupInventoryPolicy.test.ts server/backupRuntime.test.ts server/backupTableSnapshot.test.ts > "$EVIDENCE/$PHASE/vitest.log" 2>&1
  else
    export F4_DRIVER_SYNTHETIC=1
    pnpm exec vitest run server/backupDriver.synthetic.test.ts > "$EVIDENCE/$PHASE/vitest.log" 2>&1
  fi
  echo "F4_TEST_PHASE_PASS=$PHASE"
else
  echo 'Unknown mode' >&2; exit 2
fi
