# Matriz de requisitos — cópia isolada

**Data:** 29/10/2026
**Escopo:** `/home/ubuntu/portal_geoespacial_arqueo_isolated`
**Fonte de requisitos:** `/home/ubuntu/upload/pasted_content_2.txt`
**Regra de evidência:** nenhum item abaixo significa publicação, homologação OAuth, alteração de dados de produção ou aceite final do Geoportal.

## Legenda de status

- **Implementado:** código existe na cópia isolada, mas pode depender de integração externa.
- **Testado localmente:** teste determinístico ou ensaio local executado sem dados/segredos de produção.
- **Simulado / configuração:** interface, job ou prévia existe, mas não há executor ou integração real comprovada.
- **Bloqueado por infraestrutura:** o código depende de serviço inexistente no sandbox; a pendência não foi mascarada.
- **Pendente de código:** ainda requer implementação na cópia isolada.

## Alterações realizadas nesta rodada

| Entrega | Arquivos principais | Evidência |
|---|---|---|
| KML/KMZ para GeoJSON e promoção arquivo → camada | `server/fileProcessing.ts`, `server/vectorLayerPromotion.ts`, `server/filesRouter.ts`, `server/db.ts` | `server/vectorLayerPromotion.test.ts`: conversão KML, extração KMZ, proveniência, camada inicialmente invisível e recusa de coleção vazia. |
| Seleção independente de vetores importados para análise | `client/src/components/ProjectGeoWorkspace.tsx`, `server/gisAnalysisRouter.ts` | Workspace adiciona visibilidade persistida, seleção de fonte, exportação GeoJSON e combinação explícita com desenhos. Requer MySQL/OAuth para ensaio end-to-end. |
| GeoJSON no fluxo principal de arquivo | `drizzle/schema.ts`, `drizzle/0009_quiet_runaways.sql`, `client/src/components/FileUpload.tsx`, `client/src/pages/Files.tsx` | Migration revisada: apenas amplia enum de `files`; não aplicada. |
| Navegação consistente | `client/src/components/Header.tsx`, `client/src/components/GlobalSearch.tsx`, `client/src/pages/ProjectDetail.tsx` | Repositório aponta para `/files`; busca usa `?tab=files` / `?tab=map`; projeto interpreta tab por URL. |
| Bloqueio do upload GIS fictício | `client/src/components/GisUploader.tsx`, `client/src/pages/GisUploads.tsx`, `server/gisUploadsRouter.ts` | URL `storage.example.com` removida do novo fluxo; tela legado só preserva histórico e encaminha a Projeto → Arquivos; novas iniciações exigem `projectId` e editor membro. |
| Acesso de projeto reforçado | `server/routers.ts`, `server/gisUploadsRouter.ts` | Membros, histórico e operações GIS legadas reutilizam `requireProjectAccess` / `requireProjectEditor`. |

## Matriz item a item

