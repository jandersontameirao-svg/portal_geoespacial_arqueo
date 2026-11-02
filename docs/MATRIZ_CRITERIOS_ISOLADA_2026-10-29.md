# Matriz de critérios — desenvolvimento isolado

**Branch:** `desenvolvimento/auditoria-20261029`
**Base inicial:** `04e64773`
**Escopo desta continuação:** desenvolvimento isolado, sem publicação, sem aplicação ao projeto principal, sem consulta/escrita em banco, storage, OAuth ou dados de produção.

| Critério solicitado | Código/arquivo entregue | Teste e evidência | Situação e pendência objetiva |
|---|---|---|---|
| Preservar trabalho principal e avançar isoladamente | Worktree `/home/ubuntu/portal_geoespacial_arqueo_isolated`; commits isolados | `git diff` do projeto principal contra HEAD não contém código nesta execução; dados de produção não foram acessados | **Concluído no isolamento.** Aplicação no principal permanece deliberadamente não executada. |
| GeoTIFF → COG | `infra/raster/process_to_cog.py` | Ensaio local sintético executado com GDAL 3.8.4 | **Concluído para pipeline local.** Integração de upload/worker de produção aguarda runtime com GDAL e storage recuperável. |
| Reprojeção SIRGAS 2000 | `gdalwarp -t_srs EPSG:4674` no processador | COG de evidência abre com EPSG:4674 | **Concluído para fixture.** Para análise métrica, usar também grade UTM adequada à AOI; EPSG:4674 é geográfico. |
| NoData e máscara | Processador recebe `--nodata`, registra bandas em manifesto STAC-like | Três bandas com `NoData=0.0` verificadas por `gdalinfo` | **Concluído para fixture.** Em raster real, o NoData deve vir do fornecedor; `0` não pode ser imposto cegamente a ortofoto RGB. |
| Pirâmides/overviews internos | Driver `COG` com `OVERVIEWS=IGNORE_EXISTING`, bloco 512 e DEFLATE | 2 overviews internos por banda no COG sintético | **Concluído para fixture.** Validação formal `gdal driver cog validate` requer GDAL >= 3.13; sandbox tem 3.8.4. |
| Metadados/proveniência/checksum | Manifesto STAC-like `.stac-item.json`, SHA-256, fonte, data, CRS, resampling, NoData | Manifesto gerado junto a cada COG do ensaio | **Concluído para pipeline local.** Registrar a URL final exige storage que preserve chave e permita leitura/HEAD. |
| Comparação temporal | `infra/raster/compare_temporal.py` | Duas cenas sintéticas geraram máscara COG; 253.074 pixels, 6,189049% e delta médio 5,030621 | **Concluído como diferença RGB de referência.** Não é detector arqueológico; exige co-registro, normalização radiométrica, máscara de nuvem/sombra e revisão humana para uso técnico. |
| Integração com mapas/Atlas | `server/rasterLayerMetadata.ts`; `server/printJobsRouter.ts`; `server/atlasRouter.ts` | `server/rasterLayerMetadata.test.ts` aprovado | **Concluído para composição de metadados.** COG não é renderizado diretamente pelo Leaflet; requer tile/proxy com HTTP Range/CORS ou QGIS/GeoServer para visualização no navegador. |
| Catálogo administrativo WMS/WFS | `drizzle/schema.ts`, `drizzle/0007_lonely_freak.sql`, `server/ogcCatalogRouter.ts`, `client/src/pages/OgcCatalog.tsx` | Migração somente CREATE TABLE, sem operação destrutiva; TypeScript/build aprovados | **Implementado em código/migração isolada.** Não aplicado ao banco. Para uso real, aplicar migração em homologação e configurar `OGC_ALLOWED_HOSTS`. |
| Health GetCapabilities | `server/ogcCatalogService.ts` e procedure `ogcCatalog.validate` | Mock HTTP local: WMS válido saudável, redirect rejeitado e corpo >2 MiB recusado | **Concluído no teste local.** Não houve health em fontes reais pelo catálogo; ICMBio foi verificado anteriormente por GET somente leitura. |
| Allowlist/SSRF/TLS | `normalizeOgcEndpoint`, `probeOgcCapabilities` | Rejeita HTTP em produção, query/fragmento/userinfo, IP literal, loopback fora de teste, host fora da allowlist; `redirect: "error"`; TLS não foi relaxado | **Concluído no núcleo local.** Defesa completa contra DNS rebinding requer egress firewall e resolver/controlador de conexão no ambiente de produção. |
| Fallback explícito | `selectOgcVariant` e `ogc_catalog_variants` | Teste seleciona fallback saudável e retorna razão `tls_error` da primária | **Concluído no núcleo e schema.** Configuração de variantes exige banco/migração de homologação. Não há troca automática silenciosa. |
| Preservar TLS da FUNAI | `docs/FONTES_GIS_E_LICENCAS.md` e OGC client estrito | Nenhuma flag `-k`, `rejectUnauthorized: false` ou downgrade TLS foi adicionada | **Concluído.** Fonte permanece em estado degradado até cadeia regularizada ou substituição oficial aprovada. |
| Backup cobrindo esquema | `server/backupTableRegistry.ts`, `server/backupRouter.ts` | Registro contém 18 tabelas, incluindo `audit_logs` correto, `base_layers`, catálogo OGC, `styles`, `gis_uploads` e `notifications` | **Corrigido em código.** Snapshot integrado MySQL/TiDB não foi executado porque banco produtivo foi deliberadamente bloqueado. |
| Manifesto e hash de backup | `server/backupManifest.ts` | Fixture valida hashes por tabela e hash global; adulteração bloqueia restauração | **Concluído em ensaio local.** SHA-256 detecta corrupção; autenticidade/criptografia requerem bucket privado/KMS futuros. |
| Inventário de objetos | `inventoryObjectReferences()` | Fixture local encontrou 7 referências: arquivos, versões, camada-base, upload GIS, impressão, atlas e páginas | **Concluído no manifesto.** Storage atual não fornece `get/head/list` com chave estável, portanto blobs remotos ainda não são recuperáveis. |
| Ensaio de restauração | `infra/scripts/backup_local_rehearsal.ts`, `restoreToIsolatedMemory()` | Passou: 16 tabelas, 14 linhas sintéticas, 7 objetos referenciados, 1 projeto restaurado em memória, 0 conexões de produção | **Concluído como ensaio seguro em memória.** Restore para MySQL descartável bloqueado pela indisponibilidade de Docker no sandbox; alternativa é Docker Desktop local ou VM com Docker. |
| Compatibilidade react-leaflet-draw | `client/src/components/LeafletDrawControl.tsx`; `GlobeViewer.tsx`; `ProjectGeoWorkspace.tsx`; remoção de `react-leaflet-draw` | Build final sem `default is not exported by leaflet-draw`; busca não encontra `react-leaflet-draw` | **Concluído em compilação.** Smoke autenticado de criação/edição/exclusão continua bloqueado por OAuth/plataforma não utilizada. |
| Malhas e operações mensuráveis | `server/gisAnalysis.ts`, `ProjectGeoWorkspace.tsx` (commit anterior) | 5 testes: buffer, interseção, união, área, malha rotacionada; total da suíte GIS incluído abaixo | **Concluído localmente.** Persistência contra banco e UI autenticada não foram executadas. |
| Docker/QGIS/PostGIS/WMS local | `docker-compose.gis.yml`, scripts Sprint A existentes | `docker` não existe no sandbox; nenhum compose foi executado | **Bloqueado por infraestrutura ausente.** Operação faltante: runtime Docker. Alternativa: Docker Desktop local do usuário, com scripts de bootstrap existentes, ou ambiente com Docker. |

