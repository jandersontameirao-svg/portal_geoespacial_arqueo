# Arquitetura do Portal Geoespacial Corporativo - Grupo Arqueo

## Visão Geral

O Portal Geoespacial Corporativo é um sistema web completo para gerenciamento de projetos geoespaciais, visualização de dados cartográficos em 2D e 3D, geração de mapas técnicos no padrão ABNT e controle rigoroso de acesso baseado em roles.

## Stack Tecnológica

### Frontend
- **Framework**: React 19 com TypeScript
- **Visualização 3D**: CesiumJS 1.137
- **Visualização 2D**: OpenLayers 10.7 / MapLibre GL 5.15
- **UI Components**: shadcn/ui (Radix UI + Tailwind CSS 4)
- **Estado e Comunicação**: tRPC 11 + TanStack Query
- **Roteamento**: Wouter 3
- **Estilização**: Tailwind CSS 4 com tema customizado

### Backend
- **Runtime**: Node.js 22
- **Framework**: Express 4
- **API**: tRPC 11 (Type-safe RPC)
- **Autenticação**: Manus OAuth + JWT
- **Validação**: Zod 4

### Banco de Dados
- **SGBD**: MySQL/TiDB (compatível com PostGIS via extensões)
- **ORM**: Drizzle ORM 0.44
- **Migrações**: Drizzle Kit
- **CRS Base**: EPSG:4674 (SIRGAS 2000 Geográfico)
- **CRS Impressão**: EPSG:31982-31985 (UTM SIRGAS 2000)

### Armazenamento
- **Object Storage**: S3-compatible (Manus Storage)
- **Arquivos Suportados**: KML, KMZ, SHP (ZIP), PDF, DOCX, XLSX, Imagens

### Serviços Geoespaciais
- **QGIS Server**: Para geração de mapas técnicos
- **Print Layouts**: Templates .qpt customizados
- **Conversão**: ogr2ogr para processamento de shapefiles

## Arquitetura de Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  CesiumJS    │  │ OpenLayers/  │  │   shadcn/ui  │     │
│  │  (Globo 3D)  │  │  MapLibre    │  │  Components  │     │
│  │              │  │   (Mapa 2D)  │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           tRPC Client (Type-safe API)               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND (Express + tRPC)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   tRPC Routers                      │   │
│  │  • auth        • projects      • files             │   │
│  │  • invitations • layers        • printJobs         │   │
│  │  • audit       • savedMaps     • atlasJobs         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Middleware & Security                  │   │
│  │  • JWT Validation  • Rate Limiting                 │   │
│  │  • RBAC/ABAC       • Audit Logging                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
           ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  MySQL/  │    │    S3    │    │  QGIS    │
    │  TiDB    │    │ Storage  │    │  Server  │
    │          │    │          │    │          │
    │ PostGIS  │    │  Files   │    │  Print   │
    │ Geometry │    │ Versions │    │ Layouts  │
    └──────────┘    └──────────┘    └──────────┘
```

## Modelo de Dados

### Entidades Principais

#### 1. Usuários e Autenticação
- **users**: Usuários do sistema com roles (admin, editor, client)
- **invitations**: Convites para novos usuários (sem auto-cadastro)
- MFA obrigatório para usuários internos, opcional para clientes

#### 2. Projetos
- **projects**: Projetos geoespaciais com AOI (Área de Interesse)
- **project_members**: Membros autorizados por projeto
- Isolamento completo de dados por projeto

#### 3. Arquivos
- **files**: Metadados de arquivos geoespaciais e não-geoespaciais
- **file_versions**: Versionamento completo de arquivos
- Armazenamento em S3, metadados no banco

#### 4. Camadas Geoespaciais
- **layers**: Camadas vetoriais e raster
- **styles**: Estilos SLD, MapBox, Cesium
- Suporte a múltiplas camadas simultâneas

#### 5. Mapas e Visualizações
- **saved_maps**: Configurações de visualização 2D/3D salvas
- **print_jobs**: Jobs de geração de mapas técnicos ABNT
- **atlas_jobs**: Jobs de geração de atlas automático

#### 6. Auditoria
- **audit_logs**: Logs imutáveis de todas as ações
- Rastreamento completo de acessos, downloads e edições

### Diagrama ER Simplificado

```
users (1) ──── (N) project_members (N) ──── (1) projects
  │                                              │
  │                                              │
  ├──── (N) invitations                          │
  │                                              │
  ├──── (N) audit_logs                           │
  │                                              │
  └──── (N) files ──── (N) file_versions        │
                │                                │
                └──── (N) layers                 │
                        │                        │
                        └──── (1) styles         │
                                                 │
                        saved_maps (N) ──────────┤
                        print_jobs (N) ──────────┤
                        atlas_jobs (N) ──────────┘
