# Painéis, hierarquia e Atena integrados — entrega isolada

**Implementação concluída e validada localmente. Ainda não publicada.** Código funcional: `09539ac8158df86d07eb1fc8f20046eb1d4919c5`. Base preservada: `13bd34ef34e91bba0b813249dda2469d78fd8761`. Destino pretendido permanece o Portal existente em https://geoportal.manus.space. A fonte ativa permaneceu no checkpoint anterior durante esta integração; nenhuma consulta ou escrita remota foi necessária nesta rodada.

## O que agora existe na candidata

O mapa global ganhou os painéis **Projetos / Mapa-base / Camadas**, com busca e seleção pessoal persistível, árvore expansível e abertura do workspace correto por `?tab=map`. A navegação da Home é recolhível e responsiva. Não foram trocados o globo, os provedores de mapa ou os destinos especializados Arquivos, Backups e OGC.

A árvore passa a aceitar grupos aninhados e camadas folha com movimentação, proteção contra ciclos e associação opcional de geometrias. Visibilidade pessoal em cascata não altera o padrão compartilhado nem a seleção usada para análise. GeoJSON em `layerData`, metadados, referências de arquivos e geometrias soltas foram preservados.

Atena foi integrada como módulo real, não só menu: página, atalho contextual, chat, interpretação, plano revisável, confirmação explícita, execução validada no servidor, histórico e resultados. O motor lê a camada GIS existente sem copiar suas geometrias para o banco; grava resultados em novas camadas com FeatureCollection e geometrias associadas. A ponte com o workspace evita desenhar duas vezes o mesmo resultado. Foram portados os contratos de prospecção e ADA/AID/AII/fontes oficiais com seus limites; catálogo de modelo bloqueado não equivale a método científico implementado.

A integração manteve os motores GIS/raster, Atlas/templates, arquivos e correções F1/F2/F4/F5. `server/_core`, `server/db.ts`, `server/rasterRouter.ts`, os componentes de upload/listagem, package.json, lockfile e migrations 0000–0013 não foram alterados nesta candidata.

## Como foi testado

| Prova | Resultado | Limite |
|---|---|---|
| Migration Drizzle 0000–0014 no schema vazio sintético | 15 entradas de journal; migration nova aplicada | MySQL 8.0.46, não deployment TiDB |
| Suíte dirigida final | 164 testes / 13 arquivos aprovados | Não é a repetição da suíte histórica 112 |
| Contratos de hierarquia com driver real | 12 aprovados | Contextos tRPC de atores sintéticos, sem OAuth |
| Motor/ponte GIS→Atena com driver real | 5 aprovados | Buffer determinístico real, sem LLM ou fonte remota |
| Componentes reais em Chromium offline | 5 cenários, 83 verificações e 28 checkpoints de layout aprovados | Transporte tRPC em memória, não backend HTTP |
| TypeScript final | Aprovado, incremental desabilitado | Sem configuração real |
| Build final | Aprovado | Aviso de chunks grandes, não falha |

A prova de driver usou Drizzle/mysql2 reais, não arrays fornecidos diretamente. O buffer concluiu como `completed`; origem permaneceu com o mesmo hash. Foram testados autorização por projeto, negativas de acesso, movimentos recíprocos concorrentes, visibilidade pessoal/cascata, seleção revalidada, metadados antigos e prevenção de duplicação. O schema e todos os dados foram criados somente no MySQL descartável por socket Unix, com skip-networking, mysqlx desligado e namespace sem rota externa. O cleanup aprovado removeu datadir e socket.

No navegador, o plano não executa ao interpretar, revisar ou marcar checkbox. Só o clique explícito em confirmar dispara a chamada simulada; edição invalida plano e confirmação. Foram verificados desktop 1057×692 e celular 390×844. O overflow real do cartão móvel foi corrigido de 402 para 390 pixels. Nenhuma chamada externa foi observada e os serviços locais foram encerrados.

A primeira tentativa MySQL aplicou migrations locais, mas não iniciou testes por conflito de workers do Vitest. A segunda passou e foi limpa. As tentativas visuais anteriores também permanecem preservadas: uma falhou em seletores do harness; outra revelou fixture ausente e overflow. Nenhuma foi apagada ou apresentada como aprovação.

