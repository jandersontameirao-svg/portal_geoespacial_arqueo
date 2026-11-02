# Atena UI — fechamento do harness local offline

**Resultado em 02/11/2026: PASS — 5/5 cenários, 83/83 checks. Componentes estabilizados para a consolidação do agente principal.**

A terceira tentativa preservada está em [`visual-offline/attempt-20261102T231055.959202Z-3b421b`](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b). O resultado estruturado, com checkpoints, chamadas e hashes, está no [report.json](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/report.json).

## Escopo e alterações desta etapa

O trabalho ocorreu em `/home/ubuntu/atena_geoportal_paineis_atena_isolado`. Foram relidas as skills `webdev-readme-fullstack` e `image-processing`. Apenas estes dois arquivos de código foram alterados nesta etapa:

- `client/src/components/AtenaPanel.tsx`: `min-w-0`, quebra de palavras/textos na revisão, `flex-wrap` na linha de ações e botões com altura adaptável e texto quebrável. Em 390 px, confirmar e descartar agora ocupam linhas distintas; em desktop permanecem lado a lado.
- `client/src/panelsAtenaVisualHarness.tsx`: fixture explícita `geometries.list`, retornando `[]` apenas para consultas dos projetos sintéticos conhecidos, com erro para tipo/projeto inesperado. A lista pública de APIs mockadas foi atualizada. O `default` continua rejeitando chamadas desconhecidas; não foi introduzido fallback genérico.

O executor `infra/scripts/run_panels_atena_visual_harness.py` não precisou ser alterado. Nenhum assert foi removido, enfraquecido ou contornado. Backend, testes, backup, layers e demais arquivos foram somente leitura ou não acessados por esta etapa. Não houve instalação, commit, acesso ao app real, MCP/browser remoto, stage/produção, DB, segredos ou env real.

## Execução e contagens

Foi executado uma vez nesta etapa o comando existente:

```sh
python3 infra/scripts/run_panels_atena_visual_harness.py
```

| Cenário | Viewport | Checks aprovados | Resultado |
| --- | --- | ---: | --- |
| `map-desktop` | 1057 × 692 | 18/18 | PASS |
| `map-mobile` | 390 × 844 | 18/18 | PASS |
| `atena-desktop` | 1057 × 692 | 20/20 | PASS |
| `atena-mobile` | 390 × 844 | 20/20 | PASS |
| `atena-unauthorized` | 390 × 844 | 7/7 | PASS |
| **Total** | | **83/83** | **5/5 PASS** |

Há 28 checkpoints de layout, todos sem overflow horizontal. Nos checkpoints mobile `plan-ready` e `confirmed-checkbox-only`, `documentElement.scrollWidth` e `body.scrollWidth` são ambos **390**, contra **402** na tentativa anterior. Nos cenários desktop as larguras são **1057**.

Os hashes dos arquivos acompanhados pelo executor foram iguais antes e depois do run (`sourceFilesStableDuringRun: true`). O typecheck e a suíte consolidada não foram repetidos nesta etapa: a consolidação final fica com o agente principal.

## Fluxos exercitados

### Projetos e painéis do mapa

Os componentes reais `GlobalMapPanels`, `MyProjectsPanel`, `LayersTree` e os painéis de mapa-base/camadas foram montados sobre um canvas sintético, sem montar um mapa externo.

O fluxo abre Projetos, filtra `QA-ALFA` e confirma a exclusão de Beta, verifica o href `/projects/4242?tab=map`, alterna a seleção do projeto, expande a árvore com grupo e folha, desliga o grupo e observa a folha oculta pela hierarquia. As mutações de visibilidade vão somente ao link tRPC em memória. O teste religa o grupo, desliga a folha, recolhe e expande o grupo preservando o estado da folha. Depois abre mapa-base e catálogo de camadas, retorna aos projetos preservando a busca e fecha via Escape restaurando o foco ao gatilho.

A exportação de geometrias não é exercitada: a nova fixture informa explicitamente zero desenhos. `geometries.export` não foi mockada nem liberada.

### Atena e confirmação explícita

1. Antes da seleção autorizada, nenhuma chamada `atena.*` ocorre.
2. A seleção de `4242` só monta o workspace após o projeto constar no `projects.list` sintético.
3. Interpretar o texto preenche a proposta; **não chama `atena.run`**.
4. Verificar o plano mostra a revisão; **não chama `atena.run`**. O botão de execução permanece desabilitado antes do checkbox.
5. Marcar o checkbox de autorização, sozinho, **não chama `atena.run`**.
6. Alterar a distância de 50 para 60 invalida e remove o plano revisado e a confirmação.
7. Verificar novamente retorna uma revisão com checkbox desmarcado.
8. Somente depois de remarcar o checkbox e clicar explicitamente **“Confirmar e executar análise”** ocorre **uma única chamada simulada `atena.run` por cenário Atena**, com `distanceM: 60` no snapshot enviado.
9. O retorno de consulta da execução é deliberadamente `failed`, com `MOCK_EXECUTION_FAILED`. A UI apresenta a falha e não apresenta resultados como sucesso.

