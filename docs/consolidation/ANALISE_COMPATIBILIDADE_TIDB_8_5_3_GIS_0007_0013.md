# Compatibilidade TiDB 8.5.3 — migrations GIS `0007–0013`

**Destino conhecido pelo preflight:** `8.0.11-TiDB-v8.5.3-serverless`.
**Engine efetivamente ensaiado:** `8.0.11-TiDB-v8.5.3`, Community Edition, com TiDB/TiKV/PD locais descartáveis.
**Fonte ensaiada:** checkout `57f6a07fd573a256eaed2905c0655effa5971d19`, sem mudanças em migrations. A aceitação local do SQL e do journal está comprovada; isso não autoriza DDL nem certifica o serviço Serverless.

## Resultado efetivo

| Migration | Evidência local TiDB 8.5.3 | Limite remanescente |
|---|---|---|
| `0007` | Quatro statements passaram; tabelas OGC, hashes/índices e tipos aceitos. Os cinco testes OGC da suíte passaram com persistência, incluindo URLs de 500/501/1000 e rejeição de 1001. | O ensaio não comprova configuração/serviços OGC remotos nem implantação Serverless. |
| `0008` | `ALTER TABLE files MODIFY COLUMN ... ENUM` passou. Ensaio adicional preservou os oito rótulos anteriores em tabela populada e aceitou `geotiff`. | Ordinais numéricos mudam; duração/reorg sob volume e concorrência reais não foram medidas. |
| `0009` | Passou depois de `0008`; oito rótulos antigos e `geotiff` preservados; `geojson` aceito. | Não inverter/condensar journal; revisar consumidores que tratem enum como ordinal. |
| `0010` | Três `ADD COLUMN` passaram; colunas anuláveis/JSON aceitas. | Não houve backfill nem teste com volume histórico real. |
| `0011` | Três `ADD COLUMN` passaram, incluindo `INT NOT NULL DEFAULT 0` e timestamps anuláveis. | A aceitação de DDL foi verificada; default aplicado a uma linha de cache anterior e reorganização sob volume ainda não foram medidos neste ensaio. |
| `0012` | Criação de templates Atlas, duas colunas e índice passaram. | Não equivale a geração Atlas autenticada, nem prova específica de auto-update temporal em carga real. |
| `0013` | Quatro statements passaram, incluindo os dois índices de `backup_inventories`. | Criação das tabelas não constitui backup dos bytes nem altera o inventário de 11 objetos. |

O runner SQL literal registrou por arquivo todos os 14 sucessos `0000–0013` e os respectivos hashes em `evidence/tidb-8.5.3-local-literal-1/report.json`. A suíte desse schema passou: **31 arquivos / 112 testes**. A matriz funcional continua distinguindo 33 testes de persistência MySQL/TiDB local, 11 de filesystem e 68 puros/mocks/loopback; o conjunto não é homologação browser.

Para testar a ferramenta oficial e não somente um loop de statements, o migrador `pnpm drizzle-kit migrate` foi executado em outro schema sintético novo, dentro do **mesmo cluster**. Ele passou; as 14 entradas de `__drizzle_migrations` correspondem exatamente aos hashes locais. O ensaio complementar de enum em schema próprio preservou oito rótulos existentes e dois tipos novos. Isso não foi reinstalação do cluster nem repetição de backup/ensaio produtivo.

## O que muda em relação à análise anterior

A análise documental anterior marcou `0008/0009` como não comprovadas, por restrições gerais de alterações de `ENUM` descritas pelo TiDB. O ensaio local exato agora demonstrou que **estas duas instruções específicas** são aceitas por Community v8.5.3, inclusive com rótulos preexistentes. A dúvida de aceitação local foi superada; não se deve continuar apresentando essas migrations como incompatíveis por inferência documental. [1] [2] [3]

Os ordinais obtidos com `fileType+0` foram diferentes depois das inserções de novos valores na lista. Os rótulos armazenados foram preservados. Portanto, integração por rótulo pode ser testada como acima, mas enum não é contrato numérico estável; qualquer consumidor numérico precisa de auditoria própria.

A solução OGC continua `endpoint VARCHAR(1000)` integral e índice único em `endpointHash VARCHAR(64)`. Não há truncamento, índice de 1000 caracteres ou backfill produtivo implícito. Nenhuma migration foi alterada nesta rodada.

## Community local não reproduz Serverless

Playground é um ambiente local de teste, não uma edição emulada de TiDB Cloud. A própria documentação exclui seu uso como prova de estabilidade/função integral produtiva. Os serviços gerenciados têm políticas, limites e ciclos de conexão/upgrades distintos. Um `SELECT VERSION()` semelhante não demonstra igualdade de configuração, patches, permissões DDL ou recursos do tenant. [4] [5]

O ensaio comprova parser, execução local das instruções, estrutura, journal, persistência sintética e preservação dos rótulos exercitados. Não comprova custos/quotas Cloud, locks em volume, fila de jobs DDL no tenant, storage/OAuth, concorrência, comportamento do container publicado, MFA ou navegabilidade completa.

**Não é necessário pedir DDL de stage para resolver o ensaio local: ele já foi realizado.** A dependência remanescente é leitura do binding e das capacidades do serviço gerenciado via ficha segura, sem novas chamadas `GET env/config` que sincronizem runtime. Se uma divergência concreta for identificada, a operação corretiva deverá ser proposta com payload e aprovação específicos, não como autorização genérica de ambiente.

## Rollback e recuperação

O rollback seguro proposto continua retorno de código compatível, mantendo schema novo e escritas posteriores. Não há prova de execução do baseline `04e64773` completo com schema GIS novo neste ensaio; preservação dos rótulos antigos não a substitui. Não há autorização de DROP, truncamento, restauração destrutiva ou migração de coordenadas.

As migrations PR8 numeradas `0007–0012` continuam fora deste lote. Sua integração terá fase própria e journal reconciliado, preservando os módulos deferidos. Aprovações de DDL de produção/stage, publicação, secrets e escrita remota continuam separadas.

## Incidentes e encerramento local

O primeiro executor excedeu prontidão enquanto componentes eram baixados e ficou aguardando o encerramento do TiUP. A mesma instância iniciada foi aproveitada. Uma inspeção detectou status `10080` em `0.0.0.0`; somente o TiDB local foi relançado com `--status-host=127.0.0.1` antes do SQL. Nenhum preview ou teste HTTP externo foi aberto. O executor futuro foi corrigido para download prévio, monitoramento desabilitado, bind de status explícito e cleanup limitado; essa revisão do bootstrap passou por validação estática, não por reinstalação end-to-end.

Todos os componentes utilizados foram encerrados e o datadir temporário descartado. Logs/resultados sanitizados são preservados; não existem dados reais ou segredos nos schemas do ensaio.

**References**

[1]: https://docs.pingcap.com/tidb/stable/mysql-compatibility/ "TiDB MySQL compatibility"
[2]: https://docs.pingcap.com/tidb/stable/sql-statement-alter-table/ "TiDB ALTER TABLE"
[3]: https://docs.pingcap.com/tidb/stable/sql-statement-modify-column/ "TiDB MODIFY COLUMN"
[4]: https://docs.pingcap.com/tidb/stable/quick-start-with-tidb/ "Quick Start with TiDB Self-Managed"
[5]: https://docs.pingcap.com/tidbcloud/serverless-limitations/ "Limitations and Quotas of TiDB Cloud Starter and Essential"
