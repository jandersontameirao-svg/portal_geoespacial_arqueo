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

### 41. Importação de Arquivos KML/GeoJSON
- [x] Criar procedure tRPC geometries.importBatch
- [ ] Implementar parser de KML no frontend
- [ ] Implementar parser de GeoJSON no frontend
- [ ] Extrair features e coordenadas
- [ ] Validar e converter coordenadas
- [x] Salvar múltiplas geometrias no banco
- [ ] Adicionar botão de importação no painel de camadas
- [ ] Criar modal de upload de arquivo

### 42. Busca por Coordenadas com Geocoding
- [ ] Adicionar campo de busca nos controles
- [ ] Implementar busca por lat/long
- [ ] Integrar serviço de geocoding (Nominatim OSM)
- [ ] Implementar busca por endereço
- [ ] Animar voo até coordenada encontrada
- [ ] Adicionar marcador temporário no resultado

### 43. Histórico de Visualizações
- [ ] Criar tabela view_history no schema
- [ ] Salvar posições visitadas (lat/long/zoom/timestamp)
- [ ] Criar procedure tRPC para salvar/listar histórico
- [ ] Adicionar dropdown "Histórico" nos controles
- [ ] Implementar navegação para posições anteriores
- [ ] Limitar histórico a últimas 20 posições

### 44. Sistema de Coordenadas UTM Padrão
- [x] Instalar biblioteca utm (conversão lat/long <-> UTM)
- [x] Criar componente de exibição de coordenadas UTM
- [x] Adicionar cursor com coordenadas UTM ao mover mouse
- [x] Implementar auto-detecção de zona UTM
- [ ] Atualizar ferramentas de medição para exibir em metros UTM
- [ ] Adicionar campo de busca por coordenadas UTM
- [ ] Salvar zona UTM preferida nas configurações do projeto
- [ ] Exibir coordenadas UTM nos popups de geometrias

### 45. Busca por Coordenadas UTM
- [x] Criar componente CoordinateSearch
- [x] Implementar parser de coordenadas UTM (formato: 23K 500000 8000000)
- [x] Implementar parser de lat/long (formato: -15.7801, -47.9292)
- [x] Adicionar conversão automática entre formatos
- [x] Implementar navegação até coordenada com animação
- [x] Adicionar botão de busca nos controles do mapa
- [x] Validar entrada e exibir erros

### 46. Ferramentas de Medição em UTM
- [x] Atualizar MeasurementTools para exibir em metros UTM
- [x] Configurar metros como unidade primária (padrão UTM)
- [x] Exibir distâncias em metros (m) e quilômetros (km)
- [x] Exibir áreas em metros quadrados (m²) e hectares (ha)
- [x] Adicionar formato brasileiro (vírgula decimal, ponto milhar)

### 47. Coordenadas UTM nos Popups
- [x] Adicionar coordenadas UTM nos popups de marcadores de projetos
- [x] Adicionar coordenadas UTM nos popups de geometrias (marker, polyline, polygon)
- [x] Formatar coordenadas de forma legível com zona, easting, northing
- [x] Exibir lat/long secundárias para referência
- [x] Criar helper formatUTMCoordinates para reutilização

### 43. Sistema de Importação de Geometrias KML/GeoJSON
- [x] Criar componente GeometryImport com upload de arquivos
- [x] Implementar parser de arquivos KML
- [x] Implementar parser de arquivos GeoJSON
- [x] Adicionar preview visual das geometrias no mapa
- [x] Calcular centro automático das geometrias para preview
- [x] Integrar com procedure geometries.importBatch
- [x] Adicionar botão de importação nos controles do GlobeViewer
- [x] Criar testes unitários para importBatch e export
- [x] Validar formatos e tamanhos de arquivo (10MB max)
- [x] Exibir contagem e lista de geometrias encontradas
- [x] Suportar múltiplos tipos: Point, LineString, Polygon
- [x] Preservar metadados: nome, descrição, cor

### 44. Página de Administração com Dashboard
- [x] Criar procedures backend para métricas (total de projetos, usuários, arquivos, storage)
- [x] Criar query para atividades dos últimos 30 dias
- [x] Criar página /admin restrita a administradores
- [x] Implementar cards de métricas principais
- [x] Adicionar gráficos de atividade com biblioteca de charts
- [x] Criar tabela de logs de auditoria recentes com filtros
- [x] Adicionar paginação nos logs
- [x] Integrar com tRPC

### 45. Suporte para Importação de Arquivos KMZ
- [x] Instalar biblioteca JSZip para descompactação
- [x] Implementar extração de arquivo KML do KMZ
- [x] Adicionar validação de estrutura do KMZ
- [x] Integrar com parser KML existente
- [x] Atualizar GeometryImport para aceitar KMZ
- [x] Testar com arquivos KMZ reais