## Ajustes de integração necessários

O inventário de backup foi ampliado para as quatro novas tabelas e a chave de PDF Atena. Manifestos novos usam versão 2.1; os antigos 2.0 continuam verificáveis pelo registro histórico exato. Quatro testes puros confirmam evolução, round-trip em memória e detecção de adulteração. Isso não é um novo backup/restauração produtivo; a prova F4 anterior do extrator de driver permanece histórica e não foi renomeada.

A concorrência foi adaptada de lock nomeado para transação com linha-âncora. TiDB usa início pessimista e leituras atuais FOR UPDATE, sem alterar configuração de sessão/global; MySQL usa START TRANSACTION. A serialização real foi comprovada somente no MySQL local nesta rodada. O relatório inicial do agente de hierarquia que descreve GET_LOCK está preservado como histórico e foi superado pelo adendo de concorrência.

O único ajuste após testes no executor foi remoção de uma linha vazia excedente no fim do arquivo, sem alteração semântica. A atualização posterior de `release-info.json` contém apenas identificação da candidata e limites, não implantação nem alteração do código testado.

## SQL novo e publicação

A implementação precisa de **0014_hierarchy_atena.sql**, SHA-256 `aefe1d867073dd95e6ef66b91e0f771ef7037594aedbcbc028812e4291136de5`. São quatro tabelas novas, quatro colunas e índices aditivos. Não há exclusão, seed, alteração de ENUM de files, migração de coordenadas, mudança de auth/configuração ou permissão. O lote GIS 0007–0013 já aplicado não deve ser repetido.

A autorização de publicação no site foi registrada, mas o consentimento específico do lote anterior não autoriza automaticamente este SQL novo. **Nenhum DDL 0014, checkpoint WebDev ou deploy desta integração foi executado.** É necessária decisão específica sobre o arquivo canônico anexado antes da janela real. As limitações já adiadas por Janderson não foram recolocadas como exigências prévias nem simuladas como concluídas.

Após a decisão específica, a sequência proposta é backup/preflight seguro da janela, somente a nova migration aprovada, integração da referência fechada ao recurso existente, checkpoint/publicação suportados e verificação real da versão servida. Não criar outro site ou alterar domínio/Auto-Publish/segredos. Em falha parcial de DDL, parar e conciliar o aplicado; não repetir cegamente nem executar down destrutivo.

## Pendências explícitas

OAuth e navegação autenticada integral, fontes oficiais/LLM reais, armazenamento/PDF remoto, runtime raster durável e comprovação administrativa do stage não foram homologados nesta rodada. 0014 e o protocolo novo de concorrência ainda não foram executados no TiDB Serverless. O rollback do novo módulo sobre 0014 é proposto como volta de código mantendo schema e escritas; o ensaio de resgate anterior sobre GIS não comprova automaticamente essa combinação. Esses limites estão junto do SQL para decisão consciente.

Os 11 objetos continuam adiados e preservados, sem dispensa, exclusão, recuperação alegada ou alteração de registros. Nenhum backup produtivo foi repetido nesta implementação. Não houve merge/push/GitHub, configuração ou serviço pago.

## Arquivos para revisão

- [SQL literal, impactos e rollback](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/SQL_0014_EXATO_IMPACTOS_E_ROLLBACK.md).
- [Painéis globais](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/RELATORIO_PAINÉIS.md), [hierarquia inicial](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/RELATORIO_HIERARQUIA.md) e [adendo que a atualiza](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/ADENDO_CONCORRENCIA_TIDB.md).
- [Backend Atena](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/RELATORIO_ATENA_BACKEND.md) e [interface/testes visuais](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/RELATORIO_ATENA_UI.md).
- [Árvore no desktop](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/map-desktop-tree.png) e [plano Atena no celular](/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline/attempt-20261102T231055.959202Z-3b421b/atena-mobile-review.png), ambos do harness sintético explícito.

O pacote sanitizado acompanha fonte completa da candidata, patch/diff incremental contra 13bd34ef, manifesto, SQL/hashes, relatórios e evidências finais. Os backups Git privados, node_modules, dist, .env, dados operacionais e dumps não fazem parte da distribuição.
