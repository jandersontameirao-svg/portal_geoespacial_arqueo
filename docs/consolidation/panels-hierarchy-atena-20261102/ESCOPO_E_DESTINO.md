# Integração de painéis, hierarquia e Atena — escopo em execução

Início: 02/11/2026, 19:54 BRT. Base preservada: `13bd34ef34e91bba0b813249dda2469d78fd8761`.

Worktree: `/home/ubuntu/atena_geoportal_paineis_atena_isolado`, branch local `candidato/paineis-hierarquia-atena-20261102`. Backup Git privado criado e verificado antes das mudanças; não é artefato de distribuição.

## Autorização e objetivo

O usuário solicitou seguir recomendações 2 e 3, com item 4 em esclarecimento, e confirmou às 19:56 BRT que deseja a publicação no site. O destino final continua o recurso existente do Portal, domínio `https://geoportal.manus.space`. Não criar outro site ou transferir o domínio. Implementação/testes ocorrem primeiro na cópia isolada.

A autorização de publicação não abrange implicitamente migrations novas além do lote GIS 0007–0013 já aprovado/aplicado. Hierarquia PR8 e histórico Atena necessitam revisão de SQL aditivo novo. Nenhum novo DDL, seed, segredo, usuário, permissão, configuração de storage/OAuth ou serviço pago em produção/stage será executado sem autorização específica aplicável. Não copiar autenticação/MFA do stage como parte de mudanças visuais.

## Trabalho distribuído sem sobreposição

1. Painéis globais Projetos / Mapa-base / Camadas e integração com Home/globo existentes.
2. Hierarquia PR8, regras de grupo/folha/ciclo/projeto, preferências pessoais, tabelas e SQL candidato aditivo apenas para ensaio sintético local.
3. Backend Atena e adaptadores de geometrias/layerData, histórico, plano/confirmação, ADA/AID/AII/prospecção/fontes com proveniência e limites.
4. Painel/chat Atena e página contextual, sem modificar segurança, sem executar modelos ou consultas remotas no desenvolvimento.
5. Coordenador: namespaces, rotas/menus, ponte do workspace, migrations novas locais revisadas, ensaio sintético sem rede, typecheck/build e pacote/diff/hash.

## Preservação obrigatória

Preservar globo, GIS, navegação, menus especializados de Arquivos/Backups/OGC, arquivos/versionamento, raster, Atlas/templates, backup e correções F1/F2/F4/F5. Não aplicar integralmente o ZIP stage sobre a candidata. Preservar o pacote recebido e as referências anteriores. Os 11 objetos continuam adiados como decidido; não reinvestigar, excluir ou alterar registros.

## Evidências previstas

Teste de integração com MySQL/Drizzle/mysql2 reais somente em schema local descartável e rede externa bloqueada; nenhuma fixture de array direto será chamada de teste do driver. Testes de componentes em harness sintético isolado não serão tratados como OAuth/homologação produtiva. Nenhuma chamada LLM ou fonte oficial externa é necessária para os testes determinísticos.

Entrega deve distinguir implementação, testes efetivamente executados, limitações, SQL pendente de autorização, checkpoint exato e implantação realmente confirmada. Não declarar publicação apenas por gerar build ou checkpoint.
