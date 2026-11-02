# Integração Atena backend — PR8/stage com GIS atual

**Workspace autorizado:** `/home/ubuntu/atena_geoportal_paineis_atena_isolado`, baseline `13bd34ef`. **Versão do motor/adaptador:** `atena-gis-integrated-0.2.0`. Código efetivo implementado; validação offline em andamento, sem homologação operacional.

## Código e seleção das fontes

Foram portados `server/atenaRouter.ts`, `server/prospectRouter.ts`, `server/influenceRouter.ts`, `server/officialRouter.ts`, `server/official/**` e módulos Atena. `geo.ts`, `proj.ts` e `composition.ts` partem da PR8 completa, preservando validação compartilhada de topologia, furos, MultiPolygon e PDF. `areas`, `plan`, `skills`, `templates`, `prospect-grid` e cliente oficial remoto partem do stage onde há fonte local completa. Não foi portado o cache municipal local legado nem `atlas-pdf.ts`, que não são necessários ao fluxo integrado.

Nenhum schema, helper auth/projectAccess/LLM, db, router principal, layers/geometries/baseLayers, frontend, dependência ou lock foi alterado por este agente. A integração desses pontos é dos respectivos responsáveis. Sem instalação, commit, deploy, DDL, chamada externa real ou acesso a segredos.

## Ponte de dados deliberada

`loadGeometryRows(projectId, layerIds)` mantém a assinatura stage, restringe projeto/camadas/CRS, valida camada vetorial folha e lê **uma representação por camada**: havendo `geometries.layerId`, usa essas linhas; na ausência delas lê `layers.layerData` FeatureCollection. Nunca concatena FC e mirror. Não regrava entradas nem migra silenciosamente dados existentes.

O adaptador puro `server/atena/workspace.ts` traduz GeoJSON `[lng,lat]` para linhas efêmeras `[lat,lng]` apenas em memória. IDs negativos determinísticos representam componentes FC, sem serem confundidos com PKs de `geometries`; os IDs também mudam quando a geometria muda. MultiPolygon preserva todas as partes e furos. MultiPoint/MultiLineString são decompostos explicitamente em componentes na leitura; GeometryCollection/nulos/estruturas inválidas bloqueiam com erro, em vez de serem omitidos. O frontend não precisa persistir dados para torná-los analisáveis.

Saídas do executor são gravadas como novas camadas com `layerData: FeatureCollection`, `metadata.kind = 'gis-analysis-result'`, `metadata.storageBridge = 'geometry-mirror-v1'`, `metadata.provenance.engine = 'atena'`, `operation`, `runId`, parâmetros, projeção, referências de entrada e versão. Mantêm `geometries.layerId` como mirror para o motor PR8. O workspace deve renderizar a FC e suprimir os desenhos independentes associados a essas camadas, conforme coordenação com parent. Grupo, camadas, FC, geometrias e status concluído/histórico são publicados **na mesma transação**. Falha aborta a transação; não há limpeza compensatória que possa apagar insumos.

Criação/idempotência de runs é serializada pelo lock da linha do projeto. A tomada do run e a publicação usam lock do run. Cancelamento é condicional ao status, não sobrescreve execução já concluída. Falhas de buffer não são omitidas silenciosamente. Interseção admite Polygon e MultiPolygon.

## Contratos com UI stage

Os namespaces/procedimentos stage são mantidos: catálogo/status/interpretação/plano/run/get/list/cancel/renderMap/renderTemplate; prospect.sources/preview/save; influence.preview/save; official.catalog/query/analyze.

**Mudança intencional no save de influência/prospecção:** `saveDerivedGeometryBatch`, agora dentro de `server/atena/persistence.ts`, cria **nova camada/versão**, nunca modifica nem anexa às camadas de destino existentes. O retorno inclui `layerId` da versão realmente criada. `influence.save` também retorna `targetLayerId` com a seleção original. A UI deve invalidar a lista de camadas e selecionar/exibir esse novo `layerId`, não presumir que a camada original foi sobrescrita. Metadados e auditoria preservam requestId/destino/origens. Reenvio idêntico é idempotente; reutilizar requestId com conteúdo diferente gera CONFLICT. Prospect.sourceGeometryIds admite referências efêmeras negativas vindas da própria prévia FC; elas são revalidadas somente contra fontes do projeto na confirmação, nunca inseridas como geometries existentes.

A leitura/plano/prévia exige `requireProjectAccess(projectId, actor)`; toda escrita, cancelamento e geração de PDF exige `requireProjectEditor(projectId, actor)`, sem ampliar as regras GIS existentes. `canWrite` é calculado com a política atual. O catálogo de metadados públicos continua público, enquanto consultas/análises de dados oficiais são protegidas e validam o projeto quando presente.

## LLM e artefatos

