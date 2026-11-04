# Deploy — Portal Geoespacial Arqueo (VPS Hostinger + nginx + PM2 + MySQL)

Guia de deploy nativo (sem Docker) do app em uma VPS Ubuntu 24.04, atrás do
nginx com HTTPS. Login é **próprio (e-mail + senha)** — não há mais dependência
de OAuth externo.

## 0. Dados desta VPS

| Item | Valor |
|------|-------|
| Host | `srv1684389.hstgr.cloud` |
| IPv4 | `2.24.109.107` |
| Subdomínio | `geoportal.sigpa.com.br` ← **defina e troque em todo este guia** |
| Porta local | `8002` (loopback; só o nginx acessa) |
| Banco | MySQL local `127.0.0.1:3306`, DB `portal_geo`, usuário `geoportal` |
| Processo | PM2, app `geoportal` |

Stack: Node 20+, **pnpm**, Express + Vite/React, build com esbuild, MySQL (Drizzle).

---

## 1. DNS

O registro **A** `geoportal.sigpa.com.br → 2.24.109.107` **já está criado e
ativo** na zona DNS. Se precisar recriar, é um registro A:

```
geoportal  →  2.24.109.107
```

Teste (do seu PC ou da VPS):

```bash
dig +short geoportal.sigpa.com.br
```

---

## 2. Pré-requisitos na VPS (só se ainda não tiver)

Confira versões:

```bash
node -v; pnpm -v; pm2 -v; nginx -v; mysql --version
```

Se faltar pnpm ou pm2:

```bash
npm install -g pnpm pm2
```

Confirme que a porta **8002** está livre:

```bash
ss -tlnp | grep ':8002' || echo LIVRE
```

---

## 3. Banco de dados (MySQL)

Abra o MySQL como root (vai pedir a senha do root do MySQL):

```bash
mysql -u root -p
```

Dentro do prompt do MySQL, crie o banco e o usuário dedicado. **Troque a
senha** por uma forte:

```sql
CREATE DATABASE portal_geo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'geoportal'@'127.0.0.1' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
GRANT ALL PRIVILEGES ON portal_geo.* TO 'geoportal'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

---

## 4. Clonar o repositório

```bash
mkdir -p /var/www && cd /var/www
git clone https://github.com/jandersontameirao-svg/portal_geoespacial_arqueo.git geoportal
cd geoportal
git checkout feat/deploy-login-proprio
```

> Se o clone pedir autenticação (repo privado), a saída mais simples é deixá-lo
> público temporariamente só para clonar (o `.env` está no `.gitignore`, então
> não há segredo no repo) e depois voltar a privado. Alternativa: usar um token
> do GitHub na URL.

---

## 5. Criar o `.env`

Gere o segredo da sessão **na VPS** e guarde a saída:

```bash
openssl rand -hex 32
```

Crie o `.env` com `nano` (assim o shell não expande `$` da senha do banco):

```bash
cp deploy/.env.example .env
nano .env
```

Preencha:
- `DATABASE_URL` com o usuário/senha/banco do passo 3.
- `JWT_SECRET` com o valor do `openssl rand -hex 32`.
- `VITE_APP_ID` pode ficar como `geoportal-arqueo`.
- `PORT=8002`, `HOST=127.0.0.1`, `NODE_ENV=production` (já vêm preenchidos).

Salve: `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## 6. Instalar, buildar e migrar

Pode rodar tudo de uma vez com o script:

```bash
bash deploy/provision.sh
```

Ou manualmente, passo a passo:

```bash
pnpm install --frozen-lockfile
```

```bash
set -a; . ./.env; set +a    # exporta VITE_APP_ID para o build do client
pnpm build
```

```bash
pnpm exec drizzle-kit migrate
```

---

## 7. Criar o usuário administrador (login próprio)

As credenciais abaixo são passadas **só nesta execução** (não vão para o `.env`):

```bash
ADMIN_EMAIL="voce@exemplo.com" ADMIN_PASSWORD='SuaSenhaForte123' ADMIN_NAME="Seu Nome" pnpm exec tsx infra/scripts/seed_admin.ts
```

O script é idempotente: rodar de novo com o mesmo e-mail apenas redefine a senha.

---

## 8. Subir no PM2

Se usou o `provision.sh`, o app já está no PM2. Caso contrário:

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

Habilite o start automático no boot (rode a linha que o comando imprimir):

```bash
pm2 startup
```

Teste que o app está de pé no loopback:

```bash
curl -I http://127.0.0.1:8002
curl -s http://127.0.0.1:8002/api/health
```

---

## 9. nginx

O arquivo já vem com `server_name geoportal.sigpa.com.br`:

```bash
cp deploy/nginx-geoportal.conf /etc/nginx/sites-available/geoportal
```

Ative e recarregue:

```bash
ln -sf /etc/nginx/sites-available/geoportal /etc/nginx/sites-enabled/geoportal
nginx -t && systemctl reload nginx
```

---

## 10. HTTPS (obrigatório)

O cookie de sessão é `secure` + `SameSite=None`, então **o login só funciona em
HTTPS**. Emita o certificado:

```bash
certbot --nginx -d geoportal.sigpa.com.br --redirect
```

---

## 11. Teste final

Abra no navegador: `https://geoportal.sigpa.com.br`

- A Home deve mostrar o formulário de login (e-mail + senha).
- Entre com o admin criado no passo 7.

---

## Operação do dia a dia

```bash
pm2 logs geoportal           # ver logs
pm2 restart geoportal        # reiniciar
```

Atualizar o app após novos commits:

```bash
cd /var/www/geoportal
git pull
bash deploy/provision.sh     # reinstala, builda, migra e recarrega o PM2
```

---

## Notas

- **GIS opcional desligado:** PostGIS/QGIS/Redis (`docker-compose.gis.yml`,
  `.env.gis.example`) não são necessários; as features de worker de raster/atlas
  ficam inativas sem eles. Nada disso bloqueia o portal.
- **O que mudou no código para este deploy** (branch `feat/deploy-login-proprio`):
  login próprio e-mail+senha reaproveitando a sessão JWT existente; remoção do
  fallback de sincronização via OAuth externo; o servidor passa a escutar só em
  `127.0.0.1` com porta fixa em produção e `trust proxy` para o nginx.
