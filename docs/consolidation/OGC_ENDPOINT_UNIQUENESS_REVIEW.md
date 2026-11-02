# Revisão de unicidade de endpoints OGC — Opção A

**Status:** validado exclusivamente na cópia isolada e no MySQL sintético descartável.
**Escopo:** contrato de URL OGC, schema/migration GIS `0007`, criação de rascunho OGC e testes.
**Fora de escopo:** qualquer DDL, alteração de dados, registro OGC, segredo, storage, homologação ou produção.

## Evidência sanitizada do banco atual

Foi executada uma consulta exclusivamente agregada, sem revelar URLs, para verificar o tamanho de endpoints existentes. O banco atual do projeto no checkpoint `04e64773` **não possui a tabela `ogc_services`** (`ERROR 1146: table does not exist`). Logo:

- não há endpoint existente a medir nesse banco;
- não é possível alegar que já existem URLs acima de 500 caracteres;
- também não existe incompatibilidade de dados preexistentes com a criação futura da tabela;
- a decisão não reduz o contrato histórico de `VARCHAR(1000)` somente com base na ausência atual de registros.

## Alternativas analisadas

| Alternativa | Capacidade de URL | Unicidade | Risco / decisão |
|---|---:|---|---|
| Reduzir `endpoint` de 1.000 para 500 e indexar a URL | Reduzida | índice direto | **Rejeitada.** Poderia rejeitar endpoints OGC válidos entre 501 e 1.000 caracteres. Não há truncamento seguro. |
| Manter `VARCHAR(1000)` e `UNIQUE(endpoint)` | Preservada | índice direto | Incompatível com `utf8mb4`: até 4.000 bytes podem exceder o limite InnoDB de 3.072 bytes. Falhou no MySQL sintético. |
| **Manter `VARCHAR(1000)` e `UNIQUE(endpointHash)` SHA-256** | **Preservada** | fingerprint indexável de 64 caracteres | **Selecionada para a candidata.** A URL integral é mantida; a deduplicação ocorre no endpoint normalizado. |

## Contrato reconciliado

A migration GIS `0007_lonely_freak.sql` da **candidata isolada** cria:

```sql
`endpoint` varchar(1000) NOT NULL,
`endpointHash` varchar(64) NOT NULL,
CONSTRAINT `ogc_endpoint_hash_unique` UNIQUE(`endpointHash`)
```

O servidor:

1. valida entrada URL com teto de **1.000 caracteres**;
2. normaliza o endpoint com a política de hosts permitidos já existente;
3. calcula SHA-256 da URL normalizada, sem truncar texto;
4. busca o hash antes da inserção;
5. para a mesma URL normalizada, retorna conflito de duplicidade;
6. se o mesmo hash estiver associado a uma URL integral diferente, bloqueia a operação como **colisão**, sem sobrescrever o registro existente.

A colisão SHA-256 é criptograficamente improvável, mas não é silenciosamente tratada como equivalência. O endpoint íntegro continua sendo a evidência final da igualdade.

## Limites comprovados no MySQL sintético

O teste de integração tRPC persistiu URLs sintéticas do host autorizado `ogc.invalid` com:

| Comprimento | Resultado |
|---:|---|
| 500 | aceito e retornado com o mesmo comprimento |
| 501 | aceito e retornado com o mesmo comprimento |
| 1.000 | aceito e retornado com o mesmo comprimento |
| 1.001 | rejeitado antes da persistência |
| duplicado após normalização | bloqueado como conflito, sem sobrescrita |

Também há teste puro do fingerprint e da classificação explícita de colisão. O ensaio aplicou todas as migrations GIS em MySQL descartável e terminou com **31 arquivos / 112 testes aprovados**.

## Compatibilidade de release e caminho futuro

O banco atual em `04e64773` não contém `ogc_services`; portanto, na futura aplicação do conjunto GIS `0007`–`0013` no baseline, a tabela será criada diretamente com `endpointHash`, sem backfill.

Se algum ambiente isolado já tiver aplicado uma variante antiga de `0007` com `UNIQUE(endpoint)`, **não editar sua migration já registrada**. A correção deverá ser uma migration nova e aprovada que: adiciona `endpointHash`, preenche hashes por batches controlados, detecta duplicidade/collision antes de criar o índice único e somente então remove a unicidade direta. Esse cenário não foi detectado no baseline produtivo e não foi executado.

## Artefatos relevantes

- `drizzle/0007_lonely_freak.sql` — SQL reconciliado da candidata.
- `drizzle/schema.ts` e snapshots `0007`–`0013` — contrato Drizzle consistente.
- `server/ogcEndpointIdentity.ts` — validação, SHA-256 e classificação de colisão.
- `server/ogcCatalogRouter.ts` — uso do fingerprint no cadastro.
- `server/ogcEndpointIdentity.test.ts` e `server/ogcCatalogRouter.synthetic.test.ts` — limites e persistência.

Nenhum endpoint real, URL assinada, segredo ou registro foi incluído neste documento.