## Evidências quantitativas do ensaio raster

O ensaio usou somente duas imagens RGB sintéticas de 2048×2048 pixels, geradas localmente. Os COGs resultantes têm layout `COG`, compressão DEFLATE, bloco 512 px, EPSG:4674, NoData `0` e duas pirâmides internas por banda. A comparação temporal detectou 253.074 pixels modificados em 4.089.061 pixels válidos, isto é **6,189049%**, com delta absoluto RGB médio de **5,030621**.

Os arquivos de evidência ficaram em diretório temporário do sandbox e não foram incorporados ao Git por serem artefatos descartáveis: `/tmp/arqueo-raster-evidence-1793295927`.

## Evidência do ensaio de backup

O ensaio local produz artefato sintético com 18 tabelas, 14 linhas e sete referências de objetos. A restauração ocorre apenas em memória no modo obrigatório `local-rehearsal`; o processo informa **zero conexões de produção**.

## Validação de código desta etapa

- Vitest: **19 testes aprovados** em seis arquivos: análise GIS, autorização por projeto, normalização Shapefile, manifesto de backup, catálogo OGC e metadados raster.
- `pnpm exec tsc --noEmit`: sem diagnóstico.
- `pnpm run build`: concluído.
- Busca por `react-leaflet-draw`: nenhuma ocorrência no código/dependências.
- Migração `0007_lonely_freak.sql`: somente `CREATE TABLE` e índices; não contém `DROP`, `DELETE`, `TRUNCATE` ou alteração destrutiva.

## Fontes técnicas

- GDAL COG: https://gdal.org/en/stable/drivers/raster/cog.html
- OGC Cloud Optimized GeoTIFF 1.0: https://docs.ogc.org/is/21-026/21-026.html
- QGIS Server WFS: https://docs.qgis.org/latest/en/docs/server_manual/services/wfs.html
- Política de tiles OSM: https://operations.osmfoundation.org/policies/tiles/
