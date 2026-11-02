# Proposta mínima — homologação real no stage existente

**Escopo desta proposta:** inventário, desenho e sequência operacional futura. Nenhuma configuração, segredo, usuário, banco, storage, OAuth, migration, publicação ou deploy foi alterado.

## Recurso identificado

A leitura do histórico da tarefa **Preparar homologação isolada do Atena Geoportal** identificou o seguinte recurso de stage:

| Item | Evidência disponível | Estado atual que ainda precisa ser lido no próprio recurso |
|---|---|---|
| Recurso WebDev | `wdp_099ca88466e2dc80d1d4fbc9` | Confirmar acesso e binding ativo antes de qualquer operação. |
| Domínio histórico | `atenastg-jutrtlem.manus.space` | Confirmar se permanece associado e online. |
| SHA histórico mais recente declarado | `cc38a7e5350e95e165d8e5a8b5e4fbfd3c7661bd` | Não representa a candidata Opção A; confirmar HEAD/checkpoint real. |
| Banco | Diagnóstico anterior informou binding distinto da produção, usando somente fingerprint sanitizado. | Confirmar nome/schema e engine por conexão read-only, sem divulgar URL ou senha. |
| Storage | Nenhuma chave, lista, leitura por chave ou namespace isolado foi comprovado. | Confirmar namespace/bucket/adapter efetivo e negar acesso a objetos produtivos. |
| OAuth | A aplicação é `web-db-user` com OAuth Manus; callback de stage isolado não foi comprovado. | Confirmar `VITE_APP_ID`, URL de callback e portal OAuth próprios/gerenciados, apenas por presença e identidade, nunca por valor. |
| Auto-Publish | O histórico registra momentos com `false` e, posteriormente, `true`. | Estado atual é **indeterminado** até leitura da configuração do stage. |

O histórico confirma que o stage não é o recurso produtivo `geoportal.manus.space`. Ele também registra que o isolamento de database/storage não foi comprovado integralmente e que não há evidência de SHA de release aplicado após a integração local anterior. Portanto, este recurso é candidato a homologação, não ambiente já aprovado.

## Meta mínima de homologação real

A homologação deve executar a candidata por SHA identificado em URL separada, usando quatro vínculos isolados ao mesmo tempo:

1. **Código:** checkout da candidata exata, sem usar o domínio produtivo e com Auto-Publish desativado durante o preparo.
2. **Banco:** `DATABASE_URL` aponta a schema/banco do stage, diferente de `jXb8CWGPzwHDiFUp7FkPz8`; journal e fixtures exclusivamente sintéticos.
3. **Storage:** namespace/adaptador dedicado a objetos sintéticos, sem caminho que permita escrita/leitura/listagem de objetos produtivos.
4. **OAuth:** aplicação/callback vinculados somente à URL de stage, com segredo gerenciado próprio e sem reutilizar/capturar sessão de produção.

Nenhum desses vínculos deve ser inferido por nome. Cada um requer uma evidência sanitizada de identidade, por exemplo fingerprint irreversível do host/schema, prefixo/namespace não reversível ou valor booleano de presença/configuração. Não registrar credenciais, URLs assinadas ou payloads reais nos relatórios.

## Operações futuras exatas, em ordem

