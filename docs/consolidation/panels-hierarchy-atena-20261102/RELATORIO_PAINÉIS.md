# Integração dos painéis do mapa global — item 2

**Concluído em 02/11/2026, na worktree exclusiva `/home/ubuntu/atena_geoportal_paineis_atena_isolado`.** Baseline confirmado: `13bd34ef34e91bba0b813249dda2469d78fd8761`. Nenhum commit, publicação, instalação ou consulta remota foi executado por este agente.

## Arquivos implementados sob minha responsabilidade

| Arquivo relativo à worktree | Entrega |
|---|---|
| `client/src/pages/Home.tsx` | Consumo validado de `?projectId=`, sidebar inicial recolhida com preferências próprias e tolerância a storage bloqueado, consultas da sidebar apenas quando úteis, mobile sobreposto/desktop deslocado, `inert`/ARIA e Escape. Login `startLogin` mantido. |
| `client/src/components/GlobeViewer.tsx` | Integração incremental ao globo existente, seleção multiprojeto, mapa-base atual, overlays de camadas reais, contexto autorizado, dimensionamento pelo contêiner, zoom/pan/centro Leaflet sincronizados e mapas salvos com mapa-base/zoom real. Não foi substituído pelo GlobeViewer do stage. |
| `client/src/components/GlobalMapPanels.tsx` | Novo seletor compacto Projetos / Mapa-base / Camadas com apenas um drawer visível, Escape, retorno de foco, ARIA e conservação de busca/expansão após fechar/reabrir. |
| `client/src/components/MyProjectsPanel.tsx` | Busca por nome/código, caixa mestre com estado parcial, seleção de até 500 projetos, 200 resultados visuais por busca, contador, estados de falha/carregamento, árvore por projeto, exportação real GeoJSON/KML e link ao workspace existente. |
| `client/src/components/BaseLayersPanel.tsx` | Catálogo real de bases, filtros por origem/tema/busca, preferência de visibilidade por usuário, estados de cache/falha/formato indisponível e renderizador GeoJSON cancelável. |

Li o parecer solicitado, os padrões stage de `GlobalMapPanels`/`MyProjectsPanel`/`BaseLayersPanel` e os contratos PR8 pertinentes. Os três componentes novos foram adaptados, não copiados cegamente. As alterações em Home/Globe também receberam formatação local, portanto o diff textual é maior que a mudança funcional.

## Contratos backend utilizados e coordenados

Todos os procedimentos são consumidos pelo cliente tRPC tipado, sem `any` para contornar namespaces ausentes. Os agentes de backend já disponibilizaram os contratos durante esta implementação e o conjunto passou no typecheck.

- `projects.list()` existente: única lista de projetos usada para busca/seleção. ID da URL é aceito como contexto somente se existir nessa lista autorizada. Links reais: `/projects/:id?tab=map`; não há botão fictício de abertura de workspace.
- `projectSelection.get()` → `number[]`; `projectSelection.set({ projectIds: number[] })` → confirmação. Seleção limitada a 500. Alteração local imediata é revertida se a mutação falhar, com mensagem explícita; gravação só é confirmada pelo backend. O projeto contextual é incorporado à seleção da visualização atual, sem gravar automaticamente ao abrir uma URL. A mudança por checkbox persiste o conjunto.
- `geometries.listForProjects({ projectIds })`: modelo atual de geometrias, ordem armazenada lat/lng e `effectiveVisible`. Só são exibidas geometrias visíveis e dos projetos selecionados. `geometries.list` contextual segue ativo para acompanhar invalidações dos componentes legados de importação/opacidade/exclusão e atualizar a lista multiprojeto.
- `layers.list({ projectId })`: nós completos com `layerData`, `isGroup`, `effectiveVisible`, estilo e metadados preservados. Grupos não são desenhados. O helper compartilhado `shared/workspaceHierarchy.ts`, fornecido pelo outro agente, identifica FeatureCollections materializadas e impede desenhar novamente as mesmas feições como linhas de `geometries`.
- `LayersTree` fornecido pelo outro agente é apenas importado/composto. Recebe `canEdit={user.role === 'admin' || user.role === 'editor'}`; visibilidade pessoal permanece disponível para leitores. Não alterei o componente.
- `baseLayers.catalog()` mantém catálogo atual e acrescenta `userVisible`; `baseLayers.setVisibility({ id, visible })` persiste e invalida catálogo. Não foram acrescentados fornecedores ou fontes oficiais novas.
- `geometries.export({ geometryIds, format: 'geojson' | 'kml' })` existente: exportação real das geometrias do projeto expandido, inclusive para leitores autorizados; mensagens distinguem vetores/resultados exportáveis no workspace.