### 46. Aplicar Identidade Visual do Grupo Arqueo
- [x] Baixar e integrar logo do Grupo Arqueo
- [x] Atualizar paleta de cores (laranja #FF8C00, azul #0066CC)
- [x] Atualizar variáveis CSS no index.css
- [x] Substituir logo no Header
- [ ] Atualizar favicon
- [x] Aplicar cores em botões e elementos principais
- [x] Revisar contraste e acessibilidade

## CHECKLIST DE HOMOLOGAÇÃO - Funcionalidades Faltantes

### 47. Sistema de Perfis Expandido
- [x] Expandir enum de roles: admin | editor | client
- [x] Criar middleware editorProcedure e clientProcedure
- [x] Implementar controle de permissões por perfil
- [x] Adicionar campo role na tabela users
- [ ] Criar tela de gerenciamento de perfis
- [x] Garantir que Cliente só visualiza (sem escrita)
- [ ] Testar isolamento de dados por perfil

### 48. Segurança Avançada (MFA + Rate Limiting)
- [x] Implementar MFA com TOTP (autenticador)
- [x] Adicionar campos mfaEnabled e mfaSecret no banco
- [x] Criar fluxo de ativação de MFA
- [x] Tornar MFA obrigatório para admin e editor
- [x] Instalar e configurar express-rate-limit
- [x] Aplicar rate limiting em endpoints sensíveis
- [ ] Criar health checks do sistema
- [ ] Testar MFA e rate limiting

### 49. Repositório de Arquivos Avançado
- [x] Adicionar suporte para upload de SHP (ZIP) - parser criado
- [x] Adicionar suporte para PDF, DOCX, XLSX, imagens - schema pronto
- [x] Implementar validação de tipo MIME
- [x] Implementar proteção contra zip bomb
- [x] Adicionar extração automática de bounding box
- [x] Implementar versionamento de arquivos - schema pronto
- [x] Criar tabela file_versions
- [ ] Adicionar metadados obrigatórios no upload
- [ ] Integrar fileProcessing.ts no filesRouter
- [ ] Testar upload de todos os formatos

### 50. Pipeline SHP → PostGIS
- [ ] Instalar ogr2ogr no servidor
- [ ] Criar parser de arquivos SHP
- [ ] Implementar validação de ZIP SHP (shp, shx, dbf, prj)
- [ ] Implementar validação de CRS
- [ ] Criar procedure de conversão SHP → GeoJSON
- [ ] Implementar inserção de geometrias no banco
- [ ] Criar visualização de camadas SHP no mapa
- [ ] Registrar metadados da camada
- [ ] Testar pipeline completo

### 51. Geração de Mapas Técnicos ABNT
- [ ] Pesquisar alternativas ao QGIS Server (maplibre-gl, sharp, canvas)
- [ ] Criar template de layout ABNT
- [ ] Implementar elementos obrigatórios: título, escala, norte, legenda
- [ ] Adicionar grade UTM com coordenadas
- [ ] Implementar conversão para SIRGAS 2000 / UTM
- [ ] Adicionar carimbo técnico
- [ ] Adicionar logomarca Grupo Arqueo
- [ ] Gerar PDF com todos os elementos
- [ ] Criar procedure backend generateMap
- [ ] Testar geração de mapas

### 52. Atlas Automático
- [ ] Implementar definição de escala e tamanho de folha
- [ ] Criar algoritmo de cálculo de grid automático
- [ ] Implementar geração multipágina
- [ ] Adicionar numeração sequencial (01/N)
- [ ] Gerar PDF multipágina
- [ ] Permitir exportação de páginas individuais
- [ ] Criar procedure backend generateAtlas
- [ ] Testar atlas com diferentes configurações

### 53. Scanner Antivírus
- [ ] Pesquisar alternativas (ClamAV, VirusTotal API)
- [ ] Implementar integração com scanner
- [ ] Executar scan em todo upload
- [ ] Rejeitar arquivos infectados
- [ ] Registrar resultados em auditoria
- [ ] Testar com arquivos de teste EICAR

### 54. Backups e Health Checks
- [ ] Configurar backups automáticos do banco
- [ ] Testar restauração de backups
- [ ] Criar endpoint /health com métricas
- [ ] Monitorar status de serviços externos
- [ ] Implementar alertas automáticos
- [ ] Documentar procedimentos de recuperação

### 51. Interface Frontend para MFA
- [x] Criar página de configuração de MFA (/security)
- [x] Adicionar exibição de QR code para configuração
- [x] Implementar campo para inserir código de 6 dígitos
- [x] Mostrar lista de códigos de backup
- [x] Adicionar botão para desativar MFA
- [x] Integrar com tRPC mfa router
- [x] Adicionar link no menu de perfil do usuário

### 52. Integração de Processamento de Arquivos
- [x] Atualizar filesRouter.upload para usar fileProcessing.ts
- [x] Extrair automaticamente bounding box de arquivos geoespaciais
- [x] Extrair CRS de arquivos SHP/KML/GeoJSON
- [ ] Criar camadas automaticamente após upload
- [x] Adicionar validação de formatos suportados
- [ ] Testar upload de SHP, KML, KMZ, GeoJSON

### 53. Geração Básica de Mapas Estáticos
- [ ] Instalar maplibre-gl-native e sharp
- [ ] Criar utilitário de renderização de mapas
- [ ] Adicionar elementos: título, escala, norte, legenda
- [ ] Suportar exportação em PNG e PDF
- [ ] Criar procedure para gerar mapa de projeto
- [ ] Testar geração com diferentes projetos

## FASE FINAL - ITENS FALTANTES DO CHECKLIST

### 54. Scanner Antivírus
- [x] Implementar scanner local com validação de assinaturas
- [x] Integrar com VirusTotal API (quando API key disponível)
- [x] Escanear arquivos antes de salvar no S3
- [x] Rejeitar arquivos com malware detectado
- [x] Registrar resultado do scan em auditoria

### 55. Headers OWASP de Segurança
- [x] Instalar e configurar Helmet.js
- [x] Adicionar Content-Security-Policy
- [x] Adicionar X-Frame-Options
- [x] Adicionar X-Content-Type-Options
- [x] Adicionar Strict-Transport-Security

### 56. Health Checks Avançados
- [x] Criar endpoint /api/health
- [x] Verificar conexão com banco de dados
- [x] Verificar memória e uptime
- [x] Retornar status de todos os serviços
- [x] Adicionar métricas de performance

### 57. Busca Global
- [x] Criar endpoint de busca (searchRouter)
- [x] Buscar em projetos, arquivos e camadas
- [x] Filtrar por permissões do usuário
- [x] Implementar sugestões de busca (autocomplete)
- [ ] Implementar UI de busca no header

### 58. Alternância 3D/2D
- [x] Adicionar botão de toggle no viewer
- [x] Implementar modo 2D com Leaflet
- [x] Manter camadas sincronizadas entre modos
- [ ] Salvar preferência do usuário

### 59. Estados de Mapa Salvos
- [x] Usar tabela savedMaps existente
- [x] Salvar posição, zoom, camadas visíveis
- [x] Permitir nomear e listar estados salvos
- [x] Restaurar estado ao clicar
- [x] Criar componente SavedMapsPanel

### 60. Base para Mapas Técnicos ABNT
- [x] Criar printJobsRouter para gerenciar jobs
- [x] Definir schema para elementos do mapa
- [x] Implementar generateTemplate para configuração
- [x] Adicionar elementos: título, escala, norte, legenda, carimbo
- [x] Cálculo automático de escala e fuso UTM

## FASE 100% CONFORMIDADE

### 61. Ambiente de Produção
- [x] Configurar NODE_ENV=production (já existe no package.json)
- [x] Criar script de build para produção (já existe: pnpm build)
- [x] Documentar separação de ambientes

### 62. Backups Automáticos
- [x] Criar sistema de backup do banco de dados (backupRouter)
- [x] Implementar rotina de backup agendado (backup.configure)
- [x] Criar endpoint para backup manual (backup.create)
- [x] Documentar processo de restauração

### 63. Renderização Completa Mapas ABNT
- [x] Instalar html2canvas e jsPDF
- [x] Criar componente MapPrintPreview
- [x] Renderizar grade UTM com coordenadas
- [x] Renderizar moldura cartográfica
- [x] Renderizar carimbo técnico completo
- [x] Adicionar logomarca Grupo Arqueo
- [x] Exportar para PDF

### 64. Atlas Automático
- [x] Criar atlasRouter
- [x] Implementar cálculo de grid automático (calculateGrid)
- [x] Gerar múltiplas páginas (previewGrid)
- [x] Implementar numeração sequencial (01/N)
- [x] Exportar PDF multipágina (getPageConfig)
- [x] Permitir exportar páginas individuais

### 65. UI de Busca Global
- [x] Criar componente GlobalSearch no header
- [x] Integrar com searchRouter.suggestions
- [x] Mostrar dropdown com resultados
- [x] Navegar para item selecionado
- [x] Atalho de teclado Ctrl+K

### 66. Metadados Obrigatórios
- [x] Adicionar validação de descrição obrigatória (min 10 caracteres)
- [x] Adicionar campo de tags obrigatório
- [x] Exibir erros de validação no upload (via Zod)


## MELHORIA DE LAYOUT E UX

### 67. Redesign da Página Inicial
- [ ] Criar hero section profissional com call-to-action
- [ ] Adicionar cards de acesso rápido às funcionalidades
- [ ] Melhorar visualização de projetos recentes
- [ ] Adicionar seção de estatísticas do sistema
- [ ] Implementar animações suaves

### 68. Melhorar Navegação e Menu
- [ ] Expandir menu com todas as funcionalidades
- [ ] Adicionar ícones descritivos
- [ ] Criar submenu para ferramentas geoespaciais
- [ ] Melhorar dropdown do usuário
- [ ] Adicionar breadcrumbs em todas as páginas

### 69. Páginas de Funcionalidades
- [ ] Criar página de Mapas Técnicos ABNT
- [ ] Criar página de Atlas Automático
- [ ] Criar página de Backups (admin)
- [ ] Criar página de Gerenciamento de Usuários
- [ ] Melhorar página de Administração

### 70. Polimento Visual
- [ ] Aplicar sombras e bordas consistentes
- [ ] Melhorar espaçamentos e tipografia
- [ ] Adicionar micro-interações
- [ ] Garantir responsividade em todas as páginas
- [ ] Revisar paleta de cores


### 71. Redesign Completo do Layout (Concluído)
- [x] Redesenhar página inicial com hero section profissional
- [x] Adicionar cards de funcionalidades principais
- [x] Mostrar estatísticas do sistema na home
- [x] Criar menu de navegação expandido com dropdown de Ferramentas
- [x] Criar página de Mapas Técnicos ABNT (/technical-maps)
- [x] Criar página de Atlas Automático (/atlas)
- [x] Criar página de Gerenciamento de Usuários (/admin/users)
- [x] Adicionar procedures listUsers, changeUserRole, resetUserMfa
- [x] Aplicar identidade visual do Grupo Arqueo
- [x] Melhorar responsividade e acessibilidade


### 72. Página de Repositório de Arquivos
- [ ] Criar página /files com listagem de arquivos
- [ ] Adicionar filtros por tipo (SHP, KML, PDF, imagens)
- [ ] Implementar busca por nome
- [ ] Adicionar ações de download e exclusão
- [ ] Mostrar metadados dos arquivos (tamanho, data, projeto)

### 73. Página de Backups
- [ ] Criar página /admin/backups
- [ ] Mostrar histórico de backups
- [ ] Configurar agendamento automático
- [ ] Botão para backup manual
- [ ] Mostrar status do último backup

### 74. Validação Visual nos Formulários
- [ ] Adicionar validação em tempo real nos campos
- [ ] Mostrar feedback visual de erros
- [ ] Desabilitar botão até formulário válido
- [ ] Adicionar preview antes de gerar


### 75. Sistema de Notificações em Tempo Real
- [ ] Criar tabela notifications no schema
- [ ] Criar notificationsRouter com procedures CRUD
- [ ] Implementar procedure para listar notificações não lidas
- [ ] Implementar procedure para marcar como lida
- [ ] Criar componente NotificationBell no header
- [ ] Adicionar contador de notificações não lidas
- [ ] Criar dropdown com lista de notificações
- [ ] Adicionar polling para atualização em tempo real

### 76. Tour Guiado para Novos Usuários
- [ ] Instalar react-joyride
- [ ] Criar componente GuidedTour
- [ ] Definir steps para funcionalidades principais
- [ ] Salvar preferência de tour completo no localStorage
- [ ] Adicionar botão para reiniciar tour
- [ ] Integrar tour na página inicial


### 77. Notificações Automáticas
- [ ] Criar função helper para criar notificações
- [ ] Adicionar trigger em convites (novo convite recebido)
- [ ] Adicionar trigger em uploads (upload concluído)
- [ ] Adicionar trigger em erros (erro em processamento)
- [ ] Testar notificações automáticas

### 78. Redesign do Menu Lateral
- [ ] Reduzir largura do sidebar (420px → 280px)
- [ ] Diminuir padding e espaçamentos
- [ ] Reduzir tamanho dos ícones e textos
- [ ] Compactar cards de ferramentas
- [ ] Adicionar botão de recolher/expandir
- [ ] Implementar modo mini (apenas ícones)
- [ ] Salvar preferência do usuário no localStorage

### 56. Redesign do Menu Lateral (Sidebar)
- [x] Reduzir largura do sidebar de 420px para 288px (w-72)
- [x] Implementar modo compacto (64px) com apenas ícones
- [x] Adicionar botão de colapsar/expandir (setas)
- [x] Adicionar botão de fechar painel completamente
- [x] Persistir preferências no localStorage
- [x] Adicionar tooltips nos ícones quando em modo compacto
- [x] Implementar transições suaves de 300ms
- [x] Ajustar área do globo para expandir quando sidebar recolhido


## FASE 1: INFRAESTRUTURA BASE (28 itens) ✅ COMPLETA

### 1.1 Banco de Dados PostgreSQL + PostGIS (8 itens)
- [x] Configurar PostgreSQL 14+ com replicação
- [x] Instalar e configurar PostGIS 3.3+
- [x] Validar suporte a EPSG:4674 (SIRGAS 2000)
- [x] Criar índices espaciais em geometrias
- [x] Configurar backups automáticos do banco
- [x] Testar restauração de backups
- [x] Criar scripts de migração de dados
- [x] Documentar schema do banco

### 1.2 Object Storage S3 (6 itens)
- [x] Configurar S3 (AWS ou MinIO local)
- [x] Criar buckets para diferentes tipos de arquivo
- [x] Configurar políticas de acesso (ACL)
- [x] Implementar versionamento de objetos
- [x] Configurar ciclo de vida (lifecycle policies)
- [x] Testar upload/download de arquivos

### 1.3 Sistema de Filas com Redis (6 itens)
- [x] Instalar e configurar Redis
- [x] Implementar producer/consumer para jobs
- [x] Criar sistema de retry automático
- [x] Implementar dead letter queue
- [x] Configurar monitoramento de filas
- [x] Testar com jobs simulados

### 1.4 Logs e Auditoria Imutáveis (5 itens)
- [x] Configurar sistema de logs centralizados
- [x] Implementar logs imutáveis (append-only)
- [x] Criar índices para logs
- [x] Configurar retenção de logs (mínimo 1 ano)
- [x] Implementar alertas automáticos

### 1.5 Health Checks Avançados (3 itens)
- [x] Expandir endpoint /api/health com todas as dependências
- [x] Verificar status de PostgreSQL, Redis, S3
- [x] Implementar métricas de performance (CPU, memória, disco)


### 59. Sistema de Download Automático de Dados Geoespaciais
- [x] Criar schema de banco para camadas base (base_layers, base_layer_features)
- [x] Implementar serviço de download FUNAI (Terras Indígenas via WFS)
- [x] Implementar serviço de download INCRA (Terras Quilombolas via ZIP)
- [x] Criar jobs assíncronos para downloads longos
- [x] Implementar sistema de cache (7 dias FUNAI, 30 dias INCRA)
- [x] Adicionar reprojeção automática para EPSG:4674
- [x] Criar interface de gerenciamento de camadas base
- [x] Implementar atualização manual/automática de camadas

### 60. Interface de Upload Manual de Shapefiles
- [ ] Criar componente de upload de shapefile (ZIP com .shp, .shx, .dbf, .prj)
- [ ] Validar formato de arquivo e completude
- [ ] Extrair metadados (bbox, feature count, CRS)
- [ ] Implementar reprojeção se necessário
- [ ] Armazenar arquivos no S3
- [ ] Registrar camadas no banco de dados
- [ ] Criar página de gerenciamento de camadas customizadas

### 61. Visualização de Camadas Base no Mapa
- [ ] Integrar camadas FUNAI (Terras Indígenas) no visualizador
- [ ] Integrar camadas INCRA (Terras Quilombolas) no visualizador
- [ ] Integrar camadas ICMBio (Unidades de Conservação) via upload
- [ ] Integrar camadas OSM (Rodovias) via upload
- [ ] Integrar camadas ANEEL (Infraestrutura Elétrica) via upload
- [ ] Adicionar controle de transparência por camada
- [ ] Implementar filtros por tipo de camada
- [ ] Adicionar legenda dinâmica para cada camada
- [ ] Implementar tooltip com informações ao clicar em feature


### 62. Integração com IPHAN GeoServer
- [x] Testar conectividade com http://portal.iphan.gov.br/geoserver/web/
- [x] Identificar camadas disponíveis (sítios arqueológicos, bens tombados)
- [x] Implementar serviço de download via WFS
- [x] Adicionar ao geodataService.ts
- [x] Criar procedure no baseLayersRouter
- [x] Integrar na interface de gerenciamento


### 63. Visualização de Camadas Base no Globo 3D
- [x] Adicionar suporte a GeoJSON no componente Map.tsx
- [x] Criar controles de toggle para camadas (FUNAI, INCRA, IPHAN)
- [x] Implementar controle de transparência (slider 0-100%)
- [x] Adicionar tooltips informativos ao clicar em features
- [ ] Implementar filtros geográficos por estado/região
- [x] Criar legenda dinâmica para cada camada
- [x] Otimizar renderização para grandes volumes de dados
- [x] Adicionar indicador de carregamento durante fetch


### 64. Melhorias do Visualizador de Camadas Base
- [x] Adicionar dropdown de filtro por estado (UF)
- [x] Implementar filtro por região (Norte, Nordeste, Centro-Oeste, Sudeste, Sul)
- [ ] Adicionar ferramenta de medição de distâncias (régua)
- [ ] Adicionar ferramenta de medição de áreas (polígono)
- [ ] Implementar desenho de polígono para seleção de área
- [ ] Criar exportação de features dentro de área selecionada (GeoJSON)
- [ ] Adicionar exportação em formato Shapefile (ZIP)
- [ ] Otimizar carregamento com paginação/clustering para grandes volumes


### 65. Clustering para Otimização de Visualização
- [x] Instalar leaflet.markercluster e tipos
- [x] Configurar MarkerClusterGroup para camada IPHAN
- [x] Customizar ícones de clusters (cor, tamanho baseado em quantidade)
- [x] Adicionar toggle para habilitar/desabilitar clustering
- [x] Implementar spiderfier para clusters pequenos
- [x] Otimizar performance com chunkedLoading
- [x] Testar com 30.526 pontos do IPHAN
- [ ] Adicionar estatísticas de performance no painel


### 66. Ferramenta de Medição
- [x] Adicionar botões de medição no painel de controle
- [x] Implementar medição de distâncias lineares
- [x] Implementar medição de áreas poligonais
- [x] Exibir resultados em metros/km e hectares
- [x] Adicionar botão para limpar medições
- [x] Estilizar linhas e polígonos de medição

### 67. Exportação de Dados Filtrados
- [x] Criar botão de exportação no painel
- [x] Implementar exportação em GeoJSON
- [ ] Implementar exportação em Shapefile (ZIP)
- [x] Aplicar filtros geográficos aos dados exportados
- [x] Incluir metadados no arquivo exportado
- [x] Adicionar indicador de progresso durante exportação

### 68. Busca Textual de Sítios
- [x] Adicionar campo de busca no painel
- [x] Implementar busca por nome do sítio
- [x] Implementar busca por CNSA
- [x] Implementar busca por município
- [x] Exibir resultados em dropdown
- [x] Zoom automático no sítio selecionado
- [x] Destacar sítio encontrado no mapa


### 69. Integração de Rodovias (DNIT/OSM)
- [x] Adicionar tipo "rodovias" ao schema de base_layers
- [x] Implementar download de rodovias do OpenStreetMap (Overpass API)
- [x] Criar procedure downloadRodovias no baseLayersRouter
- [x] Adicionar card de rodovias na página BaseLayers
- [ ] Integrar visualização de rodovias no mapa (linhas)
- [ ] Adicionar filtro por tipo de rodovia (federal, estadual, municipal)

### 70. Integração de Infraestrutura Elétrica (ANEEL)
- [ ] Adicionar tipo "infraestrutura_eletrica" ao schema
- [ ] Testar fontes alternativas (EPE, ONS) se ANEEL offline
- [ ] Implementar download de linhas de transmissão
- [ ] Criar procedure downloadInfraestruturaEletrica
- [ ] Adicionar card de infraestrutura elétrica na página BaseLayers
- [ ] Integrar visualização no mapa (linhas de transmissão, subestações)

### 71. Ferramenta de Análise de Proximidade
- [ ] Criar componente ProximityAnalysis.tsx
- [ ] Implementar desenho de ponto/linha/polígono de referência
- [ ] Adicionar input de distância de buffer (km)
- [ ] Calcular features dentro do buffer para cada camada
- [ ] Exibir resultados em tabela (camada, quantidade, distância mínima)
- [ ] Destacar features encontradas no mapa
- [ ] Adicionar botão para exportar relatório de proximidade
- [ ] Implementar cálculo de distância mínima usando turf.js


### 72. Visualização de Rodovias no Mapa
- [x] Adicionar toggle "Rodovias Federais" no painel de controle
- [x] Carregar GeoJSON de rodovias do S3
- [x] Renderizar linhas azuis (#2563eb) com peso 3px
- [x] Adicionar tooltips com ref, nome, tipo e superfície
- [x] Aplicar filtros geográficos às rodovias
- [x] Adicionar contador de rodovias visíveis


### 73. Interface de Upload de Arquivos GIS
- [x] Criar schema de banco para gis_uploads (id, userId, filename, originalName, fileType, fileSize, mimeType, s3Key, s3Url, status, validationResult, metadata, createdAt)
- [x] Implementar backend de upload com multipart/form-data
- [x] Adicionar validação de tipos de arquivo (SHP, KML, KMZ, GeoJSON, GPX)
- [x] Implementar extração de metadados (CRS, bounds, feature count, geometry types)
- [x] Criar procedure tRPC para upload e listagem
- [x] Integrar validação com IA (LLM) para verificar qualidade dos dados
- [x] Criar componente de drag-and-drop com react-dropzone
- [x] Adicionar preview de arquivos antes do upload
- [x] Implementar barra de progresso de upload
- [x] Criar página de gerenciamento de uploads
- [x] Adicionar visualização de arquivos uploadados no mapa
- [x] Implementar download de arquivos uploadados


### 74. Integração de Arquivos GIS Uploadados no Visualizador
- [ ] Adicionar query tRPC para listar arquivos GIS validados (status=completed)
- [ ] Criar seção "Arquivos Uploadados" no painel de controle do BaseLayersViewer
- [ ] Adicionar checkbox para cada arquivo com nome e tipo
- [ ] Implementar carregamento dinâmico de GeoJSON do S3
- [ ] Renderizar geometrias no mapa com estilo padrão
- [ ] Adicionar tooltips com metadados do arquivo
- [ ] Sincronizar com filtros geográficos existentes
- [ ] Adicionar contador de features por arquivo


### 74. Interface de Upload com Drag-and-Drop
- [ ] Instalar react-dropzone
- [ ] Criar componente GisUploader.tsx com área de drag-and-drop
- [ ] Validar formatos aceitos (SHP, KML, KMZ, GeoJSON, GPX, GML, DXF)
- [ ] Validar tamanho máximo (100MB)
- [ ] Implementar preview de arquivos selecionados
- [ ] Adicionar barra de progresso de upload
- [ ] Exibir resultados da validação por IA (isValid, errors, warnings, metadata)
- [ ] Mostrar metadados extraídos (CRS, bounds, feature count, geometry types)
- [ ] Criar página /gis-uploads para gerenciamento
- [ ] Adicionar rota no App.tsx e link no menu

### 75. Integração de Arquivos GIS no Visualizador
- [ ] Adicionar query para listar arquivos validados (status=completed)
- [ ] Criar seção "Arquivos Uploadados" no painel de controle
- [ ] Adicionar checkbox para cada arquivo
- [ ] Carregar GeoJSON dinamicamente do S3
- [ ] Renderizar geometrias no mapa
- [ ] Adicionar tooltips com metadados
- [ ] Sincronizar com filtros geográficos


### 75. Correção de Suporte a Arquivos KMZ
- [x] Implementar descompactação de arquivos KMZ no backend
- [x] Extrair arquivo KML interno do ZIP
- [x] Atualizar validação por IA para processar KML extraído
- [x] Testar upload de arquivo KMZ real
- [x] Garantir que metadados são extraídos corretamente


### Bug Fix: Download de Camadas Base
- [x] Corrigir erro no download de camadas base da FUNAI
- [x] Implementar storage usando manus-upload-file
- [x] Testar download de camadas FUNAI com sucesso (650 features)
- [x] Testar download de camadas INCRA (94 features)
- [x] Testar download de camadas IPHAN (30,533 features)
- [x] Testar download de camadas OSM (corrigido bbox e query simplificada)


### Bug Fix: Erro ao Descompactar Arquivos KMZ
- [x] Investigar erro "ADM-ZIP: invalid or unsupported zip format. No END header found"
- [x] Corrigir código de processamento de arquivos KMZ (leitura como base64)
- [x] Validar formato do arquivo antes de tentar descompactar
- [x] Testar com arquivo KMZ válido (test.kmz - 411 bytes - sucesso!)


### Feature: Validação com IA para Arquivos KMZ
- [x] Analisar código atual de validação de arquivos
- [x] Implementar extração automática de KML do arquivo KMZ
- [x] Melhorar prompt da IA para validação geoespacial detalhada (brasileiro)
- [x] Validar estrutura XML do KML extraído
- [x] Identificar sistema de coordenadas (CRS)
- [x] Detectar geometrias inválidas ou problemáticas (coordenadas fora do Brasil)
- [x] Gerar relatório com metadados (feature count, geometry types, bounds, attributes)
- [x] Testar com arquivo KMZ real (teste_validacao.kmz - detectou erro de coordenada em Paris!)


## SPRINT A - Motor GIS no Ar (Desktop) ✅ CONCLUÍDO (12/01/2026)

### Infraestrutura Docker
- [x] Criar docker-compose.gis.yml com PostGIS, QGIS Server, Redis, Worker
- [x] Configurar volumes persistentes para PostGIS
- [x] Configurar volume para projetos QGIS (./infra/qgis/projects -> /projects)
- [x] Expor portas: PostGIS (5432), QGIS Server (8080), Redis (6379), Worker (3001)
- [x] Criar arquivo .env.gis.example com variáveis de ambiente
- [x] Criar scripts de bootstrap (Linux/Mac/Windows)

### Banco PostGIS Demo
- [x] Criar banco arqueo_gis
- [x] Criar schema demo
- [x] Criar tabela demo.municipios (id, name, codigo_ibge, uf, area_km2, populacao, geom MultiPolygon EPSG:4674)
- [x] Inserir 3 polígonos demo (Brasília, Goiânia, Belo Horizonte)
- [x] Criar índice espacial GIST

### Projeto QGIS Demo
- [x] Criar projeto demo_project.qgz
- [x] Configurar conexão PostGIS para demo.municipios
- [x] Aplicar estilo laranja/bordô (cores Grupo Arqueo)
- [x] Definir CRS do projeto como EPSG:4674 (SIRGAS 2000)
- [x] Nomear camada como "demo_municipios"
- [x] Adicionar labels com nome dos municípios

### QGIS Server - Publicação WMS
- [x] Configurar endpoint /ows com WMS habilitado
- [x] Validar GetCapabilities WMS
- [x] Validar GetMap com bbox dos polígonos
- [x] Configurar metadados WMS (title, abstract, organization)

### Portal - Overlay WMS
- [x] Implementar componente WMSTileOverlay para Google Maps
- [x] Criar página de demonstração /wms-demo
- [x] Implementar conversão tile->bbox para GetMap
- [x] Adicionar controles de visibilidade e opacidade
- [x] Criar router tRPC gisDiagnosticsRouter
- [x] Criar página de diagnósticos /gis-diagnostics
- [x] Implementar auto-refresh de status

### Documentação
- [x] Criar SPRINT_A_README.md completo
- [x] Documentar arquitetura e componentes
- [x] Documentar como usar e testar
- [x] Documentar troubleshooting
- [x] Validar 7/7 critérios de aceite
- [ ] Permitir ligar/desligar camada visualmente

### Healthchecks e Diagnósticos
- [ ] Criar página /admin/diagnostics
- [ ] Mostrar status PostGIS (ping)
- [ ] Mostrar status QGIS Server (GetCapabilities)
- [ ] Mostrar status Redis (ping)
- [ ] Link clicável para GetCapabilities

### Scripts de Bootstrap
- [ ] Criar /infra/scripts/bootstrap_gis_demo.sh (Linux/Mac)
- [ ] Criar /infra/scripts/bootstrap_gis_demo.ps1 (Windows)
- [ ] Script deve criar tabelas, inserir dados demo, publicar projeto QGIS

### Documentação
- [ ] Criar docs/SprintA.md com instruções completas
- [ ] Documentar comando para subir ambiente (docker compose up)
- [ ] Documentar comando para executar bootstrap
- [ ] Documentar URLs do portal e QGIS Server
- [ ] Incluir exemplos curl GetCapabilities e GetMap

### Critérios de Aceite
- [ ] docker compose up sobe tudo sem erro
- [ ] Bootstrap cria tabela e insere polígono demo
- [ ] GetCapabilities responde listando "demo_municipios"
- [ ] Overlay WMS visível no portal ao ativar "Camada Demo"
- [ ] Entregar evidências: prints + respostas curl

### Checklist de Homologação
- [ ] Subida limpa do compose
- [ ] Banco com tabela demo e SRID correto
- [ ] GetCapabilities OK
- [ ] GetMap OK
- [ ] Overlay visível no portal
- [ ] Logs do QGIS Server sem erros críticos
- [ ] Documentação de como rodar e reproduzir


## Entrega IBGE remota e menus — 02/11/2026, 21:06 BRT

- [x] Preservar backup Git e desenvolver em worktree isolada.
- [x] Validar endpoints remotos WMS/WFS reais com TLS estrito, sem salvar malhas.
- [x] Cadastrar IBGE no catálogo OGC existente: 2 serviços, 2 variantes e 4 auditorias.
- [x] Preservar as 4 bases existentes por fingerprint; manter journal15 sem DDL.
- [x] Separar Projetos, Mapa de fundo e GeoServer; conservar globo e caches legados.
- [x] Implementar WMS visual e consulta WFS explícita, limitada e somente em memória.
- [x] Aplicar atribuição Fonte: IBGE e identificar municípios como referência 2010.
- [x] Aprovar 35 testes dirigidos (7 com MySQL/Drizzle reais), typecheck e build.
- [x] Aprovar 5 casos visuais offline/82 assertivas e WMS real/15 tiles/7 assertivas.
- [x] Preservar compatibilidade do harness anterior, sem modificar OAuth.

Pendências expressas: APIs estatísticas/união com população não habilitadas; OAuth real/homologação integral não exercitados; verificação anônima do marcador no domínio retornou403. Os demais TODOs históricos não foram marcados como concluídos por esta entrega.


## Melhoria validada 02/11/2026 — impressão simples e cinco fundos

- [x] Preservar checkpoint 70c2e8b6 e backup Git antes da cópia isolada.
- [x] Habilitar cinco fundos explícitos com créditos, limites e CORS: Esri Satélite, OSM, OpenTopoMap, Esri Light Gray e Dark Gray.
- [x] Integrar captura real 2D ao globo e ao workspace, preservando GIS, globo 3D, Atena, Atlas e GeoServer separado.
- [x] Implementar escolha simples de modelos Vista livre, Técnico e Apresentação, prévia automática e PDF da mesma cena.
- [x] Salvar modelos por ação explícita na API Atlas existente, sem sobrescrever templates/defaults e sem migration.
- [x] Manter proporção, créditos, limites, escala central aproximada e DPI real; A4/A3/A1/A0 sem superamostragem fictícia.
- [x] Reproduzir e corrigir tiles falhos; bloquear PDF incompleto/CORS e respeitar cancelamento.
- [x] Aprovar 137 casos puros relacionados e 2 casos MySQL/Drizzle reais de modelos.
- [x] Aprovar harness offline: 5 cenários/92 asserções, desktop/mobile e 4 PDFs reais, TypeScript/build.

As pendências históricas acima não foram apagadas ou automaticamente aprovadas. OAuth real/homologação integral, 11 objetos, FUNAI/INCRA remotos, estatística IBGE e runtime raster produtivo permanecem nos gates próprios.
