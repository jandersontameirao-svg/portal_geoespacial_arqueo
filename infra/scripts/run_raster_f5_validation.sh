#!/usr/bin/env bash
# Finite disposable F5 integration; never reuse production/stage configuration.
set -euo pipefail
PROJECT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$PROJECT"
EVIDENCE="${F5_EVIDENCE_DIR:-$PROJECT/docs/consolidation/evidence/f5-mysql-gdal-run-1}"
[[ ! -e "$EVIDENCE" ]] || { echo 'Preserve prior evidence: choose a fresh F5_EVIDENCE_DIR'; exit 2; }
mkdir -p "$EVIDENCE"
[[ $(ip -o link show | wc -l) -eq 1 && -z $(ip route) && -z $(ip -6 route show default) ]] || { echo 'Private loopback-only namespace required'; exit 3; }
ip -brief address > "$EVIDENCE/network-addresses.txt"
ip route > "$EVIDENCE/network-routes-ipv4.txt"
ip -6 route > "$EVIDENCE/network-routes-ipv6.txt"
ROOT=$(mktemp -d /tmp/atena-f5.XXXXXX)
export F5_LOCAL_ROOT="$ROOT"
chmod 755 "$ROOT"
DATADIR="$ROOT/mysql-data"; SOCKET="$DATADIR/mysql.sock"; MYSQL_JOB=""
sudo install -d -o mysql -g mysql -m 0750 "$DATADIR"
sudo install -o mysql -g mysql -m 0644 /dev/null "$ROOT/mysql.err"
cleanup() {
  code=$?
  trap - EXIT TERM INT
  set +e
  mysqladmin --no-defaults --socket="$SOCKET" -uroot shutdown >/dev/null 2>&1
  [[ -n "$MYSQL_JOB" ]] && wait "$MYSQL_JOB" 2>/dev/null
  [[ "$ROOT" == /tmp/atena-f5.* ]] && sudo rm -rf -- "$ROOT"
  python3 - "$EVIDENCE/cleanup.json" "$ROOT" "$code" <<'PY'
import json,sys,os
from pathlib import Path
root=sys.argv[2]
Path(sys.argv[1]).write_text(json.dumps({'exitCode':int(sys.argv[3]),'temporaryRootRemoved':not os.path.exists(root),'socketRemoved':not os.path.exists(root+'/mysql-data/mysql.sock'),'temporaryOnly':True,'productionStageTouched':False,'sqlTransport':'Unix socket; skip-networking; mysqlx OFF','network':'private namespace, loopback only, no external route'},indent=2)+'\n')
PY
  echo "F5_CLEANUP_COMPLETE exit=$code"
  exit "$code"
}
trap cleanup EXIT TERM INT
sudo mysqld --no-defaults --initialize-insecure --user=mysql --datadir="$DATADIR" > "$EVIDENCE/mysql-initialize.log" 2>&1
sudo chmod 755 "$DATADIR"
sudo mysqld --no-defaults --user=mysql --datadir="$DATADIR" --socket="$SOCKET" --pid-file="$DATADIR/mysql.pid" --skip-networking --mysqlx=OFF --skip-log-bin --log-error="$ROOT/mysql.err" &
MYSQL_JOB=$!
for _ in $(seq 1 120); do mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null 2>&1 && break; sleep 0.25; done
mysqladmin --no-defaults --socket="$SOCKET" -uroot ping >/dev/null
ss -ltn > "$EVIDENCE/tcp-listeners.txt"
echo F5_MYSQL_UNIX_SOCKET_READY
export DATABASE_URL="mysql://root@127.0.0.1/geoportal_f5?socketPath=$SOCKET&timezone=Z"
export TZ=UTC NODE_ENV=test F5_SYNTHETIC=1 F5_EVIDENCE_DIR="$EVIDENCE"
export JWT_SECRET='f5-local-synthetic-only-32-chars-00000001' MANUS_JWT_SECRET='f5-managed-synthetic-only-000000000001'
export VITE_APP_ID='f5-synthetic-app' OWNER_OPEN_ID='f5-admin' OWNER_NAME='F5 synthetic'
export OAUTH_SERVER_URL='https://oauth.invalid' VITE_OAUTH_PORTAL_URL='https://oauth.invalid'
export BUILT_IN_FORGE_API_URL='https://forge.invalid'
export VITE_FRONTEND_FORGE_API_URL='https://forge.invalid'
export ARQUEO_EXECUTION_MODE='isolated-rehearsal'
export ARQUEO_RASTER_INGESTION_MODE='direct-local' ARQUEO_LOCAL_RASTER_ROOT="$ROOT/raster-volume"
mkdir -p "$ARQUEO_LOCAL_RASTER_ROOT"
mysql --no-defaults --socket="$SOCKET" -uroot -e 'CREATE DATABASE geoportal_f5 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
pnpm exec drizzle-kit migrate > "$EVIDENCE/drizzle-migrate.log" 2>&1
echo F5_LOCAL_SCHEMA_BOOTSTRAP_COMPLETE
export PYTHONNOUSERSITE=1 PYTHONPATH=/usr/lib/python3/dist-packages PROJ_NETWORK=OFF
/usr/bin/python3 infra/raster/generate_synthetic_rasters.py --output-dir "$ROOT/fixture" > "$EVIDENCE/fixture-generation.log" 2>&1
gdalinfo -json "$ROOT/fixture/before_raw_epsg4326.tif" > "$EVIDENCE/fixture-gdalinfo.json"
echo F5_VALID_SYNTHETIC_GEOTIFF_READY
pnpm exec vitest run server/rasterInitialVersion.synthetic.test.ts server/fileVersioning.test.ts > "$EVIDENCE/vitest.log" 2>&1
echo F5_DIRECTED_INTEGRATION_PASS
