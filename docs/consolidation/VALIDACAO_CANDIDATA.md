# Validação da candidata consolidada

**Ambiente:** cópia isolada, com variáveis sintéticas; sem banco, OAuth real, storage remoto, migração ou publicação.

## Aprovado

| Verificação | Resultado | Evidência |
|---|---|---|
| TypeScript | Aprovado | `pnpm exec tsc --noEmit` concluiu sem diagnóstico. |
| Build cliente/servidor | Aprovado | `pnpm build` concluiu com Vite + esbuild. Há somente aviso de chunk principal acima de 500 kB, sem falha. |
| Topologia e coordenadas | 21 testes aprovados | `geometry-coordinates` (16) + `leaflet-geometry-coordinates` (5). Inclui anéis fechados, furos e MultiPolygon. |
| KML/KMZ | 8 testes aprovados | Limites de download/ZIP, XML inseguro, coordenadas e MultiGeometry. |
| OAuth state/nonce | 3 testes aprovados | Callback rejeita estado ausente/malformado/divergente, consome nonce uma única vez e limpa o cookie. |
| Sessões JWT | 4 testes aprovados | Rejeita sessão sem issuer/audience ou de outro app; aceita sessão emitida para o app de teste. |
| Suíte consolidada | **36 testes / 6 arquivos aprovados** | Executada com `vitest.consolidation.config.ts`. |
| Componentes GIS puros | Aprovados na suíte existente | OGC, backup físico/manifesto/runtime/inventário, WFS, análise, promoção vetorial, raster/COG, Atlas, cache e árvore temática tiveram testes aprovados antes do bloqueio de banco. |
| COG local | Aprovado na suíte GIS | Ingestão GeoTIFF→COG/tiles e round-trip de backup com abertura GDAL foram aprovados. |

## Bloqueado — não classificado como falha de código da consolidação

A suíte integral existente foi iniciada sem `DATABASE_URL`, conforme a restrição de não usar banco da produção. Ela registrou **15 falhas DB-dependentes** e 6 testes ignorados/abortados porque as rotas de projetos, MFA e notificações exigem banco disponível.

Essas ocorrências retornaram `Database not available`; não indicam regressão de topologia, KML/KMZ, OAuth/JWT ou do build. A homologação com banco sintético independente continua necessária para concluir testes autenticados, RBAC, projetos, uploads persistidos, notificações e MFA.

## Não executado por restrição

- migrations/DDL/seeds, inclusive `0007–0012`;
- teste de recuperação dos 11 bytes indisponíveis;
- OAuth contra provedor real;
- qualquer leitura/escrita de produção, banco produtivo ou objetos remotos;
- deploy, publicação, merge ou push.
