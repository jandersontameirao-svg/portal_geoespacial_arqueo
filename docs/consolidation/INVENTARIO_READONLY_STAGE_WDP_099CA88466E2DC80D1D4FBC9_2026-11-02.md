# Inventário sanitizado — recurso stage `wdp_099ca88466e2dc80d1d4fbc9`

**Referência atual:** relatório da tarefa proprietária `Preparar homologação isolada do Atena Geoportal`, datado de 02/11/2026 às 11:56 BRT. Mensagem de resultado: `IizRsDInSxw0RueNhZRNiI`; tarefa: `uqQtvgmt7mHyJUkxIuXko6`.

O Portal GIS leu somente as mensagens já entregues por essa tarefa. **Não repetiu `GET infra/overview`, `GET env`, `GET config`, consultas ao banco, chamadas ao storage, abertura de Preview ou login.** As evidências anteriores continuam históricas; o relatório proprietário abaixo é a atualização disponível, não uma nova inspeção HTTP realizada pelo Portal GIS.

## Indicadores confirmados pela consulta proprietária

| Indicador | Resultado sanitizado | O que isso comprova / não comprova |
|---|---|---|
| Recurso consultado | `wdp_099ca88466e2dc80d1d4fbc9` | Identidade devolvida pela plataforma; não houve transferência de vínculo. |
| Release / HEAD | `GET infra/overview`: `deployStatus=success`; revisão `cc38a7e5350e95e165d8e5a8b5e4fbfd3c7661bd`. HEAD local coincidente. | Metadado de deployment, **não teste HTTP**, não abertura autenticada e não comprovação de frontend/backend funcionando agora. |
| Capacidades | Backend e banco declarados/efetivos; hospedagem `on_demand`. | Não comprova processo acordado ou capacidade disponível. |
| Banco local injetado | Nome `jutrtLemZqkqLCJdFJzA9Y`, distinto do produtivo conhecido `jXb8CWGPzwHDiFUp7FkPz8`. | Configuração **local** extraída sem conexão ao banco; não é leitura do binding dentro do deployment publicado. |
| Fingerprint local de banco | SHA-256 de `host/database`: `9ee00dc2e30c5fdd1df6c6e6720c7e699d2fd0606521836b33b2bb47b1f12e25`. Igual à coleta anterior. | Não inclui usuário, senha ou parâmetros; evidencia estabilidade local, **não destino do container publicado**. Não deve ser confundido com fingerprints parciais históricos de host e nome separados. |
| OAuth | Client ID público `jutrtLemZqkqLCJdFJzA9Y`, distinto do produtivo; código declara `/api/oauth/start` e `/api/oauth/callback`. | Presença/configuração pública parcial. Não comprova callback completo registrado, origem aceita, assinatura válida, MFA, sessão ou login. |
| Storage | Endpoint e credencial runtime presentes, somente por indicadores booleanos. | Presença não comprova identidade do namespace, propriedade ou isolamento de objetos. Nenhum valor de credencial foi exposto. |

## Indicadores ainda indeterminados

O domínio `atenastg-jutrtlem.manus.space` é histórico: a consulta de 11:56 não retornou seu binding atual. O estado de Auto-Publish não foi devolvido; há registros históricos em momentos distintos com `true` e `false`, insuficientes para concluir o presente. O binding de banco do deployment, o namespace proprietário do storage, callbacks completos e origens OAuth continuam não comprovados.

A rota `/manus-oauth/callback` da plataforma não deve ser confundida com `/api/oauth/callback` da aplicação. A existência de uma rota no código ou de Client ID distinto não prova que o fluxo seja aceito pelo provedor.

## Efeito da consulta proprietária — ressalva obrigatória

A tarefa proprietária informou que `GET env` retornou **`runtime_sync=applied`**, ou seja, houve reconciliação automática **local** do runtime pela plataforma. Não houve comando explícito de alteração, mas **não se pode afirmar ausência absoluta de alterações nessa consulta**. O relatório proprietário informa que evitou `GET config` pelo mesmo risco de reconciliação.

Este Portal GIS não repetiu essas chamadas, não alterou configuração externa e não tratou o resultado como autorização de escrita. Nenhuma alteração de produção, stage publicado, banco ou storage foi demonstrada pelo relatório; isso não elimina a atualização local automática explicitamente registrada.

## Ficha mínima de gerenciador — leitura já solicitada, sem nova aprovação genérica

Na ficha do **mesmo recurso stage**, sem Preview, Editar, Vincular, Salvar ou Aplicar, obter um extrato/captura sanitizado, datado, com:

1. Domínio associado, SHA/deployment e valor atual de Auto-Publish.
2. Binding **do deployment** para banco, comparável ao fingerprint `host/database` acima; sem credenciais.
3. ID do namespace/storage e recurso proprietário, permitindo comparação sanitizada com produção.
4. Client ID público OAuth, callbacks completos registrados e origens autorizadas.

Esta ficha é a dependência concreta restante de leitura. Não há aqui um caminho de menus inventado: deve-se usar a ficha realmente disponível ao proprietário ou solicitar ao operador da plataforma apenas esse extrato. Se algum campo não for exposto, marcar indisponível; não tentar `GET env/config` para contornar a limitação.

## Decisões posteriores baseadas nos campos conhecidos

- **Auto-Publish:** consultar o valor não exige nova autorização; se estiver `true`, desligá-lo é alteração ainda não autorizada. Se estiver `false`, não mudar nem reconfirmar desnecessariamente.
- **Banco:** a separação local já tem evidência, mas o binding de deployment precisa de leitura. **Não é necessário pedir DDL de stage para ensaiar TiDB:** o ensaio local v8.5.3 foi viável e realizado. Aplicar futuramente migrations ou seeds em um schema stage exige aprovação específica e reconciliação do journal real desse schema; não reutilizar cegamente migrations GIS sobre o journal Atena.
- **Storage:** comprovar namespace/propriedade é leitura. Somente se houver isolamento comprovado, um round-trip remoto de bytes sintéticos poderá ser proposto com destino/objeto e autorização de escrita específicos. Não presumir necessidade de criar bucket ou segredo.
- **OAuth:** comprovar callbacks/origens é leitura. Alterar registro de callback, origem ou configuração/segredo exige aprovação de payload exato se uma lacuna for identificada. Não criar/rotacionar segredos preventivamente.
- **Aplicação:** importar/checkpoint/publicar um SHA ou abrir Preview/login não foi autorizado nesta rodada. A homologação browser deve vir depois das evidências de isolamento e de autorização operacional pertinente; `deployStatus=success` não a substitui.

Não houve DDL de produção/stage, publicação, configuração, escrita remota, backup produtivo repetido, dispensa ou exclusão dos 11 objetos pelo Portal GIS nesta rodada.