Foram lidas as skills `builtin-llm-models` e `webdev-llm-integration`. Foi preservado o interpretador PR8 baseado no helper atual `_core/llm`; esse helper não foi substituído e nenhuma descoberta/seleção de novo modelo foi adicionada. Falta de provedor bloqueia a interpretação e remete ao formulário estruturado; resposta inválida/erro de provedor também retorna contrato determinístico e não inicia execução. IDs propostos são restritos às camadas fornecidas. Não há mock/bypass na aplicação. A fonte local PR8 não contém parser textual determinístico alternativo; o caminho determinístico existente é o pedido estruturado + `buildPlan`, preservado.

**Exigem API em runtime:** interpretar linguagem natural depende do provedor configurado no helper atual; `renderMap` e `renderTemplate` dependem do storage atual para upload/URL. PDF puro é gerado offline pelo motor PR8, mas upload/storage não foi exercitado. Nenhuma chamada LLM/storage foi feita nesta rodada. Não foi consultado catálogo de modelos, pois rede foi expressamente proibida; o modelo legado do helper foi mantido sem migração silenciosa.

## Fontes oficiais e dependências

Cliente remoto mantém HTTPS/TLS padrão, URLs fixas do catálogo, redirects manuais rejeitados, timeout 10 s, resposta máxima 4 MiB, no máximo 200 feições/200 mil pares, cache em memória limitado por escopo usuário/projeto e sem cache expirado/fallback local silencioso. AII exige edição declarada 2025, completude, geometrias integrais, código/nome, cobertura mínima 0,999 e revisão de toques; jamais buffer ou recorte municipal. Fontes bloqueadas no stage continuam bloqueadas. Proveniências recebidas são registros históricos das fontes, **não validação externa nova nesta rodada**.

O baseline não resolve `@turf/turf`, `@turf/boolean-intersects` nem `@turf/kinks` diretamente. Não houve instalação ou import de caminho interno transitivo. Foi implementado predicado local `atena/predicates.ts` para contato/interseção em pontos, linhas, polígonos, furos e multigeometrias, sem cálculo métrico; validade poligonal usa a validação compartilhada PR8 mais abrangente que apenas detectar kinks. Testes dirigidos cobrem contato, disjunção, sobreposição, furo, linha, MultiPolygon e topologia. Portanto **não há dependência adicional necessária para resolver os imports portados**, com esta adaptação explícita.

## Evidências offline

Até a checagem das 20:06: **78 testes em 7 arquivos passaram**, incluindo 58 PR8 portados e 20 novos de ponte/prospecção/predicados/cliente remoto. `backend-tests-offline.log` registra a execução. Mock de fetch aparece somente nos testes remotos e é identificado como tal; não equivale a fonte real. Testes PR8 de IA sem provedor usam mocks explícitos de ENV e bloqueio de rede apenas no teste.

`backend-typecheck-4.log` está vazio: `tsc --noEmit` terminou sem erros na árvore integrada observada naquele instante. A validação de driver MySQL real e fluxo via appRouter será feita pelo parent em schema/socket sintéticos isolados; este agente não subiu banco nem duplicou esse ensaio.

**Pendências de homologação:** driver real e rollback/cancelamento concorrente no ensaio parent; login/OAuth e sessão reais; disponibilidade e licença de fontes remotas; API LLM/modelo legado; storage e download efetivo de PDF; testes visuais no fluxo UI. Nenhum deles é declarado homologado por testes offline.

## Fecho técnico — 20:10

A rodada final repetiu os **78 testes/7 arquivos com sucesso** e `tsc --noEmit` sem erros (`backend-typecheck-final.log`, zero bytes). O executor e o gravador de derivados passaram a usar o helper `withLayerHierarchyLock` fornecido pelo parent para criação idempotente e publicação: conexão reservada, âncora `projects.id FOR UPDATE`, `START TRANSACTION` em MySQL e `BEGIN PESSIMISTIC` em TiDB, sem advisory lock/GET_LOCK nem alteração de configuração. A tomada inicial do run continua transacional e condicionada a queued.

Foram acrescentados limite Atena de 50 mil vértices de entrada (além de 5 mil feições e extent de 2.500 km²), rejeição de camadas de origem duplicadas e validação topológica compartilhada para polígonos oficiais decodificados antes de análises. O allowlist de endpoint rejeita também credenciais, fragmentos e origem/porta diferente. IDs efêmeros de FC incluem a geometria no hash para que uma prévia antiga não confirme silenciosamente um insumo FC alterado.

As importações do helper de hierarquia são reutilização de API interna fornecida pelos responsáveis, não modificação de `layersRouter.ts` por este agente. O estado dos testes sintéticos de driver real pertence ao relatório do parent; nenhuma afirmação de execução real desse driver é feita aqui.
