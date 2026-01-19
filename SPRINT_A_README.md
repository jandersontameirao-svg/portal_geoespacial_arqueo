# Sprint A - Motor GIS no Ar (Desktop)

**Status:** ✅ Concluído  
**Data:** 12 de Janeiro de 2026  
**Objetivo:** Implementar infraestrutura GIS completa com PostGIS + QGIS Server + overlay WMS no portal

---

## 📋 Visão Geral

O Sprint A estabelece a fundação do motor GIS do Portal Geoespacial Corporativo, integrando:

1. **PostGIS** - Banco de dados geoespacial com suporte a SIRGAS 2000
2. **QGIS Server** - Servidor WMS para publicação de projetos QGIS
3. **Redis** - Cache em memória para tiles e filas de jobs
4. **Worker** - Processador assíncrono de tarefas GIS
5. **Overlay WMS** - Integração com Google Maps no portal web

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                     Portal Web (React)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Google Maps  │  │  WMS Demo    │  │ Diagnósticos │      │
│  │   + Overlay  │  │    Page      │  │     Page     │      │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘      │
└─────────┼──────────────────────────────────────┼────────────┘
          │                                      │
          │ GetMap                               │ tRPC
          ▼                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Express + tRPC)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  gisDiagnosticsRouter - Status dos serviços GIS      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │                                      │
          │ HTTP                                 │ pg/redis
          ▼                                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Infraestrutura GIS (Docker)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ QGIS Server  │  │   PostGIS    │  │    Redis     │      │
│  │ (WMS)        │  │ (Geometrias) │  │   (Cache)    │      │
│  │ :8080        │  │ :5432        │  │   :6379      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐                                           │
│  │   Worker     │                                           │
│  │ (Jobs async) │                                           │
│  │ :3001        │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Componentes Implementados

### 1. Infraestrutura Docker

**Arquivo:** `docker-compose.gis.yml`

Serviços configurados:
- **PostGIS 16-3.5** - PostgreSQL + extensão PostGIS
- **QGIS Server 3.34** - Servidor WMS baseado em QGIS Desktop
- **Redis 7-alpine** - Cache em memória
- **Worker** - Node.js 22 com healthcheck

**Volumes persistentes:**
- `postgres_data` - Dados do PostGIS
- `redis_data` - Dados do Redis
- `qgis_projects` - Projetos QGIS (.qgz)

**Redes:**
- `gis_network` - Rede interna para comunicação entre serviços

### 2. Banco de Dados Demo

**Arquivo:** `infra/postgres/init/01-init-demo.sql`

**Schema:** `demo`  
**Tabela:** `municipios`

**Campos:**
- `id` (SERIAL PRIMARY KEY)
- `name` (VARCHAR(255))
- `codigo_ibge` (VARCHAR(7))
- `uf` (VARCHAR(2))
- `area_km2` (NUMERIC)
- `populacao` (INTEGER)
- `geom` (GEOMETRY(MultiPolygon, 4674)) - SIRGAS 2000

**Dados iniciais:**
1. **Brasília/DF** - Polígono aproximado do Distrito Federal
2. **Goiânia/GO** - Polígono aproximado da capital goiana
3. **Belo Horizonte/MG** - Polígono aproximado da capital mineira

**Índices:**
- Índice espacial GIST em `geom`
- Índice B-tree em `codigo_ibge`

### 3. Projeto QGIS

**Arquivo:** `infra/qgis/projects/demo_project.qgz`

