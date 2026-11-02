# Matriz de cobertura — 112 testes e pendências visuais

**Execução de referência literal:** commit funcional `5fa06ac2f2fd544c541fc3f02969b9fd551ee1b3`
**Evidência:** `docs/consolidation/evidence/synthetic-db-run-7-5fa/vitest.log`
**Resultado:** 31 arquivos / 112 testes aprovados em MySQL 8 local descartável; não equivale a homologação funcional em browser.

## Resumo mensurável

| Classe | Arquivos | Testes | O que prova | O que não prova |
|---|---:|---:|---|---|
| Persistência MySQL sintética real | 4 | 33 | Routers reais, esquema migrado e gravação/leitura no MySQL `geoportal_synthetic`. | Produção, TiDB, OAuth real, storage gerenciado ou UI browser. |
| Persistência local de filesystem | 4 | 11 | Arquivos/binários temporários, COG/GeoTIFF, hash, restauração e corrupção local. | Bucket/storage remoto ou telas de upload/download. |
| Testes puros, mocks ou loopback local | 23 | 68 | Regras, contratos, normalização, segurança unitária, GeoJSON, HTTP local e algoritmos. | Persistência DB/storage e comportamento visual. |
| **Total** | **31** | **112** | Regressão automatizada do código local. | Homologação integral ou aceite visual. |

## Arquivo a arquivo

| Arquivo | Testes | Cobertura principal | Classe |
|---|---:|---|---|
| `server/ogcCatalogService.test.ts` | 3 | Normalização/segurança de endpoint, Capabilities, redirect, DTD e fallback. | HTTP loopback/local, sem DB. |
| `server/backupArchive.test.ts` | 5 | Arquivo/restauração local, deduplicação, blob ausente, corrupção e purge. | Filesystem temporário real. |
| `server/backupManifest.test.ts` | 3 | Manifesto, checksum e restauração isolada em memória. | Puro/memória. |
| `server/wfsImportService.test.ts` | 4 | WFS paginado, BBOX, limite e Content-Type. | Mock de fetch. |
| `server/gisAnalysis.test.ts` | 5 | Buffer, interseção, união, área e malha. | Puro/GeoJSON. |
| `server/localFilesystemBackupStore.test.ts` | 4 | Hash, idempotência, conflito, path traversal e corrupção. | Filesystem temporário real. |
| `server/atlas.test.ts` | 4 | Grid Atlas A3/A4, orientação, escala e bounds. | Puro/mocks. |
| `server/geometries.test.ts` | 6 | Criar projeto, importar/listar/exportar geometria; negar projeto/lote inválidos. | **MySQL sintético real.** |
| `server/projects.test.ts` | 17 | CRUD de projetos, membros, convite, papéis e auditoria. | **MySQL sintético real.** |
| `server/vectorLayerPromotion.test.ts` | 3 | KML/KMZ para GeoJSON e promoção vetorial. | Bytes em memória. |
| `server/localRasterService.test.ts` | 3 | Caminho/tile raster, URL/traversal e limites de exportação. | Puro. |
| `server/notifications.test.ts` | 5 | Criar/listar/contar/marcar/apagar notificações e autenticação. | **MySQL sintético real.** |
| `server/ogcCatalogRouter.synthetic.test.ts` | 5 | Persistir OGC 500/501/1000, rejeitar 1001 e deduplicar URL normalizada. | **MySQL sintético real.** |
| `server/mfa.test.ts` | 4 | Setup, QR, obrigatoriedade admin, códigos de backup e bloqueio de desativação. | Contexto/mocks; sem TOTP/browser real. |
| `server/backupRuntime.test.ts` | 3 | Regras de runtime e raízes locais de backup. | Puro/env sintético. |
| `server/ogcEndpointIdentity.test.ts` | 6 | Limite 1000, SHA-256 e classificação duplicata/colisão. | Puro. |
| `server/backupInventoryPolicy.test.ts` | 3 | Retenção UTC e completude de inventário. | Puro. |
| `server/backup.test.ts` | 3 | Bloqueios de criação/configuração remota e papel admin. | Puro/mocks. |
| `server/auth.logout.test.ts` | 1 | Contrato de limpeza de cookie de sessão. | Mock `res.clearCookie`. |
| `server/baseLayerCachePolicy.test.ts` | 3 | Fresh/stale/backoff e limite de retry. | Puro. |
| `server/projectAccess.test.ts` | 4 | Permissões admin, membro, editor e cliente. | Mock do DB. |
| `server/atlasVectorOverlay.test.ts` | 2 | Vetores, estilos, legenda e teto de feições de Atlas. | Fixtures em memória. |
| `server/geodataService.test.ts` | 3 | FeatureCollections Shapefile e rejeição de ZIP sem feições. | Fixtures em memória. |
| `client/src/lib/basemaps.test.ts` | 2 | Catálogo e restrições de mapas-base. | Constantes, sem renderização. |
| `server/historicalImageryCatalog.test.ts` | 1 | Ordem temporal de COG e exclusão de ingestão incompleta. | Fixtures em memória. |
| `server/fileVersioning.test.ts` | 2 | Versão inicial e SHA-256 inválido. | Puro. |
| `server/rasterLayerMetadata.test.ts` | 1 | Metadados raster/COG e comparação temporal. | Fixtures em memória. |
| `server/rasterIngestionAdapter.test.ts` | 3 | Contrato de adaptador local/worker e raízes inválidas. | Env sintético. |
| `client/src/components/ThematicLayerTree.test.ts` | 2 | Ordem para cima/baixo da árvore temática. | Função pura, sem DOM. |
| `server/rasterCogBackupRoundtrip.test.ts` | 1 | COG válido, backup/restauração de bytes e reabertura GDAL. | Filesystem temporário real. |
| `server/rasterIngestionLocal.test.ts` | 1 | GeoTIFF→COG EPSG:4674, tiles e hashes. | Filesystem temporário real. |

