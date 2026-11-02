# Harness visual offline — componentes GIS reais

**Data:** 02 de novembro de 2026
**Escopo:** cópia isolada da Opção A; Chromium local, Vite em `127.0.0.1:4178`, fixtures exclusivamente sintéticas.
**Não é:** Portal autenticado, OAuth real, homologação integral, stage ou produção.

## O que foi adicionado

O harness é uma entrada separada, fora de `main.tsx`, `App`, rotas do Portal e inputs do build de produção:

- `client/local-visual-harness.html`: CSP de localhost, sem frame, mídia ou origem externa.
- `client/src/localVisualHarness.tsx`: usa componentes reais `ThematicLayerTree`, `LeafletDrawControl` e `MeasurementTools`, com dados e callbacks em memória.
- `vite.local-visual.config.ts`: Vite sem `vitePluginManusRuntime`, host fixo `127.0.0.1` e porta `4178`.
- `infra/scripts/run_local_visual_harness.py`: executor Chromium/CDP local reutilzável.

O browser foi iniciado com resolução externa bloqueada (`MAP * 0.0.0.0, EXCLUDE 127.0.0.1`). A CSP permite assets locais/self/data/blob e `connect-src 'self'`; a exceção `unsafe-eval` existe **somente nesta página localhost** porque `leaflet-measure` é um módulo UMD que a requer durante a própria avaliação. `fetch`, `XMLHttpRequest`, `WebSocket` e `window.open` são substituídos por bloqueios que falham se chamados pelo harness.

Não foram montados `main.tsx`, `App`, `useAuth`, tRPC, banco, storage, OAuth, cookie, token ou usuário. Não existe mock de sessão.

## Fluxos executados no Chromium local

| Fluxo real exercitado | Resultado | Evidência |
|---|---|---|
| Ocultar camada própria na árvore | Aprovado | Registro local contém `Ocultada: Área de interesse sintética`. |
| Subir raster na ordem visual | Aprovado | Registro local contém `Subida na ordem: COG sintético restaurado`. |
| Abrir Leaflet Draw e criar marcador | Aprovado | O callback real criou uma geometria no `FeatureGroup` em memória; botão passou a `Limpar 1 geometria(s)`. |
| Montar `MeasurementTools` | Aprovado no harness | Controle de medição presente após import UMD sequencial. |
| Bloqueio de rede externa | Aprovado | `externalResourcesObserved` ficou vazio; somente loopback carregou assets. |
| Ícone e sombra Leaflet | Aprovado | `marker-icon.png` 25×41 e `marker-shadow.png` 41×41 carregaram completos por loopback. |

A captura final está em `docs/consolidation/evidence/local-visual-harness/local-visual-harness.png`, SHA-256 `9d1156cf5f3bbdc7870a57770fbe0f8b344e99ea6257cf8cb68b7cfb07c43b50`.

## Medição: comparação de ordem de inicialização

O componente real `MeasurementTools.tsx` importa `leaflet-measure` dinamicamente no `useEffect`, então só aceita o controle se esse import registrar `L.Control.Measure` na mesma instância Leaflet usada por `useMap`.

O entrypoint real `client/src/main.tsx` importa o helper de ícones e então monta `App`; ele não atribui explicitamente `window.L`. `GlobeViewer.tsx` importa `L` e monta `MeasurementTools` dentro de `MapContainer`. Essa ordem é diferente do harness e foi analisada apenas estaticamente: ela não prova nem refuta o registro UMD no browser autenticado.

No harness, a sequência foi deliberadamente imposta antes do React montar:

1. atribuir `window.L` à instância `L` importada por `react-leaflet`;
2. executar e aguardar `await import("leaflet-measure")`;
3. confirmar `window.L === L`;
4. confirmar `typeof L.Control.Measure === "function"`;
5. montar o `MapContainer` e `MeasurementTools` reais.

A evidência confirmou `windowLIsSameMapInstance=true`, `umdRegisteredBeforeReactMount=true` e `measurementControlMounted=true`. Antes desse teste, o plugin foi bloqueado pela CSP sem `unsafe-eval`; isso foi diagnosticado com `window.L` presente e `L.Control.Measure` indefinido. A exceção local de CSP resolveu esse bloqueio sem permitir rede externa.

**Conclusão precisa:** a medição foi validada apenas neste harness, com ordem explicitamente reforçada. Não há afirmação de que o entrypoint real autenticado garante a mesma ordem; ele requer teste futuro no ambiente isolado com browser.

## Correção de assets Leaflet

A captura inicial mostrou um marcador quebrado. A inspeção verificou que `L.Icon.Default` concatenava `imagePath` com o URL absoluto produzido pelo Vite, resultando em caminho duplicado e dimensões naturais zero.

O helper compartilhado `client/src/lib/leafletDefaultMarker.ts` passou a remover a implementação especializada `_getIconUrl` de `Icon.Default` antes de aplicar URLs emitidas pelo bundler. A implementação base do Leaflet passa a respeitar as URLs absolutas. O helper permanece importado pelo entrypoint real e pelo harness; portanto a correção alcança ambos, mas só o harness foi validado visualmente nesta rodada.

## Validações adicionais

- `pnpm check`: aprovado.
- `pnpm build`: aprovado; aviso conhecido de chunk principal acima de 500 kB, sem falha.
- Nenhuma alteração em produção, stage, banco, storage, OAuth, segredo, usuário, permissão, migration, objeto legado, GitHub remoto ou domínio.

## Limites que permanecem

O harness não cobre e não simula: OAuth/callback/cookie/MFA, tRPC, RBAC, persistência de desenho, banco TiDB/MySQL remoto, storage, upload, download, tile base, WMS, WFS, raster/COG, Atlas/PDF, globo 3D, stage ou produção. Esses fluxos exigem homologação isolada real e não são aprovados por esta evidência.
