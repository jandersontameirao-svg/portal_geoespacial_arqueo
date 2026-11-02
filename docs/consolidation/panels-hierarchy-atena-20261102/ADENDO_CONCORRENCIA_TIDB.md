# Ajuste de concorrência da hierarquia — revisão anterior ao ensaio

A primeira implementação local da hierarquia usou GET_LOCK/RELEASE_LOCK em conexão MySQL reservada. Essa versão ainda não foi publicada nem executada em produção/stage. Seu relatório de origem permanece preservado como histórico.

O coordenador identificou que não se deve depender desse mecanismo como garantia de exclusão distribuída entre nós TiDB. A candidata será ajustada para transação com bloqueio da linha-âncora: projeto para alterações da árvore e usuário para substituição da própria seleção. A mesma conexão permanece reservada durante o fluxo read/check/write e commit/rollback. A decisão será revalidada pelos testes locais de movimentos recíprocos concorrentes.

No TiDB, o início explícito da transação pessimista deve ser usado sem SET GLOBAL/SESSION; no MySQL, START TRANSACTION. SELECT VERSION apenas identifica o mecanismo para escolher a sintaxe. Esse comportamento é do código de mutação autorizado do aplicativo, não é uma consulta preflight nem foi executado no banco remoto. Não há mudança de schema ou segredo em decorrência desse ajuste.

O teste MySQL não será descrito como prova da execução TiDB dessa alteração específica. Se a edição gerenciada recusar a sintaxe ou a transação pessimista, o procedimento deve falhar fechado; não recorrer silenciosamente a mutex local, lock no-op ou operação sem transação. Escritas que não adotarem o protocolo de linha-âncora não recebem essa garantia de serialização.
