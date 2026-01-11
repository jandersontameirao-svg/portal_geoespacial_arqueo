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
