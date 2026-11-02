#!/usr/bin/env bash
# Run as ubuntu inside a private network namespace with env -i. Synthetic only.
set -euo pipefail
PROJECT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$PROJECT"
EVIDENCE="${F1F2_EVIDENCE_DIR:-$PROJECT/docs/consolidation/evidence/f1f2-mysql-run-1}"
[[ ! -e "$EVIDENCE" ]] || { echo 'Preserve evidence: choose a fresh F1F2_EVIDENCE_DIR'; exit 2; }
mkdir -p "$EVIDENCE"
# Refuse a namespace with external interfaces or a default route.
[[ $(ip -o link show | wc -l) -eq 1 && -z $(ip route) ]] || { echo 'Private loopback-only network namespace required'; exit 3; }
ip -brief address > "$EVIDENCE/network-addresses.txt"
ip route > "$EVIDENCE/network-routes.txt"
ROOT=$(mktemp -d /tmp/atena-f1f2.XXXXXX)
export F1F2_LOCAL_ROOT="$ROOT"
chmod 755 "$ROOT"
DATADIR="$ROOT/mysql-data"; SOCKET="$DATADIR/mysql.sock"
sudo install -d -o mysql -g mysql -m 0750 "$DATADIR"
sudo install -o mysql -g mysql -m 0644 /dev/null "$ROOT/mysql.err"
MYSQL_JOB=""
cleanup() {
  code=$?
  trap - EXIT TERM INT
  set +e
  mysqladmin --no-defaults --socket="$SOCKET" -uroot shutdown >/dev/null 2>&1
  [[ -n "$MYSQL_JOB" ]] && wait "$MYSQL_JOB" 2>/dev/null
  [[ "$ROOT" == /tmp/atena-f1f2.* ]] && sudo rm -rf -- "$ROOT"
  python3 - "$EVIDENCE/cleanup.json" "$ROOT" "$code" <<'PY'
import json,sys,os
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'exitCode':int(sys.argv[3]),'temporaryRootRemoved':not os.path.exists(sys.argv[2]),'mysqlSocketRemoved':not os.path.exists(sys.argv[2]+'/mysql-data/mysql.sock'),'sqlTransport':'Unix socket only, skip-networking/mysqlx OFF','noProductionStageOperation':True},indent=2)+'\n')
PY
  echo "F1F2_CLEANUP_COMPLETE exit=$code"
  exit "$code"
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
echo F1F2_MYSQL_UNIX_SOCKET_READY
export DATABASE_URL="mysql://root@127.0.0.1/geoportal_f1f2?socketPath=$SOCKET&timezone=Z"
export TZ=UTC NODE_ENV=test F1F2_SYNTHETIC=1 F1F2_EVIDENCE_DIR="$EVIDENCE"
export JWT_SECRET='f1f2-local-synthetic-only-32-chars-00001' MANUS_JWT_SECRET='f1f2-managed-synthetic-only-00000000001'
export VITE_APP_ID='f1f2-synthetic-app' OWNER_OPEN_ID='f1f2-admin' OWNER_NAME='F1F2 synthetic'
export OAUTH_SERVER_URL='https://oauth.invalid' VITE_OAUTH_PORTAL_URL='https://oauth.invalid'
export BUILT_IN_FORGE_API_URL='https://forge.invalid' BUILT_IN_FORGE_API_KEY='synthetic-only'
export VITE_FRONTEND_FORGE_API_URL='https://forge.invalid' VITE_FRONTEND_FORGE_API_KEY='synthetic-only'
export ARQUEO_EXECUTION_MODE='isolated-rehearsal'
mysql --no-defaults --socket="$SOCKET" -uroot -e 'CREATE DATABASE geoportal_f1f2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
pnpm exec drizzle-kit migrate > "$EVIDENCE/drizzle-migrate.log" 2>&1
echo F1F2_LOCAL_MIGRATIONS_BOOTSTRAP_COMPLETE
/usr/bin/python3 - "$ROOT/valid-synthetic.tif" <<'PY'
from osgeo import gdal,osr
import sys
p=sys.argv[1]
ds=gdal.GetDriverByName('GTiff').Create(p,8,8,1,gdal.GDT_Byte)
ds.SetGeoTransform([-47,0.0001,0,-15,0,-0.0001])
s=osr.SpatialReference();s.ImportFromEPSG(4674);ds.SetProjection(s.ExportToWkt())
ds.GetRasterBand(1).Fill(42);ds.GetRasterBand(1).SetNoDataValue(0)
ds.FlushCache();ds=None
PY
gdalinfo -json "$ROOT/valid-synthetic.tif" > "$EVIDENCE/synthetic-geotiff-gdalinfo.json"
# These are directed new contracts, not a re-run/relabel of historical 112.
pnpm exec vitest run server/tiffUploadPolicy.test.ts server/fileTypeCategories.test.ts server/filesF1F2.synthetic.test.ts > "$EVIDENCE/vitest.log" 2>&1
echo F1F2_DIRECTED_TESTS_PASS
