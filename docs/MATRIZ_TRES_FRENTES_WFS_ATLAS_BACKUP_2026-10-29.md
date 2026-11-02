# Matriz final — WFS, Atlas vetorial A1/A0 e inventário de backups

**Escopo desta rodada:** somente três frentes autorizadas: importação WFS paginada, Atlas cartográfico com vetores/A1/A0 e inventário físico de backups. Nenhuma publicação, migração aplicada, alteração no projeto principal, OAuth, permissões existentes ou storage produtivo foi executada.

**Base isolada:** `desenvolvimento/auditoria-20261029`.

## 1. Resultado por requisito

| Frente | Item | Implementação | Evidência executada | Estado |
|---|---|---|---|---|
| WFS | WMS apenas visual | O workspace continua a renderizar somente variantes WMS via `WMSTileLayer`; o endpoint de importação exige `serviceType = wfs`. | Teste de contrato e filtro de tipo em `server/wfsImportService.test.ts`; revisão estática do router. | Implementado e testado unitariamente |
| WFS | WFS paginado | `server/wfsImportService.ts` emite `GetFeature` WFS 2.0, `startIndex`, `count`, `BBOX` em EPSG:4674, recebe somente GeoJSON e acumula páginas. | 4 testes WFS: URL/BBOX, duas páginas, truncamento e rejeição de MIME não JSON. | Implementado e testado |
| WFS | Limites e segurança | 500 feições/página, até 10 páginas, 5.000 feições, 15 MiB; timeout 20 s; endpoint normalizado por allowlist/TLS do catálogo; nenhum path/URL é aceito do navegador. | `server/wfsImportService.test.ts`. | Implementado e testado |
| WFS | Importar base para projeto | `ogcCatalog.importWfsToProject` exige editor/admin + vínculo ao projeto + AOI; cria camada vetorial privada, inicialmente invisível, com origem, BBOX, contagens e truncamento auditáveis. | TypeScript/build aprovados; integração autenticada depende de MySQL + OAuth locais. | Código implementado; integração autenticada pendente de infraestrutura local |
| WFS | Cruzar com arquivos/resultados | Camadas WFS usam o mesmo modelo de vetor importado na árvore; podem ser ativadas e selecionadas para as operações existentes de buffer, união, interseção, clip, overlay, malha e área. | TypeScript/build aprovados; as análises espaciais seguem a suíte preexistente. | Código implementado; ensaio autenticado pendente |
| Atlas | Vetores/resultados sobre COG | `server/atlasVectorOverlay.ts` seleciona só camadas do projeto, descarta geometrias inválidas e impõe 20 camadas/5.000 feições; `atlasRouter` envia somente dados limpos ao worker. | 2 testes: limpeza/limitação de estilos e bloqueio acima de 5.000 feições. | Implementado e testado |
| Atlas | Legenda, escala, norte e CRS | `render_atlas_pages.py` produz página-índice, folhas com COG real, vetor, legenda, barra de escala, norte, quadro, CRS, escala e BBOX. | Ensaio GDAL A1/A0 com 1 overlay vetorial e `pdfinfo`. | Implementado e testado localmente |
| Atlas | A4/A3 preservados | Perfis existentes permanecem: A4 1.800×1.200; A3 2.400×1.600. | Revisão do perfil do worker e build aprovado. | Implementado |
| Atlas | A1/A0 controlados | A1 4.200×2.800 (11,76 Mpx); A0 5.600×3.800 (21,28 Mpx); teto padrão 24 Mpx, 50 folhas, 80 MiB PDF, 5 MiB de overlays. | PDF A1 e A0 gerados no ensaio local, ambos com 2 páginas (índice + folha). | Implementado e testado localmente |
| Atlas | CRUD/seleção de template e layers | Interface preservada; seleção explícita de camadas vetoriais/resultados é congelada no `layersConfig` do job. | TypeScript/build aprovados. | Implementado; CRUD autenticado requer MySQL/OAuth locais |
| Backup | Inventário real | Novas tabelas `backup_policies` e `backup_inventories` registram ID, status, modo, chaves de manifesto, SHA-256 de manifesto/artifact, bytes de archive/objetos, contagens, expiração, retenção e hora de restore verificado. | Migration `drizzle/0013_glamorous_betty_brant.sql` revisada: apenas `CREATE TABLE`/índices. | Implementado; migration ainda não aplicada |
| Backup | Backup físico/restaurável | O router grava inventário apenas após `createLocalFilesystemArchive`; em estado completo executa restore em memória antes de declarar o backup recuperável. | 5 testes de archive/store: cópia, ausência, corrupção de blob/artifact/manifest e purge. | Implementado e testado |
| Backup | Retenção | Política 1–365 dias; em criação de novo backup, registros completos vencidos são marcados e removidos somente do prefixo `backups/<backupId>`. | Teste de política e teste de purge que preserva backup de outro ID. | Implementado e testado |
| Backup | Inventário administrativo | Página Backups mostra status físico, ID, tamanho, hashes, expiração e ação administrativa de `verifyRestore`. Não infere mais recuperação somente a partir de audit log. | TypeScript/build aprovados. | Implementado; requer migration + runtime filesystem para ensaio autenticado |

