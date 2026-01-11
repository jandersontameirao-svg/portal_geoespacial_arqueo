# Portal Geoespacial Corporativo - Grupo Arqueo
## Lista de Funcionalidades e Tarefas

### 1. Infraestrutura e Arquitetura
- [ ] Configurar PostgreSQL + PostGIS para armazenamento de geometrias (EPSG:4674)
- [ ] Configurar Object Storage (S3) para arquivos geoespaciais
- [ ] Configurar QGIS Server para geração de mapas
- [ ] Implementar sistema de filas para jobs assíncronos
- [ ] Configurar sistema de logs de auditoria imutáveis
- [ ] Implementar sistema de backups automáticos
- [ ] Implementar health checks e monitoramento

### 2. Sistema de Autenticação e Autorização
- [x] Implementar sistema de convites (sem auto-cadastro)
- [x] Criar fluxo de convite por e-mail
- [ ] Implementar definição de senha via convite
- [ ] Implementar MFA obrigatório para usuários internos
- [ ] Implementar MFA opcional para clientes
- [x] Criar sistema de roles (Admin, Editor Interno, Cliente)
- [x] Implementar RBAC/ABAC para controle de acesso
- [ ] Implementar rate limiting
- [ ] Implementar proteções OWASP Top 10
- [ ] Garantir TLS obrigatório
- [ ] Implementar hashing forte de senha

### 3. Modelo de Dados
- [x] Criar tabela users com roles
- [x] Criar tabela mfa
- [x] Criar tabela projects com AOI
- [x] Criar tabela project_members
- [x] Criar tabela files com metadados
- [x] Criar tabela file_versions
- [x] Criar tabela layers (camadas geoespaciais)
- [x] Criar tabela styles
- [x] Criar tabela saved_maps
- [x] Criar tabela print_jobs
- [x] Criar tabela atlas_jobs
- [x] Criar tabela audit_logs
- [x] Criar tabela invitations

### 4. Gerenciamento de Projetos
- [x] Implementar CRUD de projetos
- [x] Implementar definição de AOI (Área de Interesse)
- [x] Implementar vinculação de usuários autorizados
- [x] Implementar histórico completo de ações
- [x] Implementar isolamento de dados por projeto
- [x] Garantir que clientes vejam apenas projetos autorizados

### 5. Repositório de Arquivos
- [ ] Implementar upload de arquivos geoespaciais (KML, KMZ, SHP zipado)
- [ ] Implementar upload de arquivos não-geoespaciais (PDF, DOCX, XLSX, imagens)
- [ ] Implementar validação de arquivos (antivírus, conteúdo, tamanho)
- [ ] Implementar proteção contra zip bomb
- [ ] Implementar extração de metadados obrigatórios
- [ ] Implementar extração de bounding box
- [ ] Implementar geolocalização manual quando necessário
- [ ] Implementar versionamento de arquivos
- [ ] Implementar auditoria de downloads

### 6. Pipeline de Processamento SHP
- [ ] Implementar validação de ZIP
- [ ] Implementar validação de CRS
- [ ] Implementar conversão usando ogr2ogr
- [ ] Implementar inserção no PostGIS (EPSG:4674)
- [ ] Implementar publicação de camadas
- [ ] Implementar registro de metadados

### 7. Visualizador Geoespacial
- [ ] Implementar globo 3D com CesiumJS (padrão inicial)
- [ ] Implementar visualização 2D com OpenLayers ou MapLibre
- [ ] Implementar alternância 2D <-> 3D
- [ ] Implementar múltiplas camadas simultâneas
- [ ] Implementar controle de ordem de camadas
- [ ] Implementar controle de transparência
- [ ] Implementar identificação de feições
- [ ] Implementar basemaps variados
- [ ] Implementar salvamento de mapas configurados
- [ ] Implementar busca global (projetos, mapas, arquivos, local)

### 8. Geração de Mapas Técnicos ABNT
- [ ] Criar templates QGIS (.qpt) padrão ABNT
- [ ] Implementar geração via QGIS Server + Print Layout
- [ ] Implementar elementos obrigatórios: título, projeto, cliente, autor
- [ ] Implementar elementos obrigatórios: data, escala gráfica/numérica
- [ ] Implementar elementos obrigatórios: seta norte, legenda dinâmica
- [ ] Implementar CRS: UTM / SIRGAS 2000 com fuso automático
- [ ] Implementar grade UTM
- [ ] Implementar moldura cartográfica
- [ ] Implementar carimbo técnico
- [ ] Implementar logomarca Grupo Arqueo
- [ ] Criar Template Técnico ABNT
- [ ] Criar Template Cliente