| Requisito da especificação | Estado atual | Código/evidência | Pendência objetiva |
|---|---|---|---|
| Cópia isolada; sem publicação, produção, DSN ou segredos | **Implementado** | Worktree isolada; comandos de teste usam `DATABASE_URL=''`; não houve publicação nem DDL. | Commit/pacote ainda precisam ser gerados após esta matriz. |
| Preservar `.gitignore` preexistente | **Em preservação** | Nenhuma alteração desta rodada é adicionada a `.gitignore`. | Confirmar no commit que ele continua fora do staging. |
| Corrigir rota arquivo → mapa e evitar 404 | **Implementado** | O antigo botão enganoso do fluxo GIS legado foi removido; a entrada real é Projeto → Arquivos → Mapa. Rotas de busca usam a aba de projeto existente. | O histórico legado não pode ser convertido automaticamente sem dados de origem/projeto confiáveis. |
| Upload sempre vinculado ao projeto, original/CRS/metadados/status preservados | **Implementado (fluxo principal)** | `filesRouter` persiste original, CRS, bounds, metadata e arquivo; vetores válidos passam a criar `layers` com `fileId`. | Criar `file_versions` no upload e ensaiar com MySQL próprio. |
| Fluxo GIS paralelo sem URL fictícia e sem projeto | **Implementado / restrito** | `GisUploader` não grava bytes; novos envios levam ao fluxo integrado; `gisUploads.initiate` exige projeto e editor. | Migrar registros históricos, somente após mapeamento de origem e autorização. |
| OSM sem burlar política | **Implementado** | Catálogo de mapas-base evita `tile.openstreetmap.org`; Esri é a base habilitada. | Configurar fornecedor aprovado de OSM/OpenTopo com termos e limite de uso. |
| Esri satélite, OSM, OpenTopo, Esri Light/Dark selecionáveis | **Parcial / testado localmente** | `basemaps.ts` e seletores em `BaseLayersViewer`/workspace oferecem World Imagery e Light/Dark Gray Esri; os dois últimos foram verificados por HTTP 200 e são rotulados como legados até dez/2029. | OSM/OpenTopo continuam bloqueados até provedor aprovado; basemaps vetoriais substitutos Esri exigem adaptador próprio. |
| FUNAI, INCRA, IPHAN com cache | **Implementado / não homologado** | `geodataService.ts`, `baseLayersRouter.ts`, testes de normalização INCRA. | Retentativas com backoff, estado de cache antigo e ensaio com storage/MySQL isolados. TLS FUNAI permanece estrito. |
| IBGE, ICMBio e conectores oficiais | **Pendente de código/configuração** | Catálogo OGC defensivo existe. | Adicionar conectores reais aprovados, allowlist, licença, cache e health. |
| Carregar duas bases + um arquivo, visibilidade, opacidade, ordem, legenda, zoom, export íntegro | **Parcial** | `BaseLayersViewer` suporta estados e opacidade; workspace tem raster/vetor/resultado. | Ordem temática, legenda cartográfica e exportação Shapefile/reabertura ainda não têm prova E2E. |
| Layout mapa em destaque, sem scroll de documento, painéis recolhíveis em 1057×692 | **Pendente de código/ensaio visual** | Ajustes de altura foram feitos anteriormente. | Redesenhar canvas responsivo e testar viewport alvo; não há evidência de solução integral. |
| Paleta clara azul/vinho/laranja moderada | **Implementado visualmente** | Componentes do portal e estilo QGIS demo. | Validar UX responsiva após integração autenticada. |
| Preservar 443 projetos e TEST | **Bloqueado por infraestrutura** | Não há rotina de exclusão nesta cópia. | Conferir contagem em banco de homologação próprio; não usar produção. |
| Diagnosticar sessão desconectada sem supor vulnerabilidade | **Pendente de código/instrumentação** | Autenticação não foi alterada nesta rodada. | Adicionar correlação segura de falhas OAuth/cookie/rede/DB em homologação. |
| `/files`, Repositório, Projetos e busca coerentes | **Implementado** | `Header`, `GlobalSearch`, `ProjectDetail` usam rotas/abas existentes. | Smoke autenticado em navegador com banco/OAuth próprios. |
| Criar, editar, excluir feições por projeto | **Implementado** | Workspace + `geometriesRouter`; Leaflet Draw nativo. | Teste autenticado com dois perfis e banco isolado. |
| Buffer, interseção, união, recorte, sobreposição, ADA e malha | **Testado localmente** | `gisAnalysis.ts`, `gisAnalysis.test.ts` com 5 casos de valores conhecidos. | `clip`/`overlay` ainda usam semântica de interseção binária; diferenciar se a regra de negócio exigir. |
| Resultados persistidos com parâmetros/proveniência e exportação | **Implementado / local** | `gisAnalysisRouter`, camada persistida e export GeoJSON controlado. | Gravar/reabrir em MySQL e validar arquivo baixado em navegador. |
| Vetores importados → camadas → escolha independente para análise | **Implementado / testes locais** | `vectorLayerPromotion.ts`; KML/KMZ/GeoJSON/SHP com `fileId`, vetores inicialmente invisíveis, seleção e export no workspace. | Executar o encadeamento completo com upload e DB/storage isolados. |
| Árvore temática IDE-Sisema; próprias/bases/resultados; WMS/WMTS/XYZ vs WFS | **Parcial** | Schema/catálogo OGC distinguem tipos. | Construir árvore temática e consumo de OGC no mapa; aplicar ordem/legenda. |
| Mapas técnicos/templates/PDF/PNG/vetor, escala/CRS/legenda/norte/grade | **Simulado/configuração** | UI e jobs preservados; raster local exporta PNG/PDF. | Worker cartográfico real, templates CRUD e geração comprovada. |
| Atlas multipágina, índice, sobreposição | **Simulado/configuração** | `atlasRouter` cria configuração/job. | Worker que componha páginas/índice e produza PDF/PNG real. |
| Raster/COG, reprojeção, NoData, bandas, tiles autorizados e export com pixels | **Testado localmente** | Pipeline GDAL, `localRasterService`, `rasterRouter`, ensaios COG/tiles/PNG/PDF e round-trip. | Catálogo real, quota/retenção e homologação worker+DB+OAuth. |
| Catálogo de ortofotos, fonte/data/resolução/licença/área/histórico e comparação temporal | **Parcial / pendente** | Ingestão recebe data e fonte; comparação local de fixtures existe. | Modelo/catalogação completa, co-registro e comparação temporal analítica com dados licenciados. |
| Não usar revisão `c824294` como prova | **Implementado como restrição** | Nenhuma alteração foi importada dela. | Fazer comparação de compatibilidade se houver pedido explícito de reaproveitamento. |
| Backup recuperável de banco/objetos, manifesto/hash/restore | **Testado localmente** | Store filesystem, archive/manifesto, round-trip, corrupção e COG válido restaurado/reaberto pelo GDAL. | Restore para MySQL descartável, retenção e storage privado operacional. |
| UI de backup com status real, ID/data/tamanho/hash/retenção | **Parcial** | Runtime expõe disponibilidade verdadeira e bloqueia modo não recuperável. | Persistir e exibir inventário/manifesto real e agendar retenção. |
| Autorização por projeto/perfil em APIs, tiles, jobs, downloads/storage | **Parcial reforçada** | Raster/tiles e análise já protegidos; membros/histórico/GIS legado passaram a usar helpers centrais. | Revisar jobs, downloads e substituir URL pública/write-only por storage privado com get/head/list e URL assinada/proxy. |
| Dois perfis autorizados com testes negativos | **Bloqueado por infraestrutura** | Há testes unitários de `projectAccess`. | OAuth de homologação, admin/editor membro e usuário não-membro, banco e storage próprios. |
| Docker: PostGIS, QGIS, Redis, worker e WMS | **Bloqueado por infraestrutura** | Compose, scripts e projeto QGIS existem. | Sandbox não tem Docker; rodar Docker Desktop/host isolado e testar GetCapabilities/GetMap. |
| Aceite completo projeto→upload→processamento→camada→sobreposição→resultado→export/reabertura | **Bloqueado por infraestrutura** | Todas as pontes de código foram avançadas; 37 testes locais passaram. | MySQL, storage privado, OAuth de testes, worker/GDAL e, para WMS, Docker/QGIS/PostGIS. |
| ZIP/hash/checkpoint, prévia e publicação reversível | **Implementado nesta cópia** | Commit isolado, ZIP e SHA-256 emitidos; prévias estáticas continuam separadas do portal autenticado. | Publicação somente após homologação E2E em infraestrutura própria. |