## 2. Evidência local do Atlas

Os arquivos de evidência ficam no pacote independente, sob `atlas_a1_a0/`.

| Perfil | Raster | Resultado | Hash SHA-256 PDF |
|---|---:|---|---|
| A1 paisagem | 4.200×2.800 = 11.760.000 px | 2 páginas; índice + folha; 1 overlay vetorial | `ece6e2d28ed8c78e15d27613732a04d6404cec23a953aec05a883cbf18033e7c` |
| A0 paisagem | 5.600×3.800 = 21.280.000 px | 2 páginas; índice + folha; 1 overlay vetorial | `d16761b9ebb1384bc9b0ed9ef2ca0d741ddf22980344651af291af7774c259a1` |

A fonte destes PDFs é um COG **sintético válido**, usado somente para ensaio local. Não representa dado de projeto ou ortofoto real.

## 3. Validações desta rodada

```text
21 testes aprovados em 6 arquivos
- WFS: paginação, BBOX, truncamento e MIME
- Atlas: overlay vetorial e limites
- Backup: manifesto, archive, filesystem, retenção e corrupção
TypeScript: aprovado
Node worker: sintaxe aprovada
Python renderizador: py_compile aprovado
Build Vite + esbuild: aprovado
```

O build emitiu apenas o aviso não bloqueante de chunk JavaScript maior que 500 kB; não há erro de compilação.

## 4. Dependências mínimas para integração autenticada totalmente isolada

Nenhuma credencial de produção deve ser usada. O ambiente local precisa de:

1. **Node 20+ e pnpm 10**: `pnpm install`.
2. **MySQL 8/TiDB descartável**, com `DATABASE_URL` local. Aplicar *somente no banco isolado* a migration `0013_glamorous_betty_brant.sql` junto às migrations anteriores (`pnpm db:push` em ambiente descartável).
3. **OAuth normal do ambiente local**: configurar os valores normais da aplicação para login; os testes unitários não usam bypass de autenticação.
4. **Docker Desktop + Compose** para PostGIS/QGIS/Redis/worker: copiar `.env.gis.example` para `.env.gis`, trocar apenas valores locais e executar `docker compose -f docker-compose.gis.yml --env-file .env.gis up -d --build`.
5. **Volume de raster compartilhado**: o Portal e o worker precisam referenciar o mesmo diretório/volume em `RASTER_WORKER_ROOT`; o Compose já cria `raster_data` para o worker.
6. **Backup filesystem recuperável**: definir raízes absolutas distintas de origem e destino no template `infra/backup/.env.backup.recoverable.example`. O runtime exige `get/head/list` e mantém storage remoto bloqueado.
7. **Catálogo OGC**: cadastrar e validar um WFS HTTPS autorizado e saudável. WMS não serve para importação e não deve ser usado como fallback de vetor.

## 5. Comandos de validação local

```bash
# Código e testes desta rodada
pnpm vitest run server/wfsImportService.test.ts server/atlasVectorOverlay.test.ts \
  server/backupInventoryPolicy.test.ts server/backupArchive.test.ts \
  server/backupManifest.test.ts server/localFilesystemBackupStore.test.ts
pnpm exec tsc --noEmit
pnpm build

# Ensaio de COG/restauração já existente
pnpm run rehearse:backup-valid-cog
pnpm run rehearse:raster-local

# Infraestrutura GIS isolada
cp .env.gis.example .env.gis
# preencher somente valores locais não versionados
docker compose -f docker-compose.gis.yml --env-file .env.gis up -d --build
```

## 6. Pendências reais após esta rodada

| Dependência | Por que é externa | Próxima ação local, sem produção |
|---|---|---|
| MySQL migrado | O sandbox não tem MySQL local disponível para aplicar schema sem tocar dados compartilhados. | Subir MySQL descartável, aplicar migrations e executar fluxo autenticado projeto → WFS → análise → Atlas → backup. |
| OAuth normal | Não há identidade local autorizada configurada para ensaio end-to-end. | Configurar OAuth de desenvolvimento; não criar bypass no Portal. |
| Storage recuperável on-premise | O storage Manus atual não fornece `get/head/list` por chave estável. | Configurar raízes filesystem locais persistentes e executar `verifyRestore`. |
| WFS real aprovado | O importador está pronto, mas não foi consultado endpoint de terceiro nesta rodada. | Cadastrar no catálogo administrativo um WFS HTTPS oficial/permitido e testar com AOI pequena. |
| Scheduler verdadeiro | A política/retenção é persistida, mas o agendamento deve ser acionado por ambiente local (cron/serviço) após provisionamento. | Configurar cron/Task Scheduler local que invoque procedimento protegido por job interno; não há scheduler ativo nesta cópia. |

## 7. Integridade e escopo preservado

- Nenhuma modificação foi feita no projeto principal/publicado, domínio, banco de produção, storage Manus, OAuth ou permissões existentes.
- As três frentes são aditivas e mantêm a interface completa: Projetos, Mapas, Atlas, Arquivos e Administração não foram substituídos pela prévia demonstrativa.
- O WMS continua visual; importação é exclusiva de WFS autorizado.
- A migration foi gerada e revisada, **não aplicada**.