### 9. Sistema de Atlas Automático
- [ ] Implementar definição de escala
- [ ] Implementar definição de tamanho de folha (A4, A3, A1)
- [ ] Implementar cálculo automático de grid
- [ ] Implementar geração de múltiplas páginas
- [ ] Implementar numeração de mapas (01/N)
- [ ] Implementar geração de PDF multipágina
- [ ] Implementar exportação individual de páginas

### 10. Interface Frontend
- [x] Criar página inicial com globo 3D
- [x] Criar painel "Meus Projetos"
- [x] Criar painel "Atividades Recentes"
- [x] Criar painel "Mapas Gerados"
- [ ] Criar interface de gerenciamento de projetos
- [ ] Criar interface de upload de arquivos
- [x] Criar interface do visualizador geoespacial
- [ ] Criar interface de geração de mapas técnicos
- [ ] Criar interface de geração de atlas
- [ ] Criar interface de gerenciamento de usuários e convites
- [ ] Criar interface de configuração de MFA
- [x] Implementar design moderno e profissional

### 11. Segurança e Auditoria
- [x] Implementar logs de auditoria para todos os acessos
- [x] Implementar logs de auditoria para downloads
- [x] Implementar logs de auditoria para edições
- [x] Garantir logs imutáveis
- [x] Implementar visualização de logs para administradores
- [ ] Implementar alertas de segurança

### 12. APIs e Integrações
- [ ] Pesquisar e integrar APIs gratuitas para basemaps
- [ ] Pesquisar e integrar APIs gratuitas para tiles
- [ ] Pesquisar e integrar APIs gratuitas para cache
- [ ] Pesquisar e integrar APIs gratuitas para conversão geoespacial
- [ ] Documentar APIs utilizadas (nome, finalidade, licença, limitações)

### 13. Testes e Documentação
- [x] Criar testes unitários para backend
- [ ] Criar testes de integração
- [ ] Criar checklist de homologação funcional
- [ ] Criar checklist de homologação de segurança
- [x] Criar guia de deploy e operação
- [x] Criar documentação de arquitetura
- [x] Criar ERD completo
- [x] Criar documentação de endpoints da API
- [ ] Criar wireframes das telas principais

### 14. Entregáveis Finais
- [x] Arquitetura completa documentada
- [x] ERD + SQL scripts
- [x] Lista de APIs gratuitas utilizadas
- [x] Lista de endpoints da API REST
- [ ] Wireframes das telas principais
- [ ] Templates cartográficos (.qpt)
- [ ] Checklist de homologação (funcional + segurança)
- [ ] Guia de deploy e operação

### 15. Interface de Gerenciamento de Projetos
- [x] Criar página de listagem de projetos
- [x] Implementar formulário de criação de projetos
- [x] Implementar filtros e busca
- [x] Adicionar rota /projects no App.tsx
- [x] Integrar com tRPC para CRUD de projetos

### 16. Sistema de Upload de Arquivos (Próximo)
- [ ] Criar router tRPC para gerenciamento de arquivos
- [ ] Implementar função de upload com validação
- [ ] Criar interface de upload com drag-and-drop
- [ ] Implementar preview de arquivos
- [ ] Criar listagem de arquivos por projeto
- [ ] Implementar download de arquivos
- [ ] Implementar exclusão (soft delete) de arquivos

### 17. Página de Detalhes do Projeto
- [x] Criar página /projects/:id
- [x] Implementar aba de visão geral do projeto
- [x] Implementar aba de membros da equipe
- [x] Implementar aba de arquivos
- [x] Implementar aba de histórico de atividades
- [x] Adicionar breadcrumb de navegação

### 18. Sistema de Upload de Arquivos
- [ ] Criar componente de upload com drag-and-drop
- [ ] Implementar validação de tipo de arquivo
- [ ] Implementar preview de arquivos
- [ ] Criar listagem de arquivos com filtros
- [ ] Implementar download de arquivos

### 19. Gerenciamento de Membros do Projeto
- [x] Criar interface para adicionar membros
- [x] Implementar seleção de usuários existentes
- [x] Implementar remoção de membros
- [x] Mostrar lista de membros com roles
- [x] Adicionar procedures listMembers e getActivities ao tRPC