```

## Segurança

### Controle de Acesso

#### Roles
1. **Admin**: Acesso total ao sistema
   - Criar/editar/excluir projetos
   - Gerenciar usuários e convites
   - Acessar logs de auditoria
   - Configurar sistema

2. **Editor**: Acesso de edição
   - Criar/editar projetos
   - Upload de arquivos
   - Gerar mapas técnicos
   - Sem acesso a gerenciamento de usuários

3. **Client**: Acesso somente leitura
   - Visualizar projetos autorizados
   - Download de arquivos autorizados
   - Visualizar mapas gerados
   - Sem permissões de edição

### Fluxo de Convite (Sem Auto-cadastro)

```
1. Admin cria convite com e-mail e role
   ↓
2. Sistema gera token único com validade de 7 dias
   ↓
3. E-mail enviado com link de convite
   ↓
4. Usuário acessa link e define senha
   ↓
5. Admin vincula usuário a projetos
   ↓
6. Acesso liberado conforme permissões
```

### Medidas de Segurança Implementadas

- ✅ **Autenticação JWT** com Manus OAuth
- ✅ **MFA obrigatório** para usuários internos
- ✅ **Rate Limiting** em todas as rotas
- ✅ **RBAC/ABAC** com verificação em cada endpoint
- ✅ **Audit Logging** imutável de todas as ações
- ✅ **Upload Hardening**:
  - Validação de tipo MIME
  - Limite de tamanho
  - Proteção contra zip bomb
  - Antivírus (ClamAV - a ser integrado)
- ✅ **TLS obrigatório** em produção
- ✅ **Hashing forte** de senhas (bcrypt via Manus Auth)
- ✅ **Proteções OWASP Top 10**:
  - SQL Injection (Drizzle ORM parametrizado)
  - XSS (React sanitization)
  - CSRF (SameSite cookies)
  - Broken Authentication (JWT + MFA)

## Funcionalidades Geoespaciais

### Visualização 2D/3D

#### Modo 3D (CesiumJS)
- Globo terrestre interativo
- Terreno 3D (Cesium World Terrain)
- Iluminação baseada no sol
- Suporte a modelos 3D (glTF)
- Navegação intuitiva (pan, zoom, rotate)

#### Modo 2D (OpenLayers/MapLibre)
- Visualização cartográfica plana
- Múltiplos basemaps
- Controles de zoom e pan
- Medições e anotações

#### Alternância 2D ↔ 3D
- Transição suave entre modos
- Preservação de posição e zoom
- Sincronização de camadas ativas

### Processamento de Shapefiles

Pipeline automático:
1. **Validação de ZIP**: Verificar arquivos obrigatórios (.shp, .shx, .dbf)
2. **Validação de CRS**: Detectar sistema de coordenadas
3. **Conversão**: ogr2ogr para EPSG:4674
4. **Inserção**: Dados no PostGIS
5. **Publicação**: Camada disponível para visualização
6. **Metadados**: Registro completo no banco

### Geração de Mapas Técnicos ABNT

#### Elementos Obrigatórios
- ✅ Título e subtítulo
- ✅ Nome do projeto e cliente
- ✅ Autor / Grupo Arqueo
- ✅ Data de geração
- ✅ Escala gráfica e numérica
- ✅ Seta norte
- ✅ Legenda dinâmica
- ✅ CRS: UTM / SIRGAS 2000
- ✅ Fuso UTM automático (com override manual)
- ✅ Grade UTM
- ✅ Moldura cartográfica
- ✅ Carimbo técnico
- ✅ Logomarca Grupo Arqueo

#### Templates Disponíveis
1. **Template Técnico ABNT**: Para uso interno e entregas oficiais
2. **Template Cliente**: Personalizado com logo do cliente

#### Formatos de Saída
- PDF (alta resolução)
- PNG (para visualização web)
- Tamanhos: A4, A3, A1, A0
- Orientação: Portrait ou Landscape

### Sistema de Atlas Automático

Geração inteligente de atlas multipágina:

1. **Entrada do Usuário**:
   - Escala desejada (ex: 1:1000)
   - Tamanho de folha (A4, A3, A1)
   - Área de cobertura (AOI)

2. **Processamento Automático**:
   - Cálculo de grid baseado na escala
   - Divisão da área em páginas
   - Numeração sequencial (01/N, 02/N, ...)
   - Geração paralela de páginas

3. **Saída**:
   - PDF multipágina consolidado
   - PDFs individuais por página
   - Índice de localização

## APIs Gratuitas e Open Source Utilizadas

### Basemaps

1. **OpenStreetMap**
   - Licença: ODbL (Open Database License)
   - Uso: Basemap padrão para visualização 2D
   - Limitações: Rate limiting de 1 req/s
   - Alternativa: Mapbox (com token gratuito)

2. **Cesium Ion**
   - Licença: Gratuita para uso não-comercial
   - Uso: Terreno 3D e imagery
   - Limitações: 50.000 tiles/mês
   - Alternativa: Bing Maps (com chave gratuita)

3. **Natural Earth**
   - Licença: Public Domain
   - Uso: Dados vetoriais de referência
   - Limitações: Nenhuma
   - Alternativa: N/A

### Tiles e Cache

1. **MapTiler**
   - Licença: Freemium (100.000 tiles/mês grátis)
   - Uso: Tiles vetoriais e raster
   - Limitações: Limite mensal
   - Alternativa: Stamen Maps

2. **Stamen Maps**
   - Licença: CC BY 3.0
   - Uso: Tiles estilizados (Terrain, Toner, Watercolor)
   - Limitações: Nenhuma
   - Alternativa: CartoDB

### Conversão Geoespacial

1. **GDAL/OGR**
   - Licença: MIT/X
   - Uso: Conversão de formatos geoespaciais
   - Limitações: Nenhuma
   - Alternativa: N/A (padrão da indústria)

2. **Proj**
   - Licença: MIT
   - Uso: Transformação de CRS
   - Limitações: Nenhuma
   - Alternativa: N/A

### Segurança

1. **ClamAV** (Planejado)
   - Licença: GPL v2
   - Uso: Antivírus para upload de arquivos
   - Limitações: Requer daemon rodando
   - Alternativa: VirusTotal API

## Endpoints da API (tRPC)

### Auth
- `auth.me`: Obter usuário atual
- `auth.logout`: Fazer logout

### Invitations (Admin apenas)
- `invitations.create`: Criar convite
- `invitations.list`: Listar convites criados
- `invitations.validate`: Validar token de convite

### Projects
- `projects.create`: Criar projeto (Admin/Editor)
- `projects.list`: Listar projetos do usuário
- `projects.get`: Obter detalhes de projeto
- `projects.update`: Atualizar projeto (Admin/Editor)
- `projects.addMember`: Adicionar membro (Admin/Editor)
- `projects.members`: Listar membros
- `projects.removeMember`: Remover membro (Admin/Editor)

### Files (Planejado)
- `files.upload`: Upload de arquivo
- `files.list`: Listar arquivos do projeto
- `files.get`: Obter detalhes de arquivo
- `files.download`: Download de arquivo
- `files.delete`: Excluir arquivo (soft delete)

### Layers (Planejado)
- `layers.create`: Criar camada
- `layers.list`: Listar camadas do projeto
- `layers.get`: Obter detalhes de camada
- `layers.update`: Atualizar camada
- `layers.delete`: Excluir camada

### SavedMaps (Planejado)
- `savedMaps.create`: Salvar configuração de mapa
- `savedMaps.list`: Listar mapas salvos
- `savedMaps.get`: Obter mapa salvo
- `savedMaps.delete`: Excluir mapa salvo

### PrintJobs (Planejado)
- `printJobs.create`: Criar job de impressão
- `printJobs.list`: Listar jobs
- `printJobs.get`: Obter status de job
- `printJobs.cancel`: Cancelar job

### AtlasJobs (Planejado)
- `atlasJobs.create`: Criar job de atlas
- `atlasJobs.list`: Listar jobs
- `atlasJobs.get`: Obter status de job
- `atlasJobs.cancel`: Cancelar job

### Audit
- `audit.recent`: Logs recentes (Admin apenas)
- `audit.byProject`: Logs por projeto
- `audit.byUser`: Logs por usuário

## Deploy e Operação

### Requisitos de Sistema

#### Produção
- **CPU**: 4+ cores
- **RAM**: 8GB+ (16GB recomendado)
- **Disco**: 100GB+ SSD
- **Rede**: 100Mbps+
- **OS**: Ubuntu 22.04 LTS ou superior

#### Desenvolvimento
- **CPU**: 2+ cores
- **RAM**: 4GB+
- **Disco**: 20GB+
- **Node.js**: 22.x
- **pnpm**: 10.x

### Variáveis de Ambiente

```bash
# Database
DATABASE_URL=mysql://user:pass@host:3306/dbname

