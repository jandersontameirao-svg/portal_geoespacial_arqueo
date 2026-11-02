# Matriz de execução isolada — raster renderizado, backup físico e laboratório Draw

**Branch:** `desenvolvimento/auditoria-20261029`
**Base:** checkpoint `04e64773` + commit isolado anterior `05733863711f`
**Escopo:** código e ensaios exclusivamente locais, sem publicação, migração aplicada, banco, OAuth, storage remoto ou dados de produção.

## Critérios objetivos desta continuação

| Critério | Implementação entregue | Evidência executada | Estado |
|---|---|---|---|
| Tiles raster reais no mapa | `infra/raster/build_local_raster_assets.py`, `server/localRasterService.ts`, `server/rasterAssetRoutes.ts`, `server/rasterRouter.ts`, `ProjectGeoWorkspace.tsx` | COGs sintéticos EPSG:4674 geraram 234 PNGs XYZ antes e 234 depois; 29 tiles tiveram SHA-256 de bytes diferente | **Concluído no ensaio local.** A rota é same-origin, autenticada e verifica acesso ao projeto em cada tile. |
| Sem proxy aberto/SSRF/path livre | `validateRelativeRasterKey`, `resolveLocalRasterPath`, `descriptorFromLayer`, `validateTileCoordinates` | `server/localRasterService.test.ts`: URLs, `..`, paths absolutos e barras Windows rejeitados; z/x/y e limites de exportação testados | **Concluído em código/teste.** A rota não aceita `url`, `path`, bucket/key ou comando do cliente. |
| CRS/NoData/limites | Scripts GDAL e `localRasterService.ts` | Fonte COG exige `EPSG:4674`, NoData por banda, COG e overviews; exportação limitada a 256–8192 px e 33.554.432 pixels | **Concluído para dados locais autorizados.** NoData de fonte real deve ser validado na ingestão. |
| Comparação antes/depois | Alternância por checkbox/opacidade em `ProjectGeoWorkspace.tsx` | Ensaio comparou tiles das duas cenas e encontrou 29 checksums diferentes | **Concluído para visualização local.** Não é classificação arqueológica automática. |
| PNG georreferenciado com pixels reais | `infra/raster/export_raster_map.py`, `RasterRealPixelExport.tsx` | PNG `1024×1024`, assinatura PNG válida, `map.wld`, `map.prj` e SHA-256 por artefato | **Concluído em ensaio local.** O PNG não é placeholder/metadado. |
| PDF com pixels reais | mesmo exportador + componentes de Projeto, Mapas Técnicos e Atlas | PDF de uma página criado pelo GDAL a partir do COG recortado, hash SHA-256 registrado | **Concluído em ensaio local.** É PDF raster; não afirmar GeoPDF. |
| Integração no portal | `ProjectGeoWorkspace.tsx`, `RasterRealPixelExport.tsx`, `TechnicalMaps.tsx`, `Atlas.tsx` | TypeScript/build aprovados; rotas protegidas expostas somente por template same-origin | **Implementado na cópia isolada.** Para operar com projeto real, a camada deve ter descriptor local aprovado e a raiz raster configurada. |
| Backup de bytes recuperável | `backupStore.ts`, `localFilesystemBackupStore.ts`, `backupArchive.ts` | Round-trip local: 18 tabelas, 11 linhas, 7 referências/7 blobs distintos copiados e restaurados, 0 conexões de produção | **Concluído localmente.** A cópia não usa URL pública nem `storage.ts`. |
| Hashes, idempotência e corrupção | `localFilesystemBackupStore.test.ts`, `backupArchive.test.ts` | 11 testes: bytes binários, SHA-256 recalculado, idempotência, conflito, traversal, blob/artifact/manifest corrompidos e backup incompleto | **Concluído no armazenamento local.** SHA-256 detecta corrupção acidental; assinatura/KMS é melhoria futura. |
| Disponibilidade contextual do backup | `backupRuntime.ts`, `backupRouter.ts`, `backup.test.ts`, `backupRuntime.test.ts` | Em `ARQUEO_EXECUTION_MODE=isolated-rehearsal` ou sem adaptador, `backup.create`/agendamento retornam `PRECONDITION_FAILED`; com filesystem origem+destino configurados, o fluxo recuperável é habilitado | **Concluído.** É proteção explícita de ensaio/configuração ausente, não remoção permanente do contrato do produto. |
| Laboratório Leaflet Draw sem OAuth | `client/draw-lab.html`, `draw-lab.tsx`, `LeafletDrawLab.tsx`, `vite.config.ts` | Navegação anônima; toolbar carregou; marcador elevou contador de 0→1; botão Limpar retornou 1→0 | **Concluído e visualmente testado.** Não monta App/Header/tRPC/GuidedTour nem faz escrita. |

