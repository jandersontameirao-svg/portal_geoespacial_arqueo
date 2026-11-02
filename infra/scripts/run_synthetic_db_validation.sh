#!/usr/bin/env bash
# Validação local totalmente descartável do Geoportal consolidado.
# Não lê nem escreve produção, homologação, storage remoto ou dados reais.
set -euo pipefail

ROOT="$(mktemp -d /tmp/atena-opcao-a-synthetic-db.XXXXXX)"
# O processo mysqld isolado roda como usuário mysql e precisa atravessar este
# diretório temporário; os dados seguem restritos ao subdiretório mysql-data.
chmod 755 "$ROOT"
DATADIR="$ROOT/mysql-data"
SOCKET="$DATADIR/mysql.sock"
PIDFILE="$DATADIR/mysql.pid"
# O datadir passa a pertencer ao usuário mysql; mantenha o log na raiz privada
# do ensaio para que o executor consiga registrá-lo no relatório se houver falha.
ERRLOG="$ROOT/mysql.err"
REPORT_DIR="${REPORT_DIR:-$PWD/docs/consolidation/evidence/synthetic-db}"
DB_NAME="geoportal_synthetic"
PORT="${SYNTHETIC_MYSQL_PORT:-33127}"
MYSQL_PID=""
TEST_STATUS="not-run"
MIGRATION_STATUS="not-run"

cleanup() {
  set +e
  if [[ -S "$SOCKET" ]]; then
    mysqladmin --no-defaults --socket="$SOCKET" -uroot shutdown >/dev/null 2>&1 || true
  fi
  if [[ -n "$MYSQL_PID" ]]; then
    wait "$MYSQL_PID" 2>/dev/null || true
  fi
  sudo rm -rf "$ROOT"
}
trap cleanup EXIT

if [[ ! -f package.json || ! -f drizzle.config.ts ]]; then
  echo "Execute este script na raiz da cópia isolada do Geoportal." >&2
  exit 2
fi
if [[ -e "$REPORT_DIR" ]]; then
  rm -rf "$REPORT_DIR"
fi
install -d -m 0750 "$REPORT_DIR"

if ss -ltn | awk '{print $4}' | grep -q ":${PORT}$"; then
  echo "A porta local sintética ${PORT} já está ocupada; escolha SYNTHETIC_MYSQL_PORT." >&2
  exit 3
fi

sudo install -d -o mysql -g mysql -m 0750 "$DATADIR"
# O daemon executa como mysql; precrie o log para que ele possa gravar sem
# conceder escrita fora da raiz temporária do ensaio.
sudo install -o mysql -g mysql -m 0644 /dev/null "$ERRLOG"
sudo mysqld --no-defaults --initialize-insecure --user=mysql --datadir="$DATADIR"
sudo chmod 755 "$DATADIR"
sudo mysqld --no-defaults --user=mysql --datadir="$DATADIR" --socket="$SOCKET" --pid-file="$PIDFILE" \
  --bind-address=127.0.0.1 --port="$PORT" --skip-log-bin --log-error="$ERRLOG" &
MYSQL_PID=$!

for _ in $(seq 1 120); do
  if mysqladmin --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot ping >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
mysqladmin --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot ping >/dev/null

mysql --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot \
  -e "CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

export DATABASE_URL="mysql://root@127.0.0.1:${PORT}/${DB_NAME}"
export JWT_SECRET="synthetic-only-jwt-secret-32-chars-minimum-0001"
export MANUS_JWT_SECRET="synthetic-only-managed-session-secret-0001"
export VITE_APP_ID="synthetic-app-id"
export OAUTH_SERVER_URL="https://oauth.invalid"
export VITE_OAUTH_PORTAL_URL="https://oauth.invalid"
export OWNER_OPEN_ID="synthetic-admin"
export OWNER_NAME="Synthetic Administrator"
export BUILT_IN_FORGE_API_KEY="synthetic-for-tests-only"
export BUILT_IN_FORGE_API_URL="https://forge.invalid"
export VITE_FRONTEND_FORGE_API_KEY="synthetic-for-tests-only"
export VITE_FRONTEND_FORGE_API_URL="https://forge.invalid"
# Necessário somente ao teste de cadastro: não há health-check ou chamada de rede.
export OGC_ALLOWED_HOSTS="ogc.invalid"

{
  echo "target=MySQL local descartável (127.0.0.1:${PORT})"
  echo "database=${DB_NAME}"
  echo "source_commit=$(git rev-parse HEAD)"
  echo "source_branch=$(git branch --show-current)"
  echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$REPORT_DIR/run-metadata.txt"

if pnpm drizzle-kit migrate > "$REPORT_DIR/drizzle-migrate.log" 2>&1; then
  MIGRATION_STATUS="passed"
else
  MIGRATION_STATUS="failed"
  cp "$ERRLOG" "$REPORT_DIR/mysql.err" || true
  printf '{"migrationStatus":"failed","testStatus":"not-run"}\n' > "$REPORT_DIR/report.json"
  exit 10
fi

mysql --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot --database="$DB_NAME" < infra/synthetic/seed_minimal.sql
mysql --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot --database="$DB_NAME" -Nse \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='${DB_NAME}' ORDER BY table_name" \
  > "$REPORT_DIR/schema-tables.tsv"
mysql --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot --database="$DB_NAME" -Nse \
  "SELECT CONCAT('users=', COUNT(*)) FROM users; SELECT CONCAT('projects=', COUNT(*)) FROM projects; SELECT CONCAT('geometries=', COUNT(*)) FROM geometries; SELECT CONCAT('files=', COUNT(*)) FROM files;" \
  > "$REPORT_DIR/pre-test-synthetic-counts.tsv"

if pnpm vitest run > "$REPORT_DIR/vitest.log" 2>&1; then
  TEST_STATUS="passed"
else
  TEST_STATUS="failed"
fi

mysql --no-defaults --protocol=TCP -h127.0.0.1 -P"$PORT" -uroot --database="$DB_NAME" -Nse \
  "SELECT CONCAT('users=', COUNT(*)) FROM users; SELECT CONCAT('projects=', COUNT(*)) FROM projects; SELECT CONCAT('project_members=', COUNT(*)) FROM project_members; SELECT CONCAT('geometries=', COUNT(*)) FROM geometries; SELECT CONCAT('notifications=', COUNT(*)) FROM notifications;" \
  > "$REPORT_DIR/post-test-synthetic-counts.tsv"

find drizzle -maxdepth 1 -type f -name '*.sql' -print0 | sort -z | xargs -0 sha256sum > "$REPORT_DIR/migration-sha256.txt"
python3 - <<PY
import json
from pathlib import Path
report = {
  "scope": "local-disposable-synthetic-only",
  "sourceCommit": "$(git rev-parse HEAD)",
  "migrationStatus": "${MIGRATION_STATUS}",
  "testStatus": "${TEST_STATUS}",
  "database": "${DB_NAME}",
  "mysql": "MySQL local socket/TCP loopback temporary",
  "fixtures": "infra/synthetic/seed_minimal.sql",
  "productionTouched": False,
  "homologationTouched": False,
  "storageRemoteTouched": False,
  "rawDataIncluded": False,
}
Path("$REPORT_DIR/report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
PY

if [[ "$TEST_STATUS" != "passed" ]]; then
  exit 20
fi

echo "SYNTHETIC_DB_VALIDATION=PASS"
echo "REPORT_DIR=$REPORT_DIR"