| Ordem | Operação futura | Responsável recomendado | Evidência de conclusão | Exige autorização específica |
|---:|---|---|---|---|
| 1 | Abrir o recurso `wdp_099ca88466e2dc80d1d4fbc9` e capturar status de domínio, deploy e Auto-Publish. | Administrador do projeto/stage | Tela sanitizada com recurso, domínio, SHA atual e Auto-Publish. | Sim: leitura/configuração do stage. |
| 2 | Desativar Auto-Publish antes de importar qualquer SHA. | Administrador do projeto/stage | Configuração salva e screenshot sanitizado. | Sim: alteração de configuração. |
| 3 | Selecionar o ZIP/commit candidato aprovado e registrar SHA no manifesto de stage; não usar branch sem SHA. | Manus após autorização de importação | Manifesto SHA + hash do pacote. | Sim: atualização de código no stage. |
| 4 | Confirmar por conexão read-only que `DATABASE_URL` identifica banco/schema de stage, não produção. | Manus/admin, sem expor valores | Host/schema por fingerprint e `SELECT VERSION()/DATABASE()`. | Sim: acesso de leitura ao stage. |
| 5 | Criar ou selecionar schema TiDB descartável isolado para ensaio de `0000–0013`; executar somente após aprovação DDL específica. | Administrador de dados + Manus | Nome/fingerprint sanitizado, evidência de isolamento e journal. | Sim: criação/schema/DDL de stage. |
| 6 | Carregar somente fixtures sintéticas admin/editor/client e projetos/arquivos de teste. | Manus após aprovação | Manifesto de fixtures e contagens sanitizadas. | Sim: seed no banco de stage. |
| 7 | Confirmar adaptador/namespace de storage de stage e executar round-trip de bytes sintéticos. | Administrador de projeto + Manus | Chave/prefixo sanitizado, hash de round-trip e bloqueio de namespace produtivo. | Sim: configuração/storage stage. |
| 8 | Confirmar OAuth de stage: aplicação, redirect e callback exclusivamente no domínio de stage, sem mostrar valores. | Administrador de OAuth/Projeto | Identificadores mascarados, callback host, teste de login em conta de teste. | Sim: alteração OAuth/configuração segura. |
| 9 | Iniciar preview/deploy de SHA explícito no domínio stage e verificar banner de versão. | Manus após gates 1–8 | URL, SHA, horário, logs sanitizados e rollback target. | Sim: deploy de homologação. |
| 10 | Executar testes browser autenticados com dados sintéticos e registrar resultados. | Manus + usuário validador | Matriz de testes, screenshots e logs sem dados reais. | Sim: operação em stage. |

## Ações que dependem do usuário/gerenciador seguro

O histórico acessível não fornece uma ferramenta read-only para abrir a configuração de outro projeto WebDev sem potencialmente vinculá-lo para edição. Por isso, estas ações precisam ser feitas pelo proprietário/administrador no gerenciador seguro do stage, ou autorizadas explicitamente para a tarefa responsável:

- Confirmar o estado atual de **Auto-Publish** e desativá-lo antes de qualquer importação. O rótulo exato já observado é `Auto-Publish`; não há caminho de menu verificável nesta tarefa para inventar um passo de UI.
- Confirmar que os valores gerenciados necessários a `web-db-user` existem no stage: `DATABASE_URL`, `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL` e as credenciais gerenciadas de storage/Forge. A confirmação deve ser por presença/vinculação, não por revelação dos valores.
- Confirmar se o banco ou schema TiDB de stage permite criar um schema descartável para ensaio e se o storage fornece prefixo/namespace isolado com leitura e escrita de objetos sintéticos.
- Confirmar que o OAuth permite registrar ou selecionar callback exclusivo para o domínio de stage. Não criar uma nova identidade externa nem fornecer segredo pelo chat.

Ações que Manus pode executar depois dessas confirmações, dentro de autorização explícita: importar SHA/ZIP no checkout do stage, executar preflight read-only, rodar DDL apenas no schema sintético stage aprovado, carregar fixtures sintéticas, fazer deploy de stage manual e executar testes funcionais.

## Custos e serviços

Nenhum novo serviço pago, conta externa, bucket ou identidade foi proposto ou criado. O recurso WebDev stage já existe. Esta tarefa não tem acesso à tela de faturamento/consumo desse recurso, portanto não é possível afirmar custo atual ou adicional. A proposta usa somente capacidades já requeridas pelo template existente (WebDev, banco, storage e OAuth gerenciado); qualquer cobrança, criação de capacidade, upgrade ou serviço adicional deve ser exibido e aprovado no gerenciador antes da ação.

## Critérios de isolamento comprovável

A homologação só inicia quando todas as respostas forem positivas:

- O domínio de stage não é `geoportal.manus.space`.
- O banco de stage tem fingerprint diferente do schema produtivo `jXb8CWGPzwHDiFUp7FkPz8`.
- O storage aceita apenas prefixo/namespace de stage e testa hash/round-trip com bytes sintéticos.
- OAuth usa redirect host de stage, não produção, e nenhuma sessão de produção é compartilhada.
- Auto-Publish está desativado e o SHA da candidata está registrado antes do deploy manual.
- O rollback para a versão stage anterior foi identificado antes do teste.

A ausência de qualquer evidência acima bloqueia a homologação real. O bloqueio não deve ser contornado por mock de login, cópia de segredo, conexão com produção, publicação automática ou reutilização de objetos reais.