## Evidência quantitativa preservada no log da execução

O ensaio `pnpm run rehearse:raster-local` executou sobre imagens sintéticas e declarou:

```json
{
  "crs": "EPSG:4674",
  "nodata": 0,
  "beforeTiles": 234,
  "afterTiles": 234,
  "changedTileChecksums": 29,
  "pngSize": [1024, 1024],
  "pdfPages": 1,
  "productionConnections": 0
}
```

Checksums dos artefatos de exportação raster dessa execução:

- PNG: `294c57d93b5afb9c6b971c4955035a8a02d7b07159957ba840a0bc6640011ad3`
- Worldfile: `568f02d8aaabe6ef4c34f6f7f46a7d228f6ff98aaa4cd18917d40bb727ddeeb0`
- PRJ: `dac5a12c8d3c526acd322b9ecf894036e9aa0367dee23d172439bab0820b9118`
- PDF: `0a4797a7d56d1df905a6ced972d935a7672d05c7ea9525aa8050a1df9e28377e`

O ensaio `pnpm run rehearse:backup-local` executou com `remoteIntegration: "blocked"`, 18 tabelas, 7 objetos físicos copiados/restaurados e `productionConnections: 0`.

## TODOs ainda implementáveis no isolamento

| Prioridade | Item | Próxima implementação possível sem produção |
|---|---|---|
| Alta | Ingestão raster confiável | Criar fluxo editor-only que aceite somente arquivo já associado ao projeto, gere COG/tiles sob `ARQUEO_LOCAL_RASTER_ROOT` e persista o descriptor em `layers.metadata.localRaster`. Não aceitar path/URL do navegador. |
| Alta | Persistência de exportações | Registrar IDs, bounds, CRS, hashes e configuração de camada nos jobs de impressão/Atlas após existir um volume raster e banco de homologação descartável. |
| Média | Corte comparativo | Acrescentar máscara/split slider Leaflet sobre duas TileLayers, preservando a atual alternância/opacidade já funcional. |
| Média | Smoke autenticado | Executar com usuários administrador/editor/cliente em banco de homologação: tile permitido, tile de projeto cruzado negado e exportação negada a usuário sem vínculo. |
| Média | Retenção local | Configurar política de limpeza dos exports temporários e quota de disco por projeto no worker/host local. |
| Média | Restore MySQL descartável | Executar restore completo do artifact tabular e dos objetos em MySQL local descartável, nunca em banco de produção. |
| Baixa | Assinatura do manifesto | Incluir HMAC/KMS quando existir gerenciador de chave privado; SHA-256 atual detecta corrupção, mas não autentica alteração maliciosa. |

## Dependências externas reais, mantidas bloqueadas

| Dependência | Motivo do bloqueio | Operação necessária para avançar |
|---|---|---|
| Storage Manus atual | `storage.ts` usa `manus-upload-file`; não oferece `get/head/list` privado por chave estável | Fornecer adaptador de storage privado compatível com `BackupStore` (put/get/head/list), versão/retensão e credenciais de servidor. No ensaio e sem configuração, o backup fica indisponível; em on-premise, o adaptador filesystem pode ser habilitado com o template `infra/backup/.env.backup.recoverable.example`. |
| Volume persistente raster | Preview/sandbox não é volume operacional compartilhado para processo e worker | Disponibilizar volume local/on-premise ou host com filesystem persistente e definir `ARQUEO_LOCAL_RASTER_ROOT` absoluto, não servido estaticamente. |
| Runtime GDAL no destino | A geração requer `gdal2tiles.py`, bindings Python GDAL e driver PDF/PNG | Instalar/validar GDAL no host de homologação ou imagem de worker. Não foi instalado em produção. |
| Banco de homologação | Nenhuma migração foi aplicada nesta etapa | Preparar banco descartável e aplicar mudanças somente após revisão/aprovação do candidato isolado. |
| OAuth de homologação | Laboratório Draw deliberadamente não usa OAuth; tiles reais exigem sessão | Executar smoke test autenticado sem enfraquecer `protectedProcedure`, `requireProjectAccess` ou `requireProjectEditor`. |
| Docker/QGIS/PostGIS da Sprint A | Docker não existe neste sandbox | Rodar bootstrap no Docker Desktop/on-premise e registrar GetCapabilities/GetMap reais. |

## Comandos locais de verificação

```bash
pnpm run test:backup-local
pnpm vitest run server/localRasterService.test.ts
pnpm run rehearse:backup-local
pnpm run rehearse:raster-local
pnpm exec tsc --noEmit
pnpm run build
```

Nenhum desses comandos consulta banco, OAuth, storage remoto ou dados de produção quando executado conforme os scripts de ensaio.

## Resultado da suíte completa nesta máquina