## Testes executados nesta rodada

Com ambiente sem banco e sem credenciais (`DATABASE_URL=''`, chaves Forge vazias):

```bash
pnpm vitest run \
  server/vectorLayerPromotion.test.ts server/gisAnalysis.test.ts \
  server/projectAccess.test.ts server/geodataService.test.ts \
  server/localRasterService.test.ts server/rasterIngestionAdapter.test.ts \
  server/backupManifest.test.ts server/backupArchive.test.ts \
  server/localFilesystemBackupStore.test.ts server/backupRuntime.test.ts
pnpm exec tsc --noEmit --pretty false
pnpm run build
git diff --check
```

**Resultado:** 11 arquivos de teste, **37 testes aprovados**; TypeScript aprovado; build Vite/esbuild aprovado; `git diff --check` aprovado. O build emite somente o aviso não bloqueante de bundle JavaScript maior que 500 kB.

A suíte total não é evidência de aceite: testes que exigem criação de projeto no MySQL falham corretamente quando o banco está deliberadamente ausente. A falha MFA histórica deve continuar classificada separadamente até haver OAuth de homologação.

## Dependências mínimas para a aplicação completa em ambiente isolado

1. **MySQL 8/TiDB descartável**, exclusivamente próprio, com migrations revisadas `0000`–`0009`. O portal usa Drizzle MySQL; o Compose GIS não o inclui.
2. **Storage privado recuperável** com `put/get/head/list`, chaves estáveis, versionamento/retenção e URLs assinadas ou proxy autorizado. O adaptador `manus-upload-file` atual é write-only e não é suficiente para backup/RBAC final.
3. **OAuth de homologação** configurado para URL local, `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, callback/cookies e três identidades de teste autorizadas (admin, editor membro, não-membro).
4. **Worker raster** com volume persistente, GDAL/Python e token servidor-servidor, via `ARQUEO_RASTER_WORKER_URL` + `ARQUEO_RASTER_WORKER_TOKEN` ou modo local isolado. Não expor diretório de tiles.
5. **Docker Desktop/host isolado** para PostGIS, QGIS Server, Redis e worker, com `.env.gis` próprio e volumes persistentes. Falta definir/adotar a ponte clara entre MySQL do portal e PostGIS/QGIS.
6. **Fontes de mapas aprovadas**: provedor autorizado para OSM/OpenTopo, termos/atribuição/limites; hosts OGC em allowlist; endpoints oficiais HTTPS com TLS válido. Não desabilitar TLS da FUNAI.
7. **Ambiente de recovery**: roots privados de origem/destino e MySQL descartável para restaurar contagens/manifestos/hashes, sem tocar produção.

## Publicação reversível — quando a homologação estiver aprovada

1. Criar backup recuperável verificado no ambiente de homologação.
2. Aplicar migrations primeiro no MySQL isolado e validar enum `geojson`.
3. Configurar storage privado e OAuth de homologação; rodar cenários de dois perfis.
4. Subir stack GIS em Docker e executar provas WMS/QGIS.
5. Executar o percurso E2E e registrar evidências/reabertura.
6. Somente então submeter o commit isolado para revisão. Publicação deve ocorrer por checkpoint novo, permitindo rollback ao checkpoint anterior. Não publicar diretamente desta cópia.