## O que os 33 testes MySQL realmente cobrem

1. **Projetos — 17 testes:** criação, leitura/listagem, atualização, membros, convites, controle de papel e auditoria via routers reais.
2. **Geometrias — 6 testes:** persistência de marcador/linha/polígono, importação, listagem, exportação e rejeições de segurança/validação.
3. **Notificações — 5 testes:** criação, listagem autenticada, contagem, marcação e limpeza persistidas.
4. **Catálogo OGC — 5 testes:** armazenamento completo de endpoints de 500/501/1000 caracteres, limite de 1001 e identidade por URL normalizada.

## Fluxos visuais e E2E ainda ausentes

Nenhuma configuração de Playwright, Cypress, Puppeteer, WebDriver, Selenium, DOM/jsdom ou navegador autenticado integra a execução de 112 testes. Ainda faltam, em ambiente totalmente isolado:

1. Login OAuth/callback, cookie/sessão/logout e MFA por navegador.
2. Abertura da aplicação completa; navegação Projetos, Mapas, Atlas, Arquivos e Administração.
3. Globo 2D/3D, mapas-base e carregamento visual real de tiles.
4. Árvore temática renderizada: clique, teclado, ordenação, drag-and-drop, legenda e persistência/reload.
5. Leaflet Draw e MeasurementTools integrados em UI, com salvar/recarregar/excluir autorizado.
6. Upload em browser de KML/KMZ/SHP/GeoJSON/GeoTIFF, progresso, processamento e visualização de vetores/raster/COG.
7. Catálogo OGC/WMS/WFS em UI: cadastro, probe, seleção, WMS visual e WFS importado/autorizado.
8. Before/after raster, exportação PNG/PDF e Atlas multipágina renderizados/baixados por UI.
9. Backup/restauração e inventário expostos em tela, sem conectar storage de produção.
10. Capturas desktop/tablet/celular e observação de console/browser para regressão visual.

## Limites de evidência

- O run literal usa somente MySQL 8 local em loopback e fixtures sintéticas; o relatório marca `productionTouched=false`, `homologationTouched=false` e `storageRemoteTouched=false`.
- Os 112 são casos Vitest aprovados; não são cobertura de linhas/branches/requisitos nem certificação de interface.
- A compatibilidade do MySQL local não substitui validação futura no TiDB do ambiente isolado.
- Esta matriz não autoriza DDL, deploy, publicação, alteração de segredo/configuração ou dispensa dos 11 objetos.