Foi executado `pnpm test`. Os testes adicionados/afetados nesta etapa passaram (**36 testes direcionados**: 17 de backup e 19 de raster, análise, autorização, geodados, OGC e metadados). A suíte completa não fechou por um teste anterior de MFA: `server/mfa.test.ts > deve gerar QR code para configurar MFA` retornou `Database not available` em `server/mfaRouter.ts:33`, porque esta cópia isolada foi executada com `DATABASE_URL=''` para impedir acesso a banco de produção. Não houve falha de raster, backup físico ou Leaflet Draw nessa execução.

A classificação foi confirmada contra a base `04e64773`: não há diff em `server/mfaRouter.ts`, `server/mfa.test.ts` ou `server/_core/context.ts` entre a base e a cópia isolada. O mesmo comando sem `DATABASE_URL` executado no projeto-base falhou no mesmo teste, mesma mensagem e mesma linha `server/mfaRouter.ts:33`. A autenticação não foi enfraquecida para fazê-lo passar; o teste requer banco descartável configurado.


## Atualização 2026-10-29 — ícones Leaflet, ingestão raster e COG restaurável

Esta seção **substitui somente o estado dos itens que estavam listados como próximos passos**. As seções anteriores foram preservadas como histórico de execução.

| Requisito | Código/arquivo | Teste ou evidência concreta | Estado atual |
|---|---|---|---|
| Ícone e sombra Leaflet no build | `client/src/lib/leafletDefaultMarker.ts`, `main.tsx`, `LeafletDrawLab.tsx` | Build Vite aprovado; laboratório recriado, marcador inserido e screenshot mostra ícone azul e sombra normais em `leaflet/draw_lab_marker_icon_fixed.webp` | **Concluído.** A configuração é global no Portal e importada na entrada independente do laboratório. |
| Laboratório Draw | `client/draw-lab.html`, `draw-lab.tsx`, `LeafletDrawLab.tsx`, `LeafletDrawControl.tsx` | Marcador criado no laboratório: contador `0 → 1`; o elemento é uma imagem Leaflet válida, não o texto quebrado “Mark” | **Concluído para desenho em memória.** Deliberadamente não comprova persistência do Portal. |
| Upload integrado de GeoTIFF | `FileUpload.tsx`, `RasterIngestionPanel.tsx`, `ProjectGeoWorkspace.tsx` | UI encaminha apenas MIME GeoTIFF aceito ao namespace `raster.ingestGeoTiff`; outros formatos mantêm o fluxo `files.upload` existente | **Implementado.** Requer ambiente com worker/volume configurado para ser acionado por usuário autenticado. |
| Autorização e auditoria de ingestão | `rasterRouter.ts`, `projectAccess.ts`, `db.ts` | `requireProjectEditor` antes da escrita; a camada é criada invisível e só é publicada após COG/tiles; erro fica auditado como `raster.ingest_failed` | **Concluído em código.** Não foi executado contra OAuth/banco real para não alterar produção. |
| Adapter configurável, sem path/URL do cliente | `rasterIngestionAdapter.ts`, `localRasterService.ts` | `rasterIngestionAdapter.test.ts`: sem configuração fica indisponível; `direct-local` exige raiz absoluta; worker aceita URL somente do ambiente do servidor | **Concluído.** O navegador manda bytes e metadados, nunca path, URL, comando GDAL ou credencial. |
| Worker Docker com GDAL | `infra/worker/Dockerfile`, `infra/worker/index.js`, `docker-compose.gis.yml`, `.env.gis.example` | Ensaio HTTP em volume temporário: token ausente → HTTP 401; com token → COG EPSG:4674, 16 tiles PNG e `gdalinfo` com `LAYOUT=COG` | **Concluído localmente sem Docker.** Compose ainda requer validação no Docker Desktop porque o sandbox não possui Docker. |
| GeoTIFF → COG → tiles | `process_to_cog.py`, `build_local_raster_assets.py`, `localRasterService.ts` | `rasterIngestionLocal.test.ts` aprovou GeoTIFF sintético válido, COG EPSG:4674, NoData 0, overviews e tiles | **Concluído no volume descartável.** |
| Backup físico de COG válido | `backupStore.ts`, `localFilesystemBackupStore.ts`, `backupArchive.ts`, `real_cog_backup_rehearsal.ts` | COG de **377.166 bytes** copiado ao archive, restaurado com mesmo SHA-256 `7de383d180b4ff57ff5ae3696a03302c8e3c7148406ec6a4a086343e361a7d8e`, reaberto pelo GDAL como COG de 3 bandas, NoData 0 | **Concluído no ensaio local.** Evidências em `valid_cog_backup/`; não usar os arquivos antigos de 49 bytes como prova. |
| Migração do tipo de arquivo GeoTIFF | `drizzle/0008_early_pyro.sql` | SQL revisado: somente `ALTER TABLE files MODIFY COLUMN fileType ... 'geotiff'`; não há DROP ou migração aplicada | **Gerada e não aplicada.** Banco de homologação descartável é o próximo ambiente válido. |

