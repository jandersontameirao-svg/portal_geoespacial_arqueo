#!/usr/bin/env bash
# TiDB v8.5.3 efêmero, loopback e fixtures sintéticas. Sem produção/stage.
# Downloads oficiais exigem internet; nenhuma conta/credencial/serviço pago.
set -euo pipefail

[[ -f package.json && -f drizzle.config.ts ]] || { echo 'Execute na raiz da cópia isolada.' >&2; exit 2; }
ROOT="$(mktemp -d /tmp/atena-tidb-853.XXXXXX)"
HOME_DIR="$ROOT/home"
export TIUP_HOME="$ROOT/tiup"
REPORT_DIR="${REPORT_DIR:-$PWD/docs/consolidation/evidence/tidb-8.5.3-local-run}"
[[ ! -e "$REPORT_DIR" ]] || { echo 'Recusei sobrescrever evidência existente. Escolha REPORT_DIR novo.' >&2; rmdir "$ROOT"; exit 3; }
install -d -m 0750 "$REPORT_DIR"
REPORT_DIR="$(realpath "$REPORT_DIR")"
PID=''

cleanup() {
  set +e
  if [[ -n "$PID" ]]; then
    kill -INT -- "-$PID" 2>/dev/null
    for _ in $(seq 1 40); do kill -0 "$PID" 2>/dev/null || break; sleep .25; done
    kill -TERM -- "-$PID" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep .25; done
    kill -KILL -- "-$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
  fi
  rm -rf "$ROOT"
  printf 'temporary_root_removed=true\n' > "$REPORT_DIR/cleanup.txt"
}
trap cleanup EXIT

for port in 34000 32379 30160 10080 20180 2380; do
  if ss -ltn | awk '{print $4}' | grep -q ":${port}$"; then
    echo "Porta local ${port} ocupada; nenhuma instância foi iniciada." >&2
    exit 4
  fi
done
mkdir -p "$HOME_DIR"
export HOME="$HOME_DIR" PATH="$TIUP_HOME/bin:$PATH"
echo 'TIDB_LOCAL_PROGRESS=installing-temporary-manager'
curl --proto '=https' --tlsv1.2 --max-time 60 -sSfL https://tiup-mirrors.pingcap.com/install.sh -o "$ROOT/install.sh"
sha256sum "$ROOT/install.sh" > "$REPORT_DIR/tiup-installer.sha256"
sh "$ROOT/install.sh" > "$REPORT_DIR/tiup-install.log" 2>&1
TIUP="$TIUP_HOME/bin/tiup"
"$TIUP" --version > "$REPORT_DIR/tiup-version.txt"

# O download é separado da espera do servidor. Impede timeout de prontidão
# enquanto PD/TiKV/TiDB ainda estão sendo baixados.
echo 'TIDB_LOCAL_PROGRESS=downloading-exact-components'
timeout 900 "$TIUP" install tidb:v8.5.3 tikv:v8.5.3 pd:v8.5.3 playground > "$REPORT_DIR/component-install.log" 2>&1
BIN="$("$TIUP" --binary tidb:v8.5.3)"
# TiUP --host restringe SQL, mas não necessariamente o host de status.
# Wrapper usa a flag --status-host verificada no próprio binário TiDB 8.5.3.
printf '#!/bin/sh\nexec "%s" "$@" --status-host=127.0.0.1\n' "$BIN" > "$ROOT/tidb-loopback-wrapper"
chmod 755 "$ROOT/tidb-loopback-wrapper"
echo 'TIDB_LOCAL_PROGRESS=starting-loopback-cluster'
setsid "$TIUP" playground v8.5.3 --host 127.0.0.1 \
  --db 1 --pd 1 --kv 1 --tiflash 0 --without-monitor \
  --db.binpath "$ROOT/tidb-loopback-wrapper" \
  --db.port 34000 --pd.port 32379 --kv.port 30160 \
  > "$REPORT_DIR/playground.log" 2>&1 &
PID=$!
READY=0
for i in $(seq 1 240); do
  if mysql --no-defaults --protocol=TCP -h127.0.0.1 -P34000 -uroot --connect-timeout=2 -e 'SELECT 1' >/dev/null 2>&1; then READY=1; break; fi
  kill -0 "$PID" 2>/dev/null || break
  if (( i % 20 == 0 )); then echo "TIDB_LOCAL_PROGRESS=waiting-for-sql-${i}"; fi
  sleep .5
done
if [[ "$READY" != 1 ]]; then
  printf '{"scope":"local-only","status":"startup-failed","migrationStatus":"not-run"}\n' > "$REPORT_DIR/report.json"
  exit 10
fi
ss -ltnp > "$REPORT_DIR/listeners.txt"
if grep -E 'tidb-server|tikv-server|pd-server' "$REPORT_DIR/listeners.txt" | grep -E '\*:[0-9]+|0\.0\.0\.0:[0-9]+' >/dev/null; then
  echo 'Runtime não está integralmente em loopback; recusado antes do SQL.' >&2
  exit 11
fi
echo 'TIDB_LOCAL_PROGRESS=literal-sql-and-tests'
node infra/scripts/validate_running_local_tidb_853.mjs "$REPORT_DIR/literal"
echo 'TIDB_LOCAL_PROGRESS=populated-enum-and-drizzle-journal'
node infra/scripts/validate_local_tidb_853_enum_journal.mjs "$REPORT_DIR/enum-journal"
python3 - "$REPORT_DIR" <<'PY'
import sys,json
from pathlib import Path
p=Path(sys.argv[1])
a=json.loads((p/'literal/report.json').read_text())
b=json.loads((p/'enum-journal/report.json').read_text())
assert a['allMigrationsPassed'] and a['testStatus']=='passed'
assert b['enumPreservation']=='passed' and b['drizzleMigration']=='passed'
PY
echo "TIDB_8_5_3_LOCAL_VALIDATION=PASS; REPORT_DIR=$REPORT_DIR"
