# Matriz de consolidação — candidata GIS + PR8

**Data:** 2026-11-02
**Escopo:** cópia isolada `/home/ubuntu/atena_geoportal_candidato_final`
**Base candidata:** `9426d80c4e6b10e584b6c0d53fd6b0aeaba0c791`
**PR8 de referência:** `25f8936614e7148f67c8b14cb3c909c6d2b3fc99`
**Patch OAuth/JWT local:** SHA-256 `f9febbf140be820321968e50417d8d5729795d2ef4fd1944c1a1fc4ba8c2360f`

Nenhuma fonte original foi sobrescrita. Nenhuma migration, DDL, seed, dado, usuário, permissão, objeto de storage, merge, push ou deploy foi executado.

| Origem / área | Arquivo(s) analisado(s) | Diferença relevante | Decisão na candidata | Evidência / razão |
|---|---|---|---|---|
| GIS isolado | Toda a árvore no commit `9426d80` | É a linha com workspace temático, WFS/WMS, raster/COG, Atlas, backup, globo, menus, navegação e rotas GIS já integradas | **Base preservada** | É o único baseline que mantém todas as funções GIS avançadas juntas; não houve substituição de App, Header, Atlas, Projeto ou rotas. |
| PR8 topologia | `shared/geometry-coordinates.ts` | A base tratava polígonos como um anel plano em alguns pontos | **Portado ativo** | Valida Polygon/MultiPolygon, anéis fechados e furos; usado por router e workspace. |
| PR8 Leaflet/topologia | `client/src/lib/leaflet-geometry-coordinates.ts` | Leaflet fecha visualmente anéis, mas pode retornar arrays abertos | **Portado ativo** | Fecha somente a posição implícita sem apagar nesting ou vértices. |
| PR8 importação | `client/src/components/GeometryImport.tsx` | GeoJSON/KML/KMZ precisava preservar MultiPolygon e anéis internos | **Portado ativo, adaptado** | Mantém mapa-base aprovado; não reintroduz tile OSM. |
| PR8 visualização KML/KMZ | `client/src/lib/kml-file-viewer.ts`, `client/src/components/MapViewer.tsx` | Parser anterior não limitava leitura/ZIP/XML com rigor suficiente | **Portado ativo, adaptado** | Limites de bytes/entradas/features/coordenadas, rejeição de DTD/entidades e visualização de MultiGeometry; Esri permanece base visual. |
| PR8 persistência de geometria | `server/geometriesRouter.ts` | Exportação/importação podia perder MultiPolygon/furos e não validava sempre a topologia | **Portado ativo, reconciliado** | Router GIS preserva RBAC, auditoria, visibilidade, opacidade e exportações GeoJSON/KML. |
| PR8 medição | `client/src/components/MeasurementTools.tsx`, `client/src/types/leaflet-measure.d.ts` | Correções de lifecycle e tipagem do `leaflet-measure` | **Portado ativo** | Montagem/limpeza do controle foi preservada; sem troca de navegação. |
| PR8 assets Leaflet | `client/src/lib/leafletDefaultMarker.ts` da base GIS e overrides PR8 | Overrides em componentes apontavam para CDN, podendo causar marcador quebrado | **Reconciliado ativo** | Removidos overrides locais no globo/importador; o asset empacotado é configurado uma vez pela entrada. |
| Patch OAuth/JWT local | `shared/const.ts`, `client/src/const.ts`, `client/src/main.tsx`, `useAuth.ts`, `DashboardLayout.tsx`, `Home.tsx`, `server/_core/oauth.ts`, `oauthState.ts`, `sdk.ts` | State não estava vinculado a nonce único e sessão não exigia issuer/audience | **Portado ativo** | State tem nonce host-only, callback falha fechado antes do exchange, consumo único em runtime e claims issuer/audience/appId. Nenhum segredo foi criado, rotacionado ou exibido. |
| PR8 Atena — análise | `server/atena/**`, `server/atenaRouter.ts`, `AtenaPanel.tsx` | Exige `geometries.layerId`, grupos `layers.isGroup`, `createGeometriesBatch` e árvore diferente da linha GIS | **Preservado, não ativado** | Fontes completos e SHA-256 estão em `docs/consolidation/deferred-pr8-atena/`; ativá-los agora exigiria mudança de schema/arquitetura não autorizada e poderia substituir o workspace GIS. |
| Atena Cartógrafa da linha GIS | `server/atlasRouter.ts`, worker/cartografia/Atlas existentes | Já usa o modelo GIS de COG, vetores, templates e renderização | **Preservado na base** | Não foi substituído pela Atena PR8 incompatível. |
| Migrations PR8 `0007–0012` | `drizzle/0007_layer_tree.sql` a `0012_atena_runs.sql` | Numeração e modelo conflitam parcialmente com a evolução GIS | **Não copiadas, não executadas** | Exigem aprovação específica e uma migration nova reconciliada, posterior ao schema final. |
| Migrations GIS existentes | `drizzle/**` da base `9426d80` | Já registram raster, catálogo, backup, file_versions e Atlas da linha GIS | **Preservadas sem execução** | Código candidato não altera nem executa DDL. |
| Globo, Header, menus, App, Projetos, Mapas, Atlas, Arquivos, Administração | Componentes e rotas do baseline GIS | São superfícies de alto risco para regressão visual/funcional | **Preservados** | Não foram copiados App/Header completos da PR8; apenas os chamadores OAuth com patch limpo. |

## Decisão arquitetural necessária antes de ativar Atena PR8

A integração funcional da Atena PR8 não é uma simples cópia de arquivos. Ela requer, em uma nova revisão de schema e com aprovação específica:

1. um adaptador entre `layers`/geometrias do workspace GIS e a árvore PR8;
2. definição se `layerId` será obrigatório ou opcional em geometrias já existentes;
3. mapeamento de grupos de resultados Atena sem confundir camadas próprias, bases, resultados GIS, WMS/WFS e rasters;
4. migration nova, com número posterior ao histórico consolidado, teste em banco descartável e rollback não destrutivo;
5. revisão de permissões e auditoria para criação de resultados Atena.

Até essa decisão, o código Atena PR8 permanece preservado e hashado, mas **não é apresentado como funcional na candidata**.
