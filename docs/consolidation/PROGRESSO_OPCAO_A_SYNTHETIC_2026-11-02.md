# Progresso Opção A — núcleo GIS preservado, validação sintética

**Data:** 2026-11-02
**Escopo executado:** cópia isolada `/home/ubuntu/atena_geoportal_opcao_a_isolado` a partir da candidata consolidada local.
**Escopo vedado e não executado:** produção, homologação, banco/objetos reais, migrações produtivas, seeds produtivos, usuários/permissões reais, segredos, GitHub push/merge/force-push e deploy.

## Ordem aplicada no ambiente sintético

1. Backup Git local verificável da candidata antes da edição.
2. Comparação estática dos schemas de `04e64773`, núcleo GIS `9426d80` e candidata consolidada `7974a5e`.
3. Criação efêmera de MySQL 8 local em loopback, com schema `geoportal_synthetic` e limpeza automática ao término.
4. Aplicação do journal GIS completo `0000`–`0013` apenas no banco descartável.
5. Carga da fixture `infra/synthetic/seed_minimal.sql` com três usuários sintéticos (admin/editor/client).
6. Correção de falha real de migration OGC encontrada no ensaio: `UNIQUE(endpoint VARCHAR(1000))` em `utf8mb4` ultrapassava o limite de chave InnoDB.
7. Reconciliação sem reduzir a capacidade da URL: endpoint integral de 1.000 caracteres + hash SHA-256 de 64 caracteres único.
8. Reexecução integral da suíte, typecheck e build.

## Matriz entra / preservado / posterior

| Domínio | Decisão nesta candidata | Evidência / limite |
|---|---|---|
| Núcleo GIS, projetos, arquivos, mapas, globo, menus, Atlas, importação/exportação | **Entra e permanece** | Base linear GIS `04e64773 → 9426d80 → candidata`; typecheck/build aprovados. |
| OAuth state/nonce e sessão JWT do patch local | **Entra** | Código consolidado já incorporado antes desta rodada; testes unitários da candidata executados no ensaio. Não houve criação/rotação de segredo. |
| Polygon, MultiPolygon e furos | **Entra** | Conversores/topologia e router preservados; testes de geometria aprovados com banco sintético. |
| MeasurementTools e Leaflet | **Preservado** | Nenhuma substituição de ferramenta/navegação nesta rodada. |
| OGC WMS/WFS e árvore temática | **Entra com correção** | Catálogo passa a preservar endpoint de até 1.000 caracteres e deduplicar por hash. WMS permanece visual; WFS importável somente por fluxo autorizado já existente. |
| `0007`–`0013` GIS | **Prontos para revisão posterior** | Aplicados com sucesso em banco local vazio; não aplicados em produção. |
| PR8 Atena — árvore, preferências e `atena_runs` | **Posterior, fase própria** | Migrations PR8 `0007`–`0012` conflitam em numeração/semântica com GIS. Fontes preservadas em `docs/consolidation/deferred-pr8-atena/`; nada descartado. |
| SQL Atena reconciliado proposto | **Posterior e sujeito a aprovação** | Planejado como migration nova posterior ao journal GIS, nunca reutilizando números PR8. |
| 11 objetos legados | **Preservados como referências; sem dispensa** | Sem cópia física local; 403/inacessibilidade não prova ausência. Não houve exclusão, exceção de backup ou alteração de registro. |
| Backup produtivo | **Preservado; não repetido** | Esta rodada não copiou/exportou dados. A verificação prévia permanece no pacote de predeploy sanitizado. |

## Testes dependentes de banco: resultado

A rodada confirmou os casos antes bloqueados por ausência de banco:

- Projetos: criação, leitura, atualização, convite e membros sob papéis sintéticos.
- Geometrias: importação, listagem, exportação e negação para projeto inexistente/lote vazio.
- MFA: persistência sintética de setup e fluxos negativos existentes.
- Notificações: listagem, contagem, marcação e exclusão persistidas com ID numérico válido.
- Catálogo OGC: criação tRPC de endpoints 500/501/1000, rejeição de 1001 e deduplicação por URL normalizada.
- Demais módulos GIS, raster/COG, WFS, backup local, Atlas, RBAC puro, KML/KMZ e árvore temática.