Portanto, **nenhum run ocorre antes do clique explícito no botão de execução**, nem por interpretação, planejamento ou checkbox isolado.

O cenário de candidato não autorizado `999999` faz apenas `auth.me` e `projects.list`. Nenhuma consulta com `projectId: 999999` é emitida, nenhum workspace é montado e a identidade numérica não aparece no texto da mensagem de contexto indisponível. Trata-se de verificação do comportamento frontend com dados sintéticos, não de autorização real.

## APIs e campos mockados

Todo tRPC é um `TRPCLink` em memória, sem link HTTP. As entradas, respostas e erros são registrados em `window.__PANELS_ATENA_HARNESS__` e nos JSONs da tentativa.

| API | Dados sintéticos / campos relevantes |
| --- | --- |
| `auth.me` | `id: 9000`, nome “SESSÃO SINTÉTICA, não autenticada”, `role: editor`, `email: null`. Não é sessão OAuth. |
| `projects.list` | Alfa `4242` e Beta `4243`; nome, código QA, `ownerId: 9000`, `status: active`, `createdAt`/`updatedAt` fixos em 01/01/2026. |
| `layers.list` | Grupo `8100` e folha `8101`, projeto `4242`, `parentId`, `isGroup`, `sortOrder`, `userVisible`, `effectiveVisible` calculada somente sobre a árvore em memória, `layerType: vector`, `crs: EPSG:4326`, contagens 0/2. |
| `geometries.list` | `[]`; exige `query` e `projectId` de um dos projetos sintéticos. Nenhuma geometria ou exportação real. |
| `layers.setVisibility` | Altera `userVisible` no array em memória; resposta `{ success: true, persisted: false }`. |
| `baseLayers.catalog` | `[]`; nenhuma camada externa ativa. |
| `atena.status` | `ai.configured: true` somente para permitir o fluxo UI sintético; modo explicitamente MOCK, skills/listas vazias e `codeVersion: synthetic-ui-only`. Nenhum modelo. |
| `atena.templates` | Um modelo `areas_influencia` explicitamente `blocked`, motivo de fonte remota bloqueada sem fallback; roles vazios, versão sintética, A3/paisagem. |
| `atena.layers` | Apenas a folha sintética `8101`. |
| `prospect.sources` | `canWrite: true` sintético, `geometries: []`, camada sintética. Não prova permissão no servidor. |
| `atena.list` | `[]`; histórico real não consultado. |
| `atena.interpret` | Proposta fixa `vector.buffer`, origem `8101`, 50 m e nome “Buffer sintético 50 m”; explicação determinística MOCK. |
| `atena.plan` | Plano fixo `ready`, `planVersion: 1`, skill/versão sintéticas, referência nula, origem `8101`, parâmetros de área/buffer identificados como não calculados e dois passos MOCK. |
| `atena.run` | `{ outcome: started, runId: 9900, reused: false, persisted: false }`; não cria execução real. |
| `atena.get` | `id: 9900`, projeto `4242`, `status: failed`, passos/alertas vazios, `outputs: null` e mensagem explícita `MOCK_EXECUTION_FAILED`. |

A fixture de plano é fixa em 50 m mesmo na segunda revisão; o assert de snapshot verifica que a UI envia o parâmetro atual 60 m ao run. Este harness **não valida coerência semântica de um planejador real, cálculo GIS ou regras de backend**. O texto/nome sintético também permanece fixo. Os estados bem-sucedidos de execução, cancelamento, geração/renderização de PDF e modelos disponíveis não fazem parte destes cenários.

## Isolamento e persistência

O launcher usa `env -i` com apenas `HOME`, `PATH`, `LANG`, `NO_PROXY` e `no_proxy`. O Vite exclusivo do harness tem `envDir: false`, `publicDir: false`, host `127.0.0.1` e não importa a configuração do app ou backend. O processo roda em namespace próprio de rede, somente com `lo` e sem rotas IPv4/IPv6.