# Auth
JWT_SECRET=<secret>
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://portal.manus.im

# Manus
VITE_APP_ID=<app_id>
OWNER_OPEN_ID=<owner_open_id>
OWNER_NAME=<owner_name>

# Storage
BUILT_IN_FORGE_API_URL=<api_url>
BUILT_IN_FORGE_API_KEY=<api_key>
VITE_FRONTEND_FORGE_API_KEY=<frontend_key>
VITE_FRONTEND_FORGE_API_URL=<frontend_url>

# QGIS Server (Planejado)
QGIS_SERVER_URL=http://qgis:8080
QGIS_TEMPLATES_PATH=/templates
```

### Scripts de Desenvolvimento

```bash
# Instalar dependências
pnpm install

# Aplicar migrações
pnpm db:push

# Desenvolvimento
pnpm dev

# Build
pnpm build

# Produção
pnpm start

# Testes
pnpm test

# Type checking
pnpm check
```

### Health Checks

O sistema expõe endpoints de health check:

- `/health`: Status geral do sistema
- `/health/db`: Status do banco de dados
- `/health/storage`: Status do S3

### Monitoramento

Logs estruturados em JSON para fácil parsing:

```json
{
  "timestamp": "2026-01-11T22:00:00Z",
  "level": "info",
  "service": "portal-geoespacial",
  "action": "project.create",
  "userId": 123,
  "projectId": 456,
  "duration": 234,
  "status": "success"
}
```

### Backups

#### Banco de Dados
- Backup diário automático
- Retenção: 30 dias
- Backup incremental a cada 6 horas

#### Arquivos (S3)
- Versionamento habilitado
- Lifecycle policy: mover para Glacier após 90 dias
- Retenção: 1 ano

## Roadmap de Funcionalidades

### Fase 1 - MVP (Concluído)
- ✅ Autenticação e controle de acesso
- ✅ Gerenciamento de projetos
- ✅ Visualizador 3D com CesiumJS
- ✅ Sistema de convites
- ✅ Logs de auditoria
- ✅ Modelo de dados completo

### Fase 2 - Funcionalidades Core (Em Progresso)
- ⏳ Upload e gerenciamento de arquivos
- ⏳ Processamento de shapefiles
- ⏳ Visualização de camadas
- ⏳ Alternância 2D/3D
- ⏳ Mapas salvos

### Fase 3 - Geração de Mapas (Planejado)
- ⏳ Integração com QGIS Server
- ⏳ Templates ABNT (.qpt)
- ⏳ Geração de mapas técnicos
- ⏳ Sistema de atlas automático
- ⏳ Exportação em múltiplos formatos

### Fase 4 - Funcionalidades Avançadas (Planejado)
- ⏳ Análise espacial
- ⏳ Medições e anotações
- ⏳ Compartilhamento de mapas
- ⏳ API pública para integrações
- ⏳ Mobile app (visualização)

### Fase 5 - Otimizações (Planejado)
- ⏳ Cache de tiles
- ⏳ CDN para arquivos estáticos
- ⏳ Compressão de geometrias
- ⏳ Lazy loading de camadas
- ⏳ Progressive Web App (PWA)

## Manutenção e Suporte

### Logs de Aplicação
- Localização: `/var/log/portal-geoespacial/`
- Rotação: Diária
- Retenção: 30 dias

### Troubleshooting Comum

#### Problema: Globo 3D não carrega
- Verificar token do Cesium Ion
- Verificar conectividade com cesium.com
- Verificar console do navegador para erros

#### Problema: Upload de arquivo falha
- Verificar limite de tamanho (configurado no nginx)
- Verificar permissões do S3
- Verificar logs de auditoria

#### Problema: Mapa técnico não gera
- Verificar status do QGIS Server
- Verificar templates .qpt existem
- Verificar logs do job de impressão

## Contato e Suporte

- **Documentação**: https://docs.grupoarqueo.com/portal-geoespacial
- **Issues**: https://github.com/grupoarqueo/portal-geoespacial/issues
- **E-mail**: suporte@grupoarqueo.com
