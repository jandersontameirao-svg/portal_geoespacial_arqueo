#!/usr/bin/env bash
# ===================================================================
# provision.sh — install + build + migrate + (re)start no PM2
# ===================================================================
# Automatiza as etapas repetíveis do deploy. NÃO cria banco, NÃO cria .env
# e NÃO mexe no nginx/certbot — isso é feito uma vez, manualmente (ver DEPLOY.md).
#
# Pré-requisitos já atendidos antes de rodar:
#   - Repo clonado em /var/www/geoportal
#   - Arquivo .env preenchido em /var/www/geoportal/.env
#   - MySQL com banco + usuário criados e acessíveis via DATABASE_URL
#   - Node 20+ e pnpm instalados; pm2 instalado globalmente
#
# Uso:  cd /var/www/geoportal && bash deploy/provision.sh
set -euo pipefail

APP_DIR="/var/www/geoportal"
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "ERRO: .env não encontrado em $APP_DIR. Crie-o a partir de deploy/.env.example." >&2
  exit 1
fi

echo "==> 1/4 Instalando dependências (pnpm install)"
pnpm install --frozen-lockfile

echo "==> 2/4 Build (vite + esbuild)"
# VITE_APP_ID precisa estar no ambiente durante o build do client.
set -a; . ./.env; set +a
pnpm build

echo "==> 3/4 Migrando o banco (drizzle-kit migrate)"
pnpm exec drizzle-kit migrate

echo "==> 4/4 Subindo no PM2"
if pm2 describe geoportal >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo "==> OK. Verifique:  curl -I http://127.0.0.1:8002"