A verificação fail-closed já existente do executor confirmou `ENETUNREACH` (errno 101) para seu probe direto; não havia rota externa. `externalObservedRequests: []`, recursos carregados somente por loopback e `consoleExceptions: []`. Nenhum tile/mapa-base externo foi montado ou carregado. O seletor exibe o catálogo/configuração existente, mas não consome a fonte nem acessa os links de condições.

O `auth.me` é um retorno sintético, **não autenticação real, OAuth validado ou bypass do aplicativo**. O componente real `MyProjectsPanel` usa o hook `useAuth`, que tenta gravar `manus-runtime-user-info`; somente no entrypoint do harness `Storage.prototype.setItem` registra a tentativa em memória e suprime a escrita. Duas tentativas foram registradas por cenário de mapa; nenhuma nos cenários Atena. O hook/comportamento de produção não foi alterado. Cookies, localStorage e sessionStorage permanecem vazios em todos os checks finais.

Chromium e Vite foram encerrados; o diretório temporário de perfil/cache foi removido. Não foi deixado serviço rodando.

## URLs PDF e garantias preservadas

As alterações de responsividade não modificaram os handlers, a invalidação por revisão, o checkbox obrigatório, o botão explícito ou os guards de execução. `safeAtenaArtifactUrl` segue utilizado antes de expor URLs de PDF: aceita caminho absoluto local não protocol-relative ou HTTPS sem credenciais, rejeitando controles/espaços/backslash e outros protocolos. O preview mantém `sandbox`, `referrerPolicy="no-referrer"` e link com `rel="noopener noreferrer"`.

Essa é uma constatação por leitura do código preservado. O harness não gera PDF nem exercita o caminho de sucesso de artefatos; não declara validação real de PDFs, armazenamento, download ou origem remota.

## Evidências visuais

Foram geradas **11 capturas**, todas lidas com `functions.read` para inspeção visual: revisão e falha Atena nos dois tamanhos, contexto não autorizado mobile e árvore/mapa-base/camadas nos dois tamanhos. As dimensões dos PNGs foram verificadas: 1057 × 692 ou 390 × 844 conforme o cenário.

Na revisão mobile, checkbox, texto de autorização e ambos os botões estão legíveis e contidos no cartão. Em desktop a revisão mantém a linha de ações. A falha simulada é visível e explicitamente vermelha; os painéis do mapa não mostram tiles. O texto longo do modelo no `select` nativo pode aparecer truncado na área fechada mobile, sem causar overflow da página.

- [Revisão Atena desktop — 1057 × 692](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/atena-desktop-review.png)
- [Revisão Atena mobile — 390 × 844](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/atena-mobile-review.png)
- [Falha simulada Atena desktop](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/atena-desktop-failure.png)
- [Falha simulada Atena mobile](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/atena-mobile-failure.png)
- [Contexto não autorizado mobile](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/atena-unauthorized.png)
- [Árvore desktop](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-desktop-tree.png) e [árvore mobile](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-mobile-tree.png)
- [Mapa-base desktop](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-desktop-basemap.png) e [mapa-base mobile](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-mobile-basemap.png)
- [Camadas desktop](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-desktop-layers.png) e [camadas mobile](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-mobile-layers.png)

## Tentativas anteriores preservadas

Nenhuma tentativa foi apagada ou sobrescrita.

| Tentativa | Resultado preservado | Diagnóstico |
| --- | --- | --- |
| [`attempt-20261102T230741.327825Z-839255`](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T230741.327825Z-839255/report.json) | 0/5 cenários; 6/7 checks efetivamente alcançados | Erros de escape em seletores JavaScript provocaram timeouts nos quatro fluxos; o check de storage do contexto não autorizado também falhou. Correções anteriores a esta etapa. |
| [`attempt-20261102T230914.093644Z-84a037`](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T230914.093644Z-84a037/report.json) | 2/5 cenários; 79/83 checks | `map-desktop`/`map-mobile`: `geometries.list` não tinha fixture explícita. `atena-mobile`: apenas overflow 402/390 em `plan-ready` e `confirmed-checkbox-only`. Atena desktop e contexto não autorizado passaram. |
| [`attempt-20261102T231055.959202Z-3b421b`](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/report.json) | **5/5 cenários; 83/83 checks** | Fixture explícita e responsividade corrigidas nesta etapa; nenhuma exceção de console, chamada externa ou API desconhecida. |

## Limite da conclusão

O resultado fecha o harness visual local dos componentes reais nos fluxos descritos. Não comprova OAuth, identidade real, autorização de backend, DB, persistência, execução geoespacial, IA, fontes oficiais remotas, mapas externos, geração de PDF ou operação de produção. A consolidação final de tipos/testes e integração permanece com o agente principal.
