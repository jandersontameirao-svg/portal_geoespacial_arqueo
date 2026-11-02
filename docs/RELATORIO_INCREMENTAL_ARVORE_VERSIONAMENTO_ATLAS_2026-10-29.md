# Relatório incremental isolado — árvore, versionamento, cache, Atlas e catálogo histórico

**Data:** 29/10/2026
**Escopo:** cópia isolada `portal_geoespacial_arqueo_isolated`; nenhuma alteração aplicada ao projeto principal, domínio publicado, banco, storage ou OAuth de produção.

## Estado por requisito implementável

| Requisito | Código/artefato | Estado | Evidência factual |
|---|---|---|---|
| Árvore temática `próprias/bases/resultados` | `client/src/components/ThematicLayerTree.tsx`, `ProjectGeoWorkspace.tsx` | Implementado | Visibilidade, seleção analítica independente, legenda e ordem por panes Leaflet; `ThematicLayerTree.test.ts` aprovado. |
| Ordem visual e consumo OGC publicado | `ProjectGeoWorkspace.tsx`, `server/ogcCatalogRouter.ts` | Implementado em código | A árvore só recebe OGC publicado; WMS é inserido em pane ordenado. Integração autenticada ainda depende de banco/OAuth local. |
| Canvas responsivo de mapa | `ProjectDetail.tsx`, `ProjectGeoWorkspace.tsx` | Implementado em código | Aba de mapa usa altura disponível, `ResizeObserver` e `invalidateSize`; build aprovado. A prévia sem login é visual, não homologação autenticada. |
| Versões de arquivo e checksum | `server/fileVersioning.ts`, `filesRouter.ts`, `FileList.tsx`, migration `0010_lethal_expediter.sql` | Implementado, migration pendente | Upload cria `file_versions` v1 imutável com SHA-256 do scanner. Teste de construção e validação de hash aprovado. |
| Cache antigo/backoff/status real | `server/baseLayerCachePolicy.ts`, `baseLayersRouter.ts`, `BaseLayers.tsx`, migration `0011_abandoned_wraith.sql` | Implementado, migration pendente | Estados `fresh`, `stale`, `refreshing`, `backoff`; falha mantém referência ao cache anterior e calcula retentativa exponencial. 3 testes aprovados. |
| Templates Atlas CRUD | `drizzle/schema.ts`, `server/atlasRouter.ts`, `client/src/pages/Atlas.tsx`, migration `0012_curved_justice.sql` | Implementado, migration pendente | Listar/criar/editar/padrão/excluir por projeto, com RBAC e auditoria. O job congela a configuração no `renderConfig`. |
| Worker cartográfico/Atlas real | `infra/worker/index.js`, `infra/raster/render_atlas_pages.py`, `server/atlasRenderAdapter.ts` | Testado localmente | COG sintético válido → PDF A4 multipágina (2 páginas), pixels GDAL reais, SHA-256 de entrada/saída. Worker aceita somente IDs/bounds e COG no volume autorizado. |
| Integração do job Atlas | `server/atlasRouter.ts`, `client/src/pages/Atlas.tsx` | Implementado, bloqueio explícito quando sem worker | Só conclui após worker retornar PDF com hash válido e `storagePut` concluir. Sem `ARQUEO_CARTOGRAPHY_WORKER_URL`, retorna pré-condição, não sucesso simulado. |
| Catálogo histórico de imagens/ortofotos | `server/historicalImageryCatalog.ts`, `rasterRouter.ts`, `ProjectGeoWorkspace.tsx` | Implementado em código | Indexa somente COGs concluídos com data de aquisição e hash, ordenado temporalmente; o catálogo ativa/oculta cenas via atualização de visibilidade auditada. |
| Inventário de backup | `server/backupTableRegistry.ts`, `backupManifest.test.ts` | Implementado e testado | Inclui `atlas_templates`; cobertura sobe de 18 para **19 tabelas**. |

## Prova preservada de Atlas real

A evidência usa **apenas raster sintético local**, não imagem/ortofoto de produção:

- COG de entrada: `input/synthetic_before_epsg4674.cog.tif`, EPSG:4674, com pirâmides e NoData verificados pelo ensaio de raster.
- PDF real: `atlas_sintetico_2_paginas.pdf` — 492.820 bytes, duas páginas A4 paisagem.
- Hash do PDF: `a655464b116a3027fbfb93f2f9fabefee283aa801b9addbc0e628d42d1046b4c`.
- Hash do COG: `7de383d180b4ff57ff5ae3696a03302c8e3c7148406ec6a4a086343e361a7d8e`.
- `pdfinfo` confirma `Pages: 2` e página A4 paisagem.

A pasta de evidência contém requisição, saúde antes/depois, relatório da fixture, resposta sem PDF em Base64 e `SHA256SUMS.txt`.

## Validação final desta etapa

Executada sem banco, OAuth, storage ou publicação:

- **15 arquivos de teste / 40 testes aprovados**;
- `pnpm exec tsc --noEmit` aprovado;
- `pnpm run build` aprovado;
- `node --check infra/worker/index.js` aprovado;
- `render_atlas_pages.py --help` aprovado;
- `git diff --check` aprovado.

O build mantém um aviso não bloqueante do Vite: bundle principal acima de 500 kB após minificação. Não foi aplicado code splitting nesta etapa para não refatorar navegação ou componentes existentes.

## Migrations revisadas, não aplicadas

| Arquivo | Conteúdo | Aplicada? |
|---|---|---|
| `drizzle/0010_lethal_expediter.sql` | adiciona `sha256`, `mimeType`, `metadata` em `file_versions` | Não |
| `drizzle/0011_abandoned_wraith.sql` | adiciona contador/tentativa/backoff em `base_layers` | Não |
| `drizzle/0012_curved_justice.sql` | cria `atlas_templates`; adiciona `templateId` e `renderConfig` em `atlas_jobs` | Não |

Todas são estritamente aditivas: não há `DROP`, exclusão nem alteração destrutiva.

## Dependências mínimas ainda necessárias para homologar a aplicação completa isolada

1. **MySQL/TiDB descartável** com `DATABASE_URL`, para aplicar as três migrations e comprovar CRUD, arquivo→versão, cache e Atlas ponta a ponta.
2. **OAuth Manus de ambiente isolado** ou conta de teste autorizada, para validar os fluxos protegidos no navegador sem desativar autenticação/RBAC.
3. **Worker GIS acessível ao backend** no mesmo host/rede, com `ARQUEO_CARTOGRAPHY_WORKER_URL`, token, `RASTER_WORKER_ROOT` persistente e COG já processado.
4. **Storage compatível de homologação** para concluir a última etapa do job Atlas (`storagePut`) e recuperar a URL do PDF. A abstração recuperável filesystem já existe para cenário on-premise; o storage Manus atual não expõe get/head/list por chave.
5. **Docker Compose real** para validar QGIS/PostGIS/Redis e WMS; isso continua separado do presente ensaio de worker raster.

## Itens explicitamente não declarados como concluídos

- Homologação autenticada de UI contra banco real;
- Aplicação das migrations em qualquer banco;
- Publicação, deploy ou mudança de domínio;
- Restauração remota de storage Manus;
- WMS/QGIS de produção e catálogo oficial com dados reais;
- Exportação A1/A0 pelo worker local atual (o renderizador declara suporte A4/A3 e bloqueia A1/A0 de modo explícito).