## Preservação e comportamento

O globo 3D, suas texturas atuais, `LeafletDrawControl`, medição, busca/coordenadas, importação, exportação, impressão e mapas salvos continuam no código. Desenho/importação só aparecem com contexto autorizado e papel editor/admin; o servidor continua revalidando a autorização. A geometria desenhada é removida do FeatureGroup após salvamento para não duplicar a cópia persistida, e os anéis de polígonos são fechados usando o helper existente.

A seleção de mapa-base usa exclusivamente `BASEMAPS` / `SELECTABLE_BASEMAPS` atuais: `name`, `availability`, `xyz/wmts`, URL e atribuição existentes. OSM/OpenTopo condicionados à aprovação permanecem desabilitados. Não foram criados `label`, `enabled`, controles temporais ou WMS temporal. A UI informa que a textura do globo 3D é independente e que o mapa-base se aplica em 2D.

Vetores legados/importados/resultados em `layers.layerData` FeatureCollection são desenhados em 2D com visibilidade efetiva da árvore. Raster, WMS e análises avançadas continuam no workspace existente e são explicitamente indicados como tal. Não foi importado `OfficialMapLayers`; não há consulta remota automática de bases oficiais novas.

O renderizador de bases GeoJSON usa somente o `dataUrl` já cadastrado, cancelamento por AbortController, remoção dos overlays ao desmontar/falhar, limite de 15 MB e mensagens reais de HTTP/formato/CORS/tamanho. O controle não permite ligar formatos não suportados ou dados incompletos; se uma preferência antiga estiver ligada, é possível desligá-la. Esse fetch é leitura de artefato do catálogo na aplicação, não substituto da API tRPC. **Nenhum fetch ou acesso desse tipo foi executado no ensaio deste agente.**

## Validação executada

1. `git rev-parse HEAD`: baseline mantido.
2. Prettier somente nos cinco arquivos autorizados; sem alterações em dependências.
3. TypeScript completo: `env -i ... node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false` — **exit 0**, sem erros. `--incremental false` evita escrita em `node_modules`, que é symlink read-only. A primeira tentativa sem caminho absoluto de Node falhou por PATH; corrigida sem alterar ambiente/dependências. Erros transitórios de outros agentes vistos no primeiro typecheck real desapareceram no final.
4. `git diff --check` nos arquivos existentes de responsabilidade deste agente — sem erros.
5. Verificação estática com parser TypeScript dos cinco TSX e asserts de preservação de componentes, contratos de seleção/geometrias, prevenção de duplicatas, catálogo atual sem WMS temporal, ARIA/Escape/foco, workspace real, limites 200/500, exportação e login preservado — **19 verificações PASS**.

Evidências locais:

- `typecheck-paineis-final.log`: saída do typecheck final (vazia porque passou).
- `verificacao-estatica-paineis.log`: verificações estáticas PASS.
- `paineis-owned-files.patch`: patch restrito aos cinco arquivos desta entrega, para revisão/transferência seletiva.
- `paineis-evidencias.json`: baseline, status de validação e hashes dos cinco arquivos.

## Limites e pendências de homologação

Não foi iniciado servidor, navegador, banco ou chamada LLM/rede. Não houve teste funcional com sessão real, migração aplicada ou dados operacionais. O teste visual offline foi delegado pelo coordenador ao agente D; ele pode montar os componentes reais com mocks dos contratos acima, sem `OfficialMapLayers` e com catálogo controlado. Typecheck/inspeção estática não são homologação visual nem prova de persistência no banco.

Não alterei Header, App, Atena, routers, schema, LayersTree, dependências, `.env`, produção ou stage. Há alterações desses arquivos na worktree compartilhada realizadas por outros agentes; não são desta entrega. Não foi tocado o item 4 divergente (Header/provedores/MFA), nem OAuth/login.