### 20. Sistema de Upload de Arquivos com Drag-and-Drop
- [x] Criar componente FileUpload com drag-and-drop
- [x] Implementar validação de tipos de arquivo
- [x] Implementar validação de tamanho (100MB max)
- [x] Criar preview de thumbnails para imagens
- [ ] Integrar com tRPC para upload real (atualmente simulado)
- [x] Mostrar progresso de upload
- [x] Implementar listagem de arquivos na aba

### 21. Busca e Filtros na Listagem de Projetos
- [x] Adicionar campo de busca por nome/código
- [x] Implementar filtros por status
- [x] Adicionar ordenação por data
- [x] Implementar filtros com useMemo

### 22. Query de Usuários para Adicionar Membros
- [x] Criar query tRPC para listar usuários
- [x] Implementar busca por nome/email
- [x] Substituir valores mockados no diálogo
- [x] Adicionar função getAllUsers no db.ts

### 23. Backend de Upload de Arquivos
- [x] Criar procedure tRPC files.upload
- [x] Implementar upload para S3 usando storagePut
- [x] Salvar metadados no banco de dados
- [x] Retornar URL do arquivo
- [x] Integrar com componente FileUpload

### 24. Listagem de Arquivos Salvos
- [x] Criar query tRPC files.list
- [x] Buscar arquivos do projeto no banco
- [x] Exibir cards com informações do arquivo
- [x] Adicionar botões de download e visualizar
- [x] Implementar exclusão de arquivos
- [x] Criar componente FileList
- [x] Integrar FileList na aba de arquivos

### 25. Visualizador de Mapas para Arquivos Geoespaciais
- [ ] Integrar OpenLayers ou Leaflet
- [ ] Implementar preview de arquivos KML/KMZ
- [ ] Adicionar controles de zoom
- [ ] Implementar alternância de camadas

### 26. Visualizador de Mapas KML/KMZ com Leaflet
- [x] Instalar Leaflet e dependências
- [x] Criar componente MapViewer
- [x] Implementar carregamento de arquivos KML/KMZ
- [x] Adicionar controles de zoom e pan
- [x] Criar modal para visualização
- [x] Integrar com FileList

### 27. Pipeline de Processamento de Shapefiles
- [ ] Criar procedure tRPC files.processShapefile
- [ ] Implementar extração de ZIP
- [ ] Validar CRS com GDAL/ogr2ogr
- [ ] Converter para EPSG:4674
- [ ] Inserir geometrias no PostGIS
- [ ] Registrar camada para visualização

### 28. Página de Gerenciamento de Convites
- [x] Criar página /invitations
- [x] Implementar formulário de envio de convites
- [x] Criar listagem de convites pendentes/aceitos/expirados
- [ ] Adicionar botão para reenviar convite (backend pendente)
- [ ] Adicionar botão para cancelar convite (backend pendente)

### 29. Procedures Backend de Reenvio/Cancelamento de Convites
- [x] Criar procedure invitations.resend
- [x] Atualizar token e expiresAt no banco
- [ ] Enviar novo email via serviço de notificação (TODO)
- [x] Criar procedure invitations.revoke
- [x] Marcar convite como cancelado no banco
- [x] Integrar com frontend (remover placeholders)
- [x] Adicionar funções getInvitationById e updateInvitation no db.ts

### 30. Menu de Navegação Global
- [x] Criar componente Header
- [x] Adicionar links para Home, Projetos, Convites
- [x] Implementar menu de perfil do usuário
- [x] Adicionar controle de visibilidade por role
- [x] Integrar Header em todas as páginas
- [x] Adicionar indicador de página ativa
- [x] Adicionar menu mobile responsivo
- [x] Implementar logout funcional

### 31. Correção do Globo 3D na Página Inicial
- [x] Investigar por que o globo não estava sendo renderizado
- [x] Substituir CesiumJS por react-globe.gl (mais estável)
- [x] Remover header duplicado da Home
- [x] Corrigir problemas de renderização
- [x] Testar visualização do globo
- [x] Adicionar controles de zoom e navegação
- [x] Adicionar badge informativo