**Resultado:** 31 arquivos de teste, 112 testes aprovados. Nenhum teste usou banco, storage, OAuth, usuário ou objeto reais.

### Proveniência literal da execução final

Para eliminar a ambiguidade do log inicial, o ensaio foi repetido em worktree temporária fixada no commit funcional `5fa06ac2f2fd544c541fc3f02969b9fd551ee1b3`: journal `0000`–`0013`, 31 arquivos/112 testes, typecheck/build previamente aprovados. O MySQL 8 em loopback na porta 33128 foi destruído ao término; o relatório declara `productionTouched=false`, `homologationTouched=false` e `storageRemoteTouched=false`. Evidência: `docs/consolidation/evidence/synthetic-db-run-7-5fa/`.

### Harness visual offline adicional

Foi criado e executado um harness Chromium/Vite em `127.0.0.1` com rede externa bloqueada, sem montar `App`, OAuth, tRPC, banco, storage, usuário ou cookie. Foram aprovados: alternância e ordem da árvore temática, criação de marcador por Leaflet Draw em memória, registro UMD sequencial do `leaflet-measure`, montagem do controle de medição e ícones Leaflet locais. A correção compartilhada de `leafletDefaultMarker` impede concatenação indevida de `imagePath` sobre URLs absolutas do Vite. A captura e o relatório sanitizado estão em `docs/consolidation/evidence/local-visual-harness/`; não constituem homologação visual autenticada.

## Migrações e compatibilidade

- `04e64773` contém journal até `0006`.
- O núcleo GIS acrescenta `0007`–`0013` (catálogo OGC, tipos de arquivo, versões, cache, Atlas, inventário de backup).
- A candidata mantém o mesmo conjunto GIS e ajusta somente a SQL inicial de `0007` para a unicidade segura por `endpointHash`.
- As migrations PR8 0007–0012 continuam **não incorporadas**, pois seus números conflitam com o journal GIS e exigem reconciliação funcional específica para Atena.

O documento [`OGC_ENDPOINT_UNIQUENESS_REVIEW.md`](OGC_ENDPOINT_UNIQUENESS_REVIEW.md) detalha o problema, os testes e o trade-off sem expor dados reais.

## Gates restantes antes de qualquer produção

1. Revisar e aprovar SQL GIS reconciliado, incluindo a alteração OGC e hashes atualizados.
2. Decidir formalmente a ordem de integração Atena PR8: fase própria posterior ao núcleo GIS ou integração total antes de produção.
3. Confirmar individualmente o tratamento de recuperação dos 11 objetos; nenhum pode ser dispensado automaticamente.
4. **Concluído em 02/11/2026:** preflight somente leitura confirmou journal local `0000`–`0006` byte a byte compatível com o destino, ausência dos objetos-alvo GIS `0007`–`0013` e schema `jXb8CWGPzwHDiFUp7FkPz8`. Não houve DDL, DML, lock explícito, `SET` ou alteração de sessão. Ver `PREFLIGHT_READONLY_SQL_REVIEW_2026-11-02.md`.
5. A análise estática TiDB 8.5.3 classifica `0008`/`0009` (ALTER de `ENUM`) como não comprovadas e exige ensaio TiDB descartável antes de qualquer DDL. Ver `ANALISE_COMPATIBILIDADE_TIDB_8_5_3_GIS_0007_0013.md`.
6. Aplicar migrations somente após autorização explícita de DDL produtivo, ensaio TiDB isolado, preflight de janela e backup recuperável imediatamente anterior à release.
7. Executar smoke tests autenticados no ambiente aprovado com dados sintéticos; OAuth real, navegador 2D/3D e armazenamento gerenciado não foram exercitados nesta rodada.

## Rollback não destrutivo previsto

Para a futura publicação, após migrations GIS aditivas, o rollback operacional deve retornar apenas o código ao release anterior compatível, mantendo schema novo, registros e escritas posteriores. Não prevê `DROP`, truncamento, exclusão de objetos, rollback de coordenadas ou restauração destrutiva automática. Reversões físicas exigirão decisão posterior, nova evidência de backup e janela de manutenção.
