#!/usr/bin/env bash
# SYNTHETIC ONLY: invoke as ubuntu inside a private network namespace with env -i.
set -euo pipefail
PROJECT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$PROJECT"
[[ "${HIERARCHY_ATENA_EXECUTOR:-}" == '1' ]] || { echo 'Explicit synthetic executor marker required'; exit 2; }
[[ $(ip -o link show | wc -l) -eq 1 && -z $(ip route) ]] || { echo 'Private loopback-only network namespace required'; exit 3; }
EVIDENCE="${HIERARCHY_ATENA_EVIDENCE_DIR:?Fresh evidence directory required}"
[[ ! -e "$EVIDENCE" ]] || { echo 'Preserve previous evidence; choose a new path'; exit 4; }
mkdir -p "$EVIDENCE"
ip -brief address > "$EVIDENCE/network-addresses.txt"
ip route > "$EVIDENCE/network-routes.txt"
ROOT=$(mktemp -d /tmp/atena-panels-atena.XXXXXX)
chmod 755 "$ROOT"
export HIERARCHY_ATENA_LOCAL_ROOT="$ROOT"
DATADIR="$ROOT/mysql-data"; SOCKET="$DATADIR/mysql.sock"
sudo install -d -o mysql -g mysql -m 0750 "$DATADIR"
sudo install -o mysql -g mysql -m 0644 /dev/null "$ROOT/mysql.err"
MYSQL_JOB=''
cleanup() {
  code=$?; trap - EXIT TERM INT; set +e
  mysqladmin --no-defaults --socket="$SOCKET" -uroot shutdown >/dev/null 2>&1
  [[ -n "$MYSQL_JOB" ]] && wait "$MYSQL_JOB" 2>/dev/null
  [[ "$ROOT" == /tmp/atena-panels-atena.* ]] && sudo rm -rf -- "$ROOT"
  python3 - "$EVIDENCE/cleanup.json" "$ROOT" "$code" <<'PY'
import json,sys,os
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'exitCode':int(sys.argv[3]),'temporaryRootRemoved':not os.path.exists(sys.argv[2]),'mysqlSocketRemoved':not os.path.exists(sys.argv[2]+'/mysql-data/mysql.sock'),'sqlTransport':'private Unix socket; skip-networking; mysqlx OFF','productionStageOperation':False},indent=2)+'\n')
PY
  echo "PANELS_ATENA_CLEANUP_COMPLETE exit=$code"; exit "$code"
}
trap cleanup EXIT TERM INT
sudo mysqld --no-defaults --initialize-insecure --user=mysql --datadir="$DATADIR" > "$EVIDENCE/mysql-initialize.log" 2>&1
sudo chmod 755 "$DATADIR"
sudo mysqld --no-defaults --user=mysql --datadir="$DATADIR" --socket="$SOCKET" --pid-file="$DATADIR/mysql.pid" --skip-networking --mysqlx=OFF --skip-log-bin --log-error="$ROOT/mysql.err" &
MYSQL_JOB=$!
for _ in $(seq 1 120); do
  mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null 2>&1 && break
  sleep 0.25
done
mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null
ss -ltn > "$EVIDENCE/tcp-listeners.txt"
echo PANELS_ATENA_MYSQL_PRIVATE_SOCKET_READY
export DATABASE_URL="mysql://root@127.0.0.1/geoportal_panels_atena?socketPath=$SOCKET&timezone=Z"
export NODE_ENV=test TZ=UTC HIERARCHY_ATENA_SYNTHETIC=1 ARQUEO_EXECUTION_MODE='isolated-rehearsal'
export JWT_SECRET='panels-atena-local-only-synthetic-0000000001' MANUS_JWT_SECRET='panels-atena-local-only-managed-synthetic-01'
export VITE_APP_ID='panels-atena-synthetic-app' OWNER_OPEN_ID='panels-atena-admin' OWNER_NAME='Synthetic panels Atena'
export OAUTH_SERVER_URL='https://oauth.invalid' VITE_OAUTH_PORTAL_URL='https://oauth.invalid'
# No Forge/API/storage/LLM/scanner keys: external integrations must remain unavailable.
mysql --no-defaults --socket="$SOCKET" -uroot -e 'CREATE DATABASE geoportal_panels_atena CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
pnpm exec drizzle-kit migrate > "$EVIDENCE/drizzle-migrate.log" 2>&1
echo PANELS_ATENA_LOCAL_MIGRATIONS_COMPLETE
mysql --no-defaults --socket="$SOCKET" -uroot geoportal_panels_atena < infra/synthetic/seed_minimal.sql
mysql --no-defaults --socket="$SOCKET" -uroot geoportal_panels_atena -Nse 'SELECT VERSION(); SELECT COUNT(*) FROM __drizzle_migrations;' > "$EVIDENCE/engine-journal.txt"
# Directed new contracts and existing pure regression suites, without raster/backup re-runs.
mapfile -t NEW_TESTS < <(find server -maxdepth 1 -type f \( -name '*Hierarchy*.test.ts' -o -name '*hierarchy*.test.ts' -o -name 'atena*.test.ts' -o -name 'panelsAtena.synthetic.test.ts' -o -name 'layerTree*.test.ts' \) | sort)
[[ ${#NEW_TESTS[@]} -ge 2 ]] || { echo 'Missing directed tests'; exit 5; }
printf '%s\n' "${NEW_TESTS[@]}" > "$EVIDENCE/directed-test-files.txt"
pnpm exec vitest run --cache=false --minWorkers=1 --maxWorkers=1 "${NEW_TESTS[@]}" > "$EVIDENCE/vitest-directed.log" 2>&1
echo PANELS_ATENA_DIRECTED_TESTS_PASS