### 32. Globo em Tela Cheia e Melhorias
- [x] Remover sidebar da Home para globo ocupar tela toda
- [x] Adicionar painel lateral retrátil com informações (transparente)
- [x] Buscar projetos do banco de dados
- [x] Adicionar marcadores 3D de projetos no globo
- [x] Implementar tooltip com informações ao passar mouse
- [x] Implementar clique para redirecionar para detalhes do projeto
- [x] Criar visualizador 2D com Leaflet
- [x] Implementar alternância fluida entre 2D e 3D
- [x] Manter posição e zoom ao alternar modos

### 33. Botão Toggle para Sidebar (Em Progresso)
- [ ] Adicionar botão no canto superior esquerdo
- [ ] Implementar estado de sidebar (aberta/fechada)
- [ ] Adicionar animação suave de transição
- [ ] Ajustar layout do globo quando sidebar fecha
- [ ] Adicionar ícone apropriado (ChevronLeft/ChevronRight)

### 34. Ferramentas de Desenho no Mapa (Em Progresso)
- [ ] Instalar leaflet-draw ou react-leaflet-draw
- [ ] Adicionar barra de ferramentas de desenho
- [ ] Implementar ferramenta de desenho de pontos (markers)
- [ ] Implementar ferramenta de desenho de linhas (polylines)
- [ ] Implementar ferramenta de desenho de polígonos
- [ ] Implementar ferramenta de edição de geometrias
- [ ] Implementar ferramenta de exclusão de geometrias
- [ ] Salvar geometrias desenhadas no banco de dados
- [ ] Criar procedure tRPC para salvar/atualizar/deletar geometrias
- [ ] Adicionar metadados (nome, descrição, cor) às geometrias

### 35. Visualização de AOI no Mapa (Em Progresso)
- [ ] Adicionar polígonos de AOI ao globo 3D
- [ ] Adicionar polígonos de AOI ao mapa 2D
- [ ] Implementar cores diferentes por status do projeto
- [ ] Adicionar tooltip ao passar mouse sobre polígono
- [ ] Implementar clique no polígono para ver detalhes
- [ ] Sincronizar visualização entre modos 2D e 3D

### 33. Toggle Sidebar + Desenho + AOI
- [x] Botão toggle sidebar
- [x] Ferramentas desenho (pontos, linhas, polígonos)
- [x] Visualização AOI

### 34. Salvamento de Geometrias no Banco
- [x] Criar tabela geometries
- [x] Adicionar procedures tRPC geometries.create/list/delete
- [x] Implementar botão "Salvar" após desenhar
- [x] Adicionar modal para nome/descrição/cor
- [x] Carregar geometrias salvas no mapa

### 35. Painel de Camadas
- [x] Criar sidebar direito retrátil
- [x] Listar todas as camadas ativas
- [x] Adicionar checkboxes mostrar/ocultar
- [x] Implementar controle de opacidade
- [x] Adicionar ícones por tipo de camada

### 36. Ferramentas de Medição
- [x] Instalar leaflet-measure ou similar
- [x] Implementar medição de distâncias (km)
- [x] Implementar medição de áreas (km²/ha)
- [x] Adicionar tooltip com valores em tempo real
- [x] Adicionar botões de medição nos controles

### 37. Carregar e Renderizar Geometrias Salvas
- [ ] Buscar geometrias do projeto via tRPC
- [ ] Renderizar geometrias no mapa 2D automaticamente
- [ ] Aplicar cores e opacidade configuradas
- [ ] Sincronizar com painel de camadas
- [ ] Adicionar popups com informações ao clicar

### 38. Exportação de Geometrias
- [ ] Criar procedure tRPC geometries.export
- [ ] Implementar exportação para KML
- [ ] Implementar exportação para GeoJSON
- [ ] Implementar exportação para Shapefile
- [ ] Adicionar botão de exportação no painel de camadas
- [ ] Permitir seleção de geometrias para exportar

### 39. Edição Avançada e Snapping
- [ ] Implementar snap-to-grid
- [ ] Implementar snap-to-vertex
- [ ] Adicionar ferramenta de mover vértices
- [ ] Adicionar ferramenta de adicionar/remover pontos
- [ ] Implementar dividir polígonos
- [ ] Implementar unir polígonos

### 40. Ferramenta de Mão (Pan)
- [ ] Adicionar botão de ferramenta de mão nos controles
- [ ] Implementar modo de arrasto (pan) no mapa 2D
- [ ] Implementar modo de arrasto (pan) no globo 3D
- [ ] Adicionar cursor de mão ao ativar ferramenta
- [ ] Desativar outras ferramentas ao ativar pan