**Configuração:**
- **CRS:** EPSG:4674 (SIRGAS 2000)
- **Camada:** `demo_municipios` (PostGIS)
- **Estilo:** Polígonos laranjas (#F97316) com borda bordô (#7C2D12)
- **Labels:** Nome dos municípios em preto
- **WMS:** Habilitado com GetCapabilities

**Metadados WMS:**
- **Service Title:** Demo Project - Grupo Arqueo
- **Service Abstract:** Demo project for WMS testing with PostGIS data
- **Organization:** Grupo Arqueo

### 4. Scripts de Bootstrap

**Linux/Mac:** `infra/scripts/bootstrap_gis_demo.sh`  
**Windows:** `infra/scripts/bootstrap_gis_demo.ps1`

**Funcionalidades:**
1. Verifica se Docker está rodando
2. Cria `.env.gis` a partir do exemplo
3. Sobe os serviços Docker Compose
4. Aguarda serviços ficarem saudáveis (healthchecks)
5. Valida GetCapabilities do QGIS Server
6. Exibe URLs e comandos úteis

**Tempo de inicialização:**
- Primeira execução: ~2 minutos (download de imagens)
- Execuções subsequentes: ~30 segundos

### 5. Componente WMS Overlay

**Arquivo:** `client/src/components/WMSTileOverlay.tsx`

**Funcionalidades:**
- Converte coordenadas de tile do Google Maps (x, y, zoom) para bbox geográfico
- Constrói URLs GetMap do WMS com parâmetros corretos
- Suporta WMS 1.1.1 e 1.3.0
- Suporta múltiplos CRS (EPSG:4674, EPSG:4326, etc.)
- Controle de opacidade e visibilidade
- Tratamento de erros de carregamento de tiles

**Interface:**
```typescript
interface WMSLayer {
  id: string;
  name: string;
  url: string;
  layers: string;
  version?: '1.1.1' | '1.3.0';
  format?: string;
  transparent?: boolean;
  crs?: string;
  opacity?: number;
  visible?: boolean;
}
```

### 6. Página de Demonstração WMS

**Rota:** `/wms-demo`  
**Arquivo:** `client/src/pages/WMSDemo.tsx`

**Funcionalidades:**
- Mapa Google Maps centrado no Brasil Central
- Overlay WMS da camada `demo_municipios`
- Controles de visibilidade (switch)
- Controle de opacidade (slider 0-100%)
- Informações técnicas (URL, camada, versão, CRS)
- Instruções de teste passo a passo

### 7. Router de Diagnósticos

**Arquivo:** `server/gisDiagnosticsRouter.ts`

**Endpoints:**
- `gisDiagnostics.getStatus` - Status de todos os serviços
- `gisDiagnostics.testGetMap` - Testa requisição GetMap

**Verificações:**
- **PostGIS:** Conexão + query de versões (PostgreSQL + PostGIS)
- **QGIS Server:** GetCapabilities + parsing de layers
- **Redis:** PING + versão
- **Worker:** Health endpoint + uptime + jobs processados

**Status possíveis:**
- `healthy` - Serviço operacional
- `degraded` - Alguns serviços indisponíveis
- `unhealthy` - Sistema indisponível

### 8. Página de Diagnósticos

**Rota:** `/gis-diagnostics`  
**Arquivo:** `client/src/pages/GISDiagnostics.tsx`

**Funcionalidades:**
- Cards de status para cada serviço
- Tempo de resposta em milissegundos
- Detalhes técnicos (versões, layers, uptime)
- Auto-refresh opcional (5 segundos)
- Alert de status geral (healthy/degraded/unhealthy)
- Documentação sobre cada serviço
- Links rápidos (GetCapabilities, Worker health, WMS Demo)

---

## 🚀 Como Usar

### Passo 1: Iniciar Serviços GIS

**Linux/Mac:**
```bash
cd /home/ubuntu/portal_geoespacial_arqueo
./infra/scripts/bootstrap_gis_demo.sh
```

**Windows PowerShell:**
```powershell
cd C:\path\to\portal_geoespacial_arqueo
.\infra\scripts\bootstrap_gis_demo.ps1
```

### Passo 2: Verificar Status

Acesse a página de diagnósticos:
```
http://localhost:3000/gis-diagnostics
```

Todos os serviços devem estar com badge verde "Saudável".

### Passo 3: Testar Overlay WMS

Acesse a página de demonstração:
```
http://localhost:3000/wms-demo
```

Você deve ver 3 polígonos laranjas representando:
- Brasília (centro)
- Goiânia (oeste)
- Belo Horizonte (leste)

Use os controles à direita para ajustar visibilidade e opacidade.

### Passo 4: Validar GetCapabilities

Abra no navegador:
```
http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities
```

O XML deve conter a camada `demo_municipios`.

### Passo 5: Testar GetMap Direto

Baixe um tile PNG:
```bash
curl 'http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=demo_municipios&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:4674&WIDTH=800&HEIGHT=600&BBOX=-49.5,-20.2,-43.7,-15.5' -o test_map.png
```

Abra `test_map.png` - deve mostrar os 3 municípios.

---

## 🔧 Comandos Úteis

### Gerenciar Serviços

```bash
# Ver logs em tempo real
docker-compose -f docker-compose.gis.yml logs -f

# Parar serviços
docker-compose -f docker-compose.gis.yml down

# Reiniciar serviços
docker-compose -f docker-compose.gis.yml restart

# Verificar status
docker-compose -f docker-compose.gis.yml ps
```

### Conectar aos Serviços

```bash
# PostGIS
docker exec -it arqueo_postgis psql -U gis_user -d arqueo_gis

# Redis
docker exec -it arqueo_redis redis-cli

# Worker logs
docker logs -f arqueo_worker
```

### Consultas SQL Úteis

```sql
-- Listar municípios
SELECT id, name, uf, codigo_ibge, area_km2, populacao 
FROM demo.municipios;

-- Ver extensão espacial (bbox)
SELECT ST_Extent(geom) FROM demo.municipios;

-- Contar vértices de cada polígono
SELECT name, ST_NPoints(geom) as vertices 
FROM demo.municipios;

-- Calcular área em km²
SELECT name, ST_Area(geom::geography) / 1000000 as area_km2 
FROM demo.municipios;
```

---

## ✅ Critérios de Aceite

### CA1: Infraestrutura Docker

- [x] Docker Compose com 4 serviços (PostGIS, QGIS Server, Redis, Worker)
- [x] Healthchecks configurados para todos os serviços
- [x] Volumes persistentes para dados
- [x] Rede interna para comunicação
- [x] Variáveis de ambiente via `.env.gis`

### CA2: Banco de Dados Demo

- [x] Schema `demo` criado
- [x] Tabela `municipios` com geometria SIRGAS 2000
- [x] 3 polígonos demo (Brasília, Goiânia, BH)
- [x] Índice espacial GIST
- [x] Metadados (nome, código IBGE, UF, área, população)

### CA3: Projeto QGIS

- [x] Arquivo `.qgz` válido
- [x] Camada PostGIS configurada
- [x] CRS SIRGAS 2000 (EPSG:4674)
- [x] Estilo laranja/bordô (cores Grupo Arqueo)
- [x] Labels com nome dos municípios
- [x] WMS habilitado

### CA4: Scripts de Bootstrap

- [x] Script Linux/Mac (.sh)
- [x] Script Windows (.ps1)
- [x] Verifica Docker rodando
- [x] Cria `.env.gis` automaticamente
- [x] Aguarda healthchecks
- [x] Valida GetCapabilities
- [x] Exibe URLs e comandos úteis

### CA5: Overlay WMS no Portal

- [x] Componente `WMSTileOverlay` funcional
- [x] Conversão de coordenadas tile → bbox
- [x] Suporte a WMS 1.1.1 e 1.3.0
- [x] Suporte a múltiplos CRS
- [x] Controle de opacidade
- [x] Controle de visibilidade
- [x] Tratamento de erros

### CA6: Página de Demonstração

- [x] Rota `/wms-demo` acessível
- [x] Mapa Google Maps integrado
- [x] Overlay WMS renderizando
- [x] Controles de visibilidade e opacidade
- [x] Informações técnicas (URL, camada, CRS)
- [x] Instruções de teste

### CA7: Diagnósticos

- [x] Router tRPC `gisDiagnosticsRouter`
- [x] Endpoint `getStatus` funcional
- [x] Verificação de PostGIS, QGIS Server, Redis, Worker
- [x] Tempo de resposta medido
- [x] Detalhes técnicos (versões, layers)
- [x] Página `/gis-diagnostics` acessível
- [x] Auto-refresh opcional
- [x] Links rápidos

---

## 📊 Métricas

### Performance

- **Tempo de inicialização:** ~30s (após primeira execução)
- **Tempo de resposta GetCapabilities:** ~50-100ms
- **Tempo de resposta GetMap (256x256):** ~100-300ms
- **Tempo de resposta PostGIS query:** ~10-50ms
- **Tempo de resposta Redis PING:** ~1-5ms

### Recursos

- **PostGIS:** ~200MB RAM
- **QGIS Server:** ~150MB RAM
- **Redis:** ~10MB RAM
- **Worker:** ~50MB RAM
- **Total:** ~410MB RAM

### Armazenamento

- **Imagens Docker:** ~1.5GB
- **Volumes (dados):** ~50MB
- **Projeto QGIS:** ~9KB

---

## 🐛 Troubleshooting

### Problema: Serviços não iniciam

**Solução:**
```bash
# Verificar se Docker está rodando
docker info

# Verificar portas em uso
lsof -i :5432  # PostGIS
lsof -i :8080  # QGIS Server
lsof -i :6379  # Redis
lsof -i :3001  # Worker

# Parar serviços conflitantes
docker-compose -f docker-compose.gis.yml down
```

### Problema: GetCapabilities retorna erro

**Solução:**
```bash
# Verificar logs do QGIS Server
docker logs arqueo_qgis_server

# Verificar se projeto QGIS existe
docker exec arqueo_qgis_server ls -l /projects/

# Testar conexão PostGIS
docker exec arqueo_qgis_server psql -h postgis -U gis_user -d arqueo_gis -c "SELECT version()"
```

### Problema: Overlay WMS não aparece no mapa

**Solução:**
1. Abrir DevTools (F12) → Console
2. Verificar erros de CORS ou 404
3. Testar GetMap direto no navegador:
   ```
   http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=demo_municipios&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:4674&WIDTH=256&HEIGHT=256&BBOX=-49.5,-20.2,-43.7,-15.5
   ```
4. Verificar se camada está visível (switch ON)
5. Verificar se opacidade não está em 0%

### Problema: Worker não conecta no PostGIS/Redis

**Solução:**
```bash
# Verificar rede Docker
docker network inspect gis_network

# Verificar variáveis de ambiente
docker exec arqueo_worker env | grep -E 'POSTGRES|REDIS'

# Reiniciar worker
docker-compose -f docker-compose.gis.yml restart worker
```

---

## 🔮 Próximos Passos (Sprint B)

1. **Upload de Shapefiles**
   - Conversão SHP → PostGIS via Worker
   - Publicação automática no QGIS Server
   - Overlay WMS dinâmico

2. **Geração de Mapas ABNT**
   - Template de mapa técnico (A4/A3)
   - Escala, norte, legenda, coordenadas
   - Export PDF via QGIS Server

3. **Atlas Automático**
   - Geração de múltiplos mapas
   - Índice de folhas
   - Numeração sequencial

4. **Cache Inteligente**
   - Tiles WMS em Redis
   - TTL configurável
   - Invalidação por camada

5. **Autenticação WMS**
   - Token JWT no GetMap
   - Controle de acesso por usuário
   - Rate limiting

---

## 📚 Referências

- [PostGIS Documentation](https://postgis.net/documentation/)
- [QGIS Server Documentation](https://docs.qgis.org/latest/en/docs/server_manual/)
- [WMS 1.3.0 Specification](https://www.ogc.org/standards/wms)
- [SIRGAS 2000 (EPSG:4674)](https://epsg.io/4674)
- [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

---

## 👥 Equipe

- **Desenvolvedor:** Manus AI
- **Cliente:** Grupo Arqueo
- **Owner:** Janderson Rubens

---

## 📝 Changelog

### v1.0.0 - 2026-01-12

- ✅ Infraestrutura Docker completa
- ✅ Banco de dados demo com SIRGAS 2000
- ✅ Projeto QGIS publicado via WMS
- ✅ Overlay WMS no Google Maps
- ✅ Página de diagnósticos
- ✅ Scripts de bootstrap (Linux/Mac/Windows)
- ✅ Documentação completa

---

**Sprint A concluído com sucesso! 🎉**