### Evidências independentes desta atualização

- `valid_cog_backup/VALID_COG_BACKUP_RESTORE_REPORT.json`: declara que a fonte é GeoTIFF sintético válido de 587.179 bytes, prova igualdade byte a byte e validação GDAL após restauração.
- `valid_cog_backup/source_valid.cog.tif` e `valid_cog_backup/restored_valid.cog.tif`: ambos 377.166 bytes e SHA-256 idêntico `7de383d180b4ff57ff5ae3696a03302c8e3c7148406ec6a4a086343e361a7d8e`.
- `worker_raster/ingest_result.json`, `worker_raster/cog_gdalinfo.json` e `worker_raster/health_without_redis_postgis.json`: demonstram a chamada do worker com token, tiles reais e modo raster ativo mesmo com Redis/PostGIS indisponíveis no ensaio.
- `leaflet/draw_lab_marker_icon_fixed.webp`: captura do desenho de marcador com ícone e sombra Leaflet corrigidos.

### Pendências separadas por natureza

| Classificação | Item | Motivo objetivo | Próxima operação segura |
|---|---|---|---|
| Código ainda possível | Limpeza/retensão por projeto para tiles e exports | A ingestão cria assets persistentes; ainda não existe política de quota/TTL | Implementar job de limpeza no worker, com dry-run e auditoria local. |
| Código ainda possível | Split slider antes/depois | A UI atual alterna camadas e opacidade; não há divisor de recorte | Adicionar controle Leaflet local sobre as duas TileLayers sem mudar permissões. |
| Integração pendente | Fluxo autenticado completo | Sandbox não tem banco descartável nem sessão OAuth de homologação; nenhuma permissão foi relaxada | Subir DB de homologação, aplicar `0008` após revisão e executar admin/editor/client: upload, tile permitido/negado e exportação. |
| Infraestrutura pendente | Docker Compose completo | Docker/Compose não está instalado no sandbox | Executar `docker compose -f docker-compose.gis.yml --env-file .env.gis up --build` no Docker Desktop/on-premise e registrar health/worker. |
| Infraestrutura pendente | Volume persistente para portal + worker | O preview Manus não compartilha volume local de produção | Configurar `ARQUEO_RASTER_WORKER_URL`/token e volume do worker em host controlado; ou habilitar `direct-local` apenas on-premise. |
| Integração pendente | Persistir migration | Não se aplica schema em produção nesta cópia isolada | Revisar e aplicar somente no MySQL descartável; validar rollback/backup antes de homologação. |
| Dependência externa bloqueada | Backup remoto Manus | API atual de storage não fornece get/head/list privado por chave estável para round-trip verificável | Manter bloqueado; usar `BackupStore` filesystem on-premise até um adapter remoto compatível existir. |

### Comandos adicionados

```bash
pnpm vitest run server/rasterIngestionLocal.test.ts server/rasterCogBackupRoundtrip.test.ts server/rasterIngestionAdapter.test.ts
pnpm run rehearse:backup-valid-cog
node --check infra/worker/index.js
pnpm run build
```

A validação atual somou **12 testes direcionados** nesta frente: 9 de raster/backup COG e 3 do adapter de ingestão, além do ensaio HTTP do worker e do teste visual anônimo do laboratório. Nenhum desses procedimentos consultou banco, OAuth, storage remoto ou dados de produção.


## Atualização — prévia geral de construção sem login

| Requisito | Implementação | Evidência | Estado |
|---|---|---|---|
| Acesso de construção sem OAuth | `client/construction-preview.html`, `client/src/construction-preview.tsx`, `client/src/pages/ConstructionPreview.tsx`, terceira entrada Vite | Navegação direta em `/construction-preview.html`, sem redirect para `manus.im`; mapa Esri carregado, marcador criado e contador atualizado para 1 | **Concluído na cópia isolada.** |
| Isolamento explícito | A entrada não importa `App`, `useAuth`, `trpc`, Header, banco ou routers do Portal | Conteúdo declara dados sintéticos e bloqueia qualquer upload/persistência real; seletor de arquivo é somente visual | **Concluído.** Não reduz proteção da aplicação autenticada. |
| Portal publicado | `geoportal.manus.space` permanece com OAuth | Nenhuma rota, middleware ou configuração do Portal principal foi alterada | **Preservado.** Produção continua autenticada. |

URL da prévia isolada: `https://4175-iuo8hfyb75mmc0cbd5fcq-77fb58c0.us5.manus.computer/construction-preview.html`.
