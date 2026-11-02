# Decisões da integração isolada — 02/11/2026

## Entram nesta candidata

- Painéis globais Projetos / Mapa-base / Camadas, preservando o globo e o catálogo de provedores atual.
- Hierarquia arbitrária de grupos e camadas, vínculo opcional geometry→layer, seleção de projetos e preferências pessoais com autorização por projeto.
- Atena como módulo explícito: plano, confirmação de UI, execução validada, histórico, resultados com ponte para o workspace GIS; adaptadores de prospecção/áreas/fontes oficiais conforme contratos das fontes reaproveitadas.
- Página e chat Atena, menu desktop/mobile e link contextual do projeto, sem retirar Arquivos, Backups ou OGC.
- Correção da leitura de `?tab=map` pelo `useSearch` real de Wouter: dependência funcional dos novos links para o workspace, não uma reorganização geral de todas as telas.
- Ponte pura de renderização para preferências pessoais/cascata e prevenção de duplicação quando uma camada possui tanto FeatureCollection quanto geometry rows. Geometrias legadas sem camada e camadas sem FC permanecem renderizáveis.
- Extensão obrigatória do inventário de backup para as quatro tabelas novas e referência `atena_runs.artifactKey`. Novo manifesto 2.1 e verificação explícita dos manifestos 2.0 com o registro histórico. Sem backup produtivo nesta etapa, sem alteração do adaptador remoto ou de políticas de retenção. Essa ampliação é necessária para não introduzir tabelas que o exportador ignora.

## Não entram como cópia cega

- Substituição de Header/App/schema pelo ZIP parcial.
- Desvios de Arquivos→Projetos ou Backups→Admin, alteração de provedor cartográfico, políticas de cache/TLS, mudanças de segredo/auth/MFA ou permissões.
- Novos serviços pagos, execução de modelo de IA ou chamada de fonte oficial real para validar o código local.
- Recuperação/dispensa/exclusão dos 11 objetos; permanecem adiados e preservados.

## Limites de autorização e evidência

A resposta do usuário confirmando publicação no site fixa o destino, mas não fornece autorização específica para um novo lote SQL além de GIS 0007–0013. O SQL novo será aditivo, gerado/revisado e ensaiado somente em banco descartável local; será apresentado com seu hash antes de qualquer alteração produtiva.

Testes de driver usam MySQL/Drizzle/mysql2 reais sem credenciais reais. Testes de UI usam componentes reais com transporte tRPC em memória explicitamente identificado. Nenhum deles será chamado de OAuth real, homologação integral do stage ou confirmação de implantação produtiva.

As capacidades remotas indisponíveis devem permanecer visivelmente bloqueadas, não receber respostas sintéticas na aplicação. Modelos científicos/cartográficos que a origem marca como bloqueados não se tornam disponíveis apenas por integrar o catálogo.
